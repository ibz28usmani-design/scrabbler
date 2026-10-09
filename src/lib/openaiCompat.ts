/**
 * A generic client for any OpenAI-compatible Chat Completions endpoint —
 * NVIDIA NIM, Bytez, OpenRouter, Groq, a local server, or a proxy of your own.
 * The base URL, key and model are settings, so switching provider needs no code.
 *
 * Scope: plain text only. Media and web features (transcription, OCR, YouTube,
 * websites, Search grounding, speech) stay on Gemini — see lib/llm.ts.
 */
import { getSettings } from './settings';
import { emitStatus } from './events';

export interface Preset {
  id: string;
  label: string;
  baseUrl: string;
  /** Where the user gets a key. */
  keyUrl: string;
  keyHint: string;
  /** Model to try first; the live model list overrides it after a key test. */
  model: string;
  note?: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'nim',
    label: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    keyUrl: 'https://build.nvidia.com',
    keyHint: 'nvapi-…',
    model: 'zai/glm-5.3-flash',
    note: 'Free tier, rate limited. NVIDIA may refuse calls made from a browser (CORS) — if so, pick OpenRouter or Groq, or use Gemini.',
  },
  {
    id: 'bytez',
    label: 'Bytez',
    baseUrl: 'https://api.bytez.com/models/v2/openai/v1',
    keyUrl: 'https://bytez.com/api',
    keyHint: 'Bytez key',
    model: 'Qwen/Qwen3-4B',
    note: 'Billed per second of inference.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-…',
    model: 'z-ai/glm-4.6',
    note: 'Many models, including free ones. Allows browser calls.',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_…',
    model: 'llama-3.3-70b-versatile',
    note: 'Very fast, generous free tier.',
  },
  { id: 'custom', label: 'Custom…', baseUrl: '', keyUrl: '', keyHint: 'API key', model: '' },
];

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[PRESETS.length - 1];
}

export class CompatError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** A same-origin base URL means a proxy is holding the key for us. */
export function isProxyBase(baseUrl: string): boolean {
  return baseUrl.startsWith('/');
}

export function hasCompatConfig(): boolean {
  const s = getSettings();
  const base = s.compatBaseUrl.trim();
  if (!base) return false;
  return isProxyBase(base) || !!s.compatKey.trim();
}

function config(overrides?: { baseUrl?: string; key?: string }) {
  const s = getSettings();
  const baseUrl = (overrides?.baseUrl ?? s.compatBaseUrl).trim().replace(/\/$/, '');
  const key = (overrides?.key ?? s.compatKey).trim();
  if (!baseUrl) throw new CompatError('Set the API base URL in Settings.', 400);
  if (!key && !isProxyBase(baseUrl)) throw new CompatError('Add your API key in Settings.', 401);
  return { baseUrl, key };
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
  const e = body?.error;
  if (typeof e === 'string') return e;
  return e?.message || body?.message || body?.detail || `${res.status} ${res.statusText}`;
}

async function call(path: string, init: RequestInit, overrides?: { baseUrl?: string; key?: string }, signal?: AbortSignal, attempts = 3): Promise<Response> {
  const { baseUrl, key } = config(overrides);
  for (let i = 0; i < attempts; i++) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        ...init,
        signal,
        headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(init.headers ?? {}) },
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      if (i === attempts - 1) {
        // A CORS rejection reaches JavaScript as an opaque TypeError, indistinguishable
        // from the network being down — so say both are possible.
        throw new CompatError(
          isProxyBase(baseUrl)
            ? 'Could not reach your proxy. Check that its address is right and that it is running.'
            : 'Could not reach the API. Either you are offline, or this provider blocks calls from browsers (CORS) — try OpenRouter, Groq or Gemini instead.',
          0,
        );
      }
      await sleep(1200 * (i + 1), signal);
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
    if (res.status === 401 || res.status === 403) throw new CompatError(`The API rejected the key: ${msg}`, res.status);
    if (res.status === 404) throw new CompatError(`Not found — check the base URL and model name. (${msg})`, 404);
    if ((res.status === 429 || res.status >= 500) && i < attempts - 1) {
      emitStatus(res.status === 429 ? 'Rate limited — retrying shortly…' : 'The model is warming up — retrying…');
      await sleep(4000 * (i + 1), signal);
      continue;
    }
    if (res.status === 429) throw new CompatError('Rate limit reached. Wait a moment and try again.', 429);
    throw new CompatError(msg, res.status);
  }
  throw new CompatError('Request failed.', 0);
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
  const model = o.model || getSettings().compatModel;
  if (!model) throw new CompatError('Pick a model in Settings.', 400);
  return JSON.stringify({
    model,
    messages: o.messages,
    ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
    max_tokens: o.maxTokens ?? 4096,
    ...(stream ? { stream: true } : {}),
  });
}

/** Some models emit chain-of-thought in a separate field or in <think> tags. */
function clean(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export async function chat(o: ChatOptions): Promise<string> {
  const res = await call('/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(o, false) }, undefined, o.signal);
  const data = await res.json();
  const text = clean(data?.choices?.[0]?.message?.content ?? '');
  if (!text) throw new CompatError('The model returned an empty response.', 500);
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
  let thinking = false;
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
        if (typeof delta !== 'string' || !delta) continue;
        // Drop reasoning spans rather than showing them as the answer.
        if (delta.includes('<think>')) thinking = true;
        if (thinking) {
          if (delta.includes('</think>')) thinking = false;
          continue;
        }
        yield delta;
      } catch {
        /* partial frame */
      }
    }
  }
}

export async function listModels(overrides?: { baseUrl?: string; key?: string }, signal?: AbortSignal): Promise<string[]> {
  const res = await call('/models', { method: 'GET' }, overrides, signal, 2);
  const data = await res.json();
  const rows = Array.isArray(data) ? data : (data.data ?? data.models ?? []);
  return rows.map((m: any) => (typeof m === 'string' ? m : m.id ?? m.name)).filter(Boolean);
}

/** Prefers a model matching the preset's suggestion, then anything chat-like. */
export function pickModel(models: string[], wanted: string): string {
  if (!models.length) return wanted;
  if (wanted && models.includes(wanted)) return wanted;
  if (wanted) {
    const stem = wanted.split('/').pop()!.toLowerCase();
    const near = models.find((m) => m.toLowerCase().includes(stem));
    if (near) return near;
    const family = stem.split(/[-.]/)[0];
    if (family.length > 2) {
      const sameFamily = models.find((m) => m.toLowerCase().includes(family));
      if (sameFamily) return sameFamily;
    }
  }
  return models[0];
}

/**
 * No OpenAI-compatible guarantee of schema-constrained output across providers,
 * so JSON is requested in the prompt and parsed defensively.
 */
export function extractJson(text: string): unknown {
  const body = clean(text);
  const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  for (const c of [fenced?.[1], body].filter(Boolean) as string[]) {
    try {
      return JSON.parse(c.trim());
    } catch {
      /* try next */
    }
  }
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = body.indexOf(open);
    const end = body.lastIndexOf(close);
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        /* keep looking */
      }
    }
  }
  throw new CompatError('The model returned malformed JSON. Try again, or pick a larger model in Settings.', 500);
}
