/**
 * Routes text generation to the chosen provider.
 *
 * Gemini is the default and remains mandatory for anything multimodal or
 * tool-backed — YouTube ingestion, website fetching, Search grounding, audio
 * transcription, PDF/handwriting OCR and speech. Bytez (open-source models) can
 * take over the plain-text work: chat answers, studio documents, flashcards,
 * lecture write-ups and the writing tools.
 */
import * as gemini from './gemini';
import * as bytez from './bytez';
import { getSettings } from './settings';

export type TextProvider = 'gemini' | 'bytez';

export function textProvider(): TextProvider {
  return getSettings().textProvider === 'bytez' ? 'bytez' : 'gemini';
}

/** True when the selected text engine is usable. */
export function hasTextKey(): boolean {
  return textProvider() === 'bytez' ? bytez.hasBytezKey() : gemini.hasKey();
}

/** Gemini-only capabilities (vision, audio, files, Google tools). */
export function hasGeminiKey(): boolean {
  return gemini.hasKey();
}

export class ProviderError extends Error {}

/** A call needs Gemini when it carries tools or any non-text part. */
function needsGemini(o: gemini.GenerateOptions): boolean {
  if (o.tools?.length) return true;
  const parts = [...(o.parts ?? []), ...(o.contents ?? []).flatMap((c) => c.parts)];
  return parts.some((p) => !('text' in p));
}

function requireGemini(): void {
  if (!gemini.hasKey()) {
    throw new ProviderError('This feature reads files, audio or the web, which only Gemini can do here. Add a Gemini key in Settings.');
  }
}

/** Flattens Gemini-shaped options into OpenAI-style chat messages. */
function toMessages(o: gemini.GenerateOptions): bytez.ChatMessage[] {
  const msgs: bytez.ChatMessage[] = [];
  if (o.system) msgs.push({ role: 'system', content: o.system });
  for (const c of o.contents ?? []) {
    const text = c.parts.map((p) => ('text' in p ? p.text : '')).join('').trim();
    if (text) msgs.push({ role: c.role === 'model' ? 'assistant' : 'user', content: text });
  }
  const tail = [...(o.parts ?? []).map((p) => ('text' in p ? p.text : '')), o.prompt ?? ''].filter(Boolean).join('\n\n');
  if (tail) msgs.push({ role: 'user', content: tail });
  if (!msgs.some((m) => m.role === 'user')) msgs.push({ role: 'user', content: tail || '…' });
  return msgs;
}

export async function generate(o: gemini.GenerateOptions): Promise<string> {
  if (needsGemini(o)) {
    requireGemini();
    return gemini.generate(o);
  }
  if (textProvider() === 'gemini') return gemini.generate(o);
  return bytez.chat({ messages: toMessages(o), temperature: o.temperature, maxTokens: o.maxOutputTokens, signal: o.signal });
}

/**
 * Bytez documents no schema-constrained output, so the schema is described in
 * the prompt and the reply is parsed defensively.
 */
export async function generateJSON<T>(o: gemini.GenerateOptions & { schema: object }): Promise<T> {
  if (needsGemini(o) || textProvider() === 'gemini') {
    if (needsGemini(o)) requireGemini();
    return gemini.generateJSON<T>(o);
  }
  const messages = toMessages(o);
  messages.unshift({
    role: 'system',
    content: `You reply with a single JSON value and nothing else — no prose, no code fences. It must validate against this JSON schema:\n${JSON.stringify(o.schema)}`,
  });
  const text = await bytez.chat({ messages, temperature: o.temperature, maxTokens: o.maxOutputTokens, signal: o.signal });
  return bytez.extractJson(text) as T;
}

export async function* stream(o: gemini.GenerateOptions): AsyncGenerator<string> {
  if (needsGemini(o)) {
    requireGemini();
    yield* gemini.stream(o);
    return;
  }
  if (textProvider() === 'gemini') {
    yield* gemini.stream(o);
    return;
  }
  yield* bytez.chatStream({ messages: toMessages(o), temperature: o.temperature, maxTokens: o.maxOutputTokens, signal: o.signal });
}
