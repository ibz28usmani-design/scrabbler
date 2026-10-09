/**
 * Bytez — serverless inference for open-source models, used as an alternative
 * text engine. Bytez exposes an OpenAI-compatible Chat Completions endpoint, so
 * this client speaks that dialect rather than Bytez's native per-task protocol.
 *
 * Scope note: Bytez covers plain text generation only here. YouTube ingestion,
 * website fetching, Google Search grounding, multi-speaker TTS, audio
 * transcription and PDF/handwriting OCR have no Bytez equivalent in this app and
 * stay on Gemini — see lib/llm.ts for the routing rule.
 */
import { getSettings } from './settings';
import { emitStatus } from './events';

/** OpenAI-compatible base, per docs.bytez.com → Chat Completions. */
const BASE = 'https://api.bytez.com/models/v2/openai/v1';

export class BytezError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function hasBytezKey() {
  return !!getSettings().bytezKey.trim();
}

function key(override?: string) {
  const k = (override ?? getSettings().bytezKey).trim();
  if (!k) throw new BytezError('Add your Bytez API key in Settings to use Bytez models.', 401);
  return k;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

function messageFrom(body: any, res: Response): string {
  return body?.error?.message || body?.error || body?.message || `${res.status} ${res.statusText}`;
}

async function call(path: string, init: RequestInit, apiKey?: string, signal?: AbortSignal, attempts = 3): Promise<Response> {
  for (let i = 0; i < attempts; i++) {
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        ...init,
        signal,
        headers: { Authorization: `Bearer ${key(apiKey)}`, ...(init.headers ?? {}) },
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      if (i === attempts - 1) {
        // A browser CORS rejection surfaces here as an opaque TypeError.
        throw new BytezError('Could not reach Bytez. If this persists, your browser may be blocked by CORS — see Settings for details.', 0);
      }
      await sleep(1500 * (i + 1), signal);
      continue;
    }
    if (res.ok) return res;
    let body: any = null;
    try {
      body = await res.clone().json();
    } catch {
      /* not json */
    }
    const msg = messageFrom(body, res);
    if (res.status === 401 || res.status === 403) throw new BytezError(`Bytez rejected the key: ${msg}`, res.status);
    if ((res.status === 429 || res.status >= 500) && i < attempts - 1) {
      // Cold starts on a serverless instance can take a while on first call.
      emitStatus(res.status === 429 ? 'Bytez is rate-limiting — retrying…' : 'Bytez model is warming up — retrying…');
      await sleep(4000 * (i + 1), signal);
      continue;
    }
    throw new BytezError(msg, res.status);
  }
  throw new BytezError('Bytez request failed.', 0);
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

function body(o: ChatOptions, stream: boolean) {
  return JSON.stringify({
    model: o.model || getSettings().bytezModel,
    messages: o.messages,
    ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
    // Open models default to short replies; the app needs room for full documents.
    max_tokens: o.maxTokens ?? 4096,
    ...(stream ? { stream: true } : {}),
  });
}

export async function chat(o: ChatOptions): Promise<string> {
  const res = await call('/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(o, false) }, undefined, o.signal);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new BytezError('Bytez returned an empty response.', 500);
  return text;
}

export async function* chatStream(o: ChatOptions): AsyncGenerator<string> {
  const res = await call('/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(o, true) }, undefined, o.signal);
  if (!res.body) {
    yield await chat(o);
    return;
  }
  const reader = res.body.getReader();
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
      if (!payload || payload === '[DONE]') continue;
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) yield delta;
      } catch {
        /* partial frame */
      }
    }
  }
}

export interface BytezModel {
  id: string;
}

export async function listModels(apiKey?: string, signal?: AbortSignal): Promise<BytezModel[]> {
  const res = await call('/models', { method: 'GET' }, apiKey, signal, 2);
  const data = await res.json();
  const rows = Array.isArray(data) ? data : (data.data ?? data.models ?? []);
  return rows
    .map((m: any) => ({ id: typeof m === 'string' ? m : m.id ?? m.model ?? m.name }))
    .filter((m: BytezModel) => !!m.id);
}

/**
 * Bytez documents no structured-output parameter, so JSON has to be coaxed from
 * the prompt and parsed defensively — open models often wrap it in prose or fences.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch {
      /* try next */
    }
  }
  // Fall back to the outermost {...} or [...] block in the reply.
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* keep looking */
      }
    }
  }
  throw new BytezError('Bytez returned malformed JSON. Try again, or pick a larger model in Settings.', 500);
}
