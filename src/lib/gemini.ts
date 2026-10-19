/**
 * Minimal Gemini REST client that runs entirely in the browser using the
 * user's own (free) AI Studio API key. No server is involved.
 */
import { getSettings, updateSettings } from './settings';
import { emitStatus, sleep } from './events';
import { inSlot, isOffline, waitBusy, waitOnline } from './aiQueue';

const BASE = 'https://generativelanguage.googleapis.com';

export type Part =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType?: string; fileUri: string } };

export interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

export class GeminiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class MissingKeyError extends Error {
  constructor() {
    super('Add your free Gemini API key in Settings to use AI features.');
  }
}

export function hasKey() {
  return !!getSettings().apiKey.trim();
}

function key() {
  const k = getSettings().apiKey.trim();
  if (!k) throw new MissingKeyError();
  return k;
}


function parseRetryDelay(body: any): number | undefined {
  const details: any[] = body?.error?.details ?? [];
  for (const d of details) {
    if (typeof d?.retryDelay === 'string') {
      const s = parseFloat(d.retryDelay);
      if (!Number.isNaN(s)) return s * 1000;
    }
  }
  return undefined;
}

async function call(url: string, init: RequestInit, signal?: AbortSignal, attempts = 4): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    let res: Response;
    // Offline: wait for the connection (saying so) rather than spend the retries.
    if (isOffline() && !(await waitOnline('Gemini', signal))) throw new GeminiError('You’re offline. Try again once you’re connected.', 0);
    try {
      res = await inSlot(() => fetch(url, { ...init, signal }), signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      lastErr = new GeminiError('Network error — check your connection.', 0);
      if (isOffline()) i--;
      await sleep(1500 * (i + 1), signal);
      continue;
    }
    if (res.ok) return res;
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* not json */
    }
    const msg: string = body?.error?.message || `${res.status} ${res.statusText}`;
    if ((res.status === 429 || res.status === 503 || res.status === 500) && i < attempts - 1) {
      const wait = Math.min(parseRetryDelay(body) ?? 4000 * 2 ** i, 65000);
      await waitBusy(wait, 'Gemini', signal);
      lastErr = new GeminiError(msg, res.status);
      continue;
    }
    if (res.status === 400 && /API key not valid/i.test(msg)) {
      throw new GeminiError('Your Gemini API key was rejected. Check it in Settings.', 400);
    }
    if (res.status === 429) {
      throw new GeminiError('Free-tier quota reached for now. Wait a minute (or until tomorrow for daily limits) and try again.', 429);
    }
    throw new GeminiError(msg, res.status);
  }
  throw lastErr instanceof Error ? lastErr : new Error('Request failed');
}

type ModelSlot = 'textModel' | 'ttsModel';

/** Google's answer for a model this key can no longer use, as opposed to a bad request. */
export function isRetiredModel(e: unknown, model: string): boolean {
  if (!(e instanceof GeminiError)) return false;
  if (![400, 403, 404].includes(e.status)) return false;
  return e.message.includes(model) || (/\bmodel/i.test(e.message) && /no longer available|not (?:found|supported|available)/i.test(e.message));
}

let pendingSwitch: Promise<ReturnType<typeof modelUpgrades>> | null = null;

/**
 * Moves the settings off a model Google refused, onto the newest one the key
 * offers. Never onto an older version of the same family: if the newest one
 * is refused, that is better reported than quietly downgraded.
 */
async function replaceModel(failed: string): Promise<ReturnType<typeof modelUpgrades>> {
  pendingSwitch ??= listModels()
    .then((list) => {
      const patch = modelUpgrades(list.map((m) => m.name).filter((n) => n !== failed), getSettings());
      for (const [slot, next] of Object.entries(patch) as [keyof typeof patch, string][]) {
        const rx = Object.values(FAMILY).find((r) => r.test(failed) && r.test(next));
        if (rx && compareFamily(rx, failed, next) < 0) delete patch[slot];
      }
      updateSettings(patch);
      return patch;
    })
    .finally(() => (pendingSwitch = null));
  return pendingSwitch;
}

/**
 * Calls a model from settings, and if Google has retired it, switches the
 * setting to its newest replacement and tries once more. A model the caller
 * named itself only falls back when it is the one in settings.
 */
async function callModel(slot: ModelSlot, explicit: string | undefined, url: (model: string) => string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const configured = getSettings()[slot];
  const model = explicit || configured;
  try {
    return await call(url(model), init, signal);
  } catch (e) {
    if (model !== configured || !isRetiredModel(e, model)) throw e;
    // A request racing this one may already have moved the setting on.
    if (getSettings()[slot] === model) await replaceModel(model).catch(() => {});
    const next = getSettings()[slot];
    if (next === model) throw e;
    emitStatus(`${model} is no longer available — switched to ${next}.`);
    return call(url(next), init, signal);
  }
}

export interface GenerateOptions {
  model?: string;
  system?: string;
  prompt?: string;
  contents?: Content[];
  parts?: Part[];
  schema?: object;
  temperature?: number;
  tools?: object[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

function buildBody(o: GenerateOptions) {
  const contents: Content[] = o.contents ?? [
    { role: 'user', parts: [...(o.parts ?? []), ...(o.prompt ? [{ text: o.prompt }] : [])] },
  ];
  const generationConfig: Record<string, unknown> = {};
  if (o.temperature !== undefined) generationConfig.temperature = o.temperature;
  if (o.maxOutputTokens) generationConfig.maxOutputTokens = o.maxOutputTokens;
  if (o.schema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = o.schema;
  }
  const body: Record<string, unknown> = { contents, generationConfig };
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
  if (o.tools) body.tools = o.tools;
  return body;
}

function extractText(data: any): string {
  const cand = data?.candidates?.[0];
  if (!cand) {
    const block = data?.promptFeedback?.blockReason;
    if (block) throw new GeminiError(`Gemini blocked this request (${block}).`, 400);
    return '';
  }
  const parts: any[] = cand.content?.parts ?? [];
  return parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
}

export async function generate(o: GenerateOptions): Promise<string> {
  const res = await callModel(
    'textModel',
    o.model,
    (model) => `${BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() }, body: JSON.stringify(buildBody(o)) },
    o.signal,
  );
  const data = await res.json();
  const text = extractText(data);
  const reason = data?.candidates?.[0]?.finishReason;
  if (!text && reason && reason !== 'STOP') throw new GeminiError(`Gemini stopped early (${reason}).`, 500);
  return text;
}

export async function generateJSON<T>(o: GenerateOptions & { schema: object }): Promise<T> {
  const text = await generate(o);
  try {
    return JSON.parse(text) as T;
  } catch {
    // Some models wrap JSON in fences; strip them and retry parse.
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) return JSON.parse(m[1]) as T;
    throw new GeminiError('Gemini returned malformed JSON. Try again.', 500);
  }
}

export interface WebSource {
  uri: string;
  title: string;
}

/** Generation grounded in live Google Search results (free-tier daily limit applies). */
export async function generateGrounded(o: GenerateOptions): Promise<{ text: string; sources: WebSource[] }> {
  const res = await callModel(
    'textModel',
    o.model,
    (model) => `${BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() },
      body: JSON.stringify(buildBody({ ...o, tools: [{ googleSearch: {} }] })),
    },
    o.signal,
  );
  const data = await res.json();
  const chunks: any[] = data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: WebSource[] = [];
  for (const c of chunks) {
    const uri = c?.web?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({ uri, title: c.web.title || new URL(uri).hostname });
  }
  return { text: extractText(data), sources };
}

/** Streams text deltas. */
export async function* stream(o: GenerateOptions): AsyncGenerator<string> {
  const res = await callModel(
    'textModel',
    o.model,
    (model) => `${BASE}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() }, body: JSON.stringify(buildBody(o)) },
    o.signal,
  );
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const t = extractText(JSON.parse(payload));
        if (t) yield t;
      } catch (e) {
        if (e instanceof GeminiError) throw e;
      }
    }
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

interface UploadedFile {
  uri: string;
  mimeType: string;
  name: string;
}

/** Resumable upload to the Gemini File API (files live 48h on Google's side). */
export async function uploadFile(blob: Blob, displayName: string, mimeType: string, signal?: AbortSignal): Promise<UploadedFile> {
  const start = await call(
    `${BASE}/upload/v1beta/files`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': key(),
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(blob.size),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: displayName.slice(0, 120) } }),
    },
    signal,
  );
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new GeminiError('Upload failed to start.', 500);
  emitStatus('Uploading audio to Gemini…');
  const up = await call(
    uploadUrl,
    {
      method: 'POST',
      headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
      body: blob,
    },
    signal,
    2,
  );
  const info = (await up.json()).file;
  let file = info;
  for (let i = 0; file.state === 'PROCESSING' && i < 120; i++) {
    await sleep(2500, signal);
    const r = await call(`${BASE}/v1beta/${file.name}`, { headers: { 'x-goog-api-key': key() } }, signal);
    file = await r.json();
  }
  if (file.state === 'FAILED') throw new GeminiError('Gemini could not process that file.', 500);
  return { uri: file.uri, mimeType: file.mimeType || mimeType, name: file.name };
}

/** Inline bytes per request: base64 adds a third, and Gemini takes 20 MB in all. */
export const INLINE_LIMIT = 14 * 1024 * 1024;

/**
 * Returns a part for a binary blob — inline when small, File API when large.
 * Pass `inline` when several blobs share one request and must fit together.
 */
export async function blobPart(blob: Blob, mimeType: string, name: string, signal?: AbortSignal, inline = blob.size <= INLINE_LIMIT): Promise<Part> {
  if (inline) {
    return { inlineData: { mimeType, data: await blobToBase64(blob) } };
  }
  const f = await uploadFile(blob, name, mimeType, signal);
  return { fileData: { mimeType: f.mimeType, fileUri: f.uri } };
}

export interface TTSResult {
  pcm: Uint8Array;
  sampleRate: number;
}

/** Multi-speaker text-to-speech. `script` uses "Name: line" format. */
export async function tts(script: string, speakers: { name: string; voice: string }[], signal?: AbortSignal): Promise<TTSResult> {
  const speechConfig =
    speakers.length > 1
      ? {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: speakers.map((s) => ({
              speaker: s.name,
              voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } },
            })),
          },
        }
      : { voiceConfig: { prebuiltVoiceConfig: { voiceName: speakers[0].voice } } };
  const res = await callModel(
    'ttsModel',
    undefined,
    (model) => `${BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `Read this podcast conversation aloud in a warm, lively, natural tone:\n\n${script}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig },
      }),
    },
    signal,
  );
  const data = await res.json();
  const part = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
  if (!part) throw new GeminiError('No audio returned from Gemini TTS.', 500);
  const mime: string = part.inlineData.mimeType || '';
  const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
  const bin = atob(part.inlineData.data);
  const pcm = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i);
  return { pcm, sampleRate: rate };
}

export interface ModelInfo {
  name: string;
  displayName: string;
  methods: string[];
}

export async function listModels(apiKey?: string): Promise<ModelInfo[]> {
  const k = apiKey ?? key();
  const out: ModelInfo[] = [];
  let pageToken = '';
  for (let i = 0; i < 5; i++) {
    const res = await call(`${BASE}/v1beta/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`, { headers: { 'x-goog-api-key': k } }, undefined, 2);
    const data = await res.json();
    for (const m of data.models ?? []) {
      out.push({ name: String(m.name).replace(/^models\//, ''), displayName: m.displayName, methods: m.supportedGenerationMethods ?? [] });
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

type ModelKind = 'flash' | 'pro' | 'tts';

const FAMILY: Record<ModelKind, RegExp> = {
  flash: /^gemini-(\d+(?:\.\d+)*)-flash(-preview(?:-[\d-]+)?)?$/,
  pro: /^gemini-(\d+(?:\.\d+)*)-pro(-preview(?:-[\d-]+)?)?$/,
  tts: /^gemini-(\d+(?:\.\d+)*)-flash(-preview)?-tts$/,
};

/** Orders two names of one family: higher version first, then stable before preview. */
function compareFamily(rx: RegExp, a: string, b: string): number {
  const [, va, pa] = a.match(rx)!;
  const [, vb, pb] = b.match(rx)!;
  const na = va.split('.').map(Number);
  const nb = vb.split('.').map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (nb[i] ?? 0) - (na[i] ?? 0);
    if (d) return d;
  }
  return Number(!!pa) - Number(!!pb);
}

/** The newest model of a family that the key can see, e.g. gemini-3.8-flash over gemini-2.5-flash. */
export function newestModel(names: string[], kind: ModelKind): string | undefined {
  const rx = FAMILY[kind];
  return names.filter((n) => rx.test(n)).sort((a, b) => compareFamily(rx, a, b))[0];
}

/**
 * Moves each model slot onto the newest one the key offers. Google keeps
 * retired models in the list but refuses them to newer keys, so a slot is
 * moved when its model is missing or is an older version of the same family.
 * A deliberate pick outside the family (a lite model, say) is left alone.
 */
export function modelUpgrades(names: string[], current: { textModel: string; proModel: string; ttsModel: string }) {
  const patch: Partial<typeof current> = {};
  const slots = [['textModel', 'flash'], ['proModel', 'pro'], ['ttsModel', 'tts']] as const;
  for (const [slot, kind] of slots) {
    const best = newestModel(names, kind);
    const now = current[slot];
    if (!best || best === now) continue;
    const rx = FAMILY[kind];
    if (!names.includes(now) || (rx.test(now) && compareFamily(rx, now, best) > 0)) patch[slot] = best;
  }
  return patch;
}

/** Asks a model for a single token, so a key that lists a model but can't use it fails here. */
export async function probeModel(model: string, apiKey?: string): Promise<void> {
  await call(
    `${BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey ?? key() },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Hi' }] }], generationConfig: { maxOutputTokens: 1 } }),
    },
    undefined,
    2,
  );
}

/** Schema helpers (OpenAPI subset used by Gemini's responseSchema). */
export const S = {
  str: (description?: string) => ({ type: 'STRING', ...(description ? { description } : {}) }),
  num: (description?: string) => ({ type: 'NUMBER', ...(description ? { description } : {}) }),
  int: (description?: string) => ({ type: 'INTEGER', ...(description ? { description } : {}) }),
  bool: (description?: string) => ({ type: 'BOOLEAN', ...(description ? { description } : {}) }),
  enum: (values: string[]) => ({ type: 'STRING', enum: values }),
  arr: (items: object) => ({ type: 'ARRAY', items }),
  obj: (properties: Record<string, object>, required = Object.keys(properties)) => ({
    type: 'OBJECT',
    properties,
    required,
    propertyOrdering: Object.keys(properties),
  }),
};
