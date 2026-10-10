/**
 * Routes generation to the chosen provider.
 *
 * Gemini is the default and stays mandatory for audio, PDFs, files it has
 * already uploaded, and anything tool-backed — YouTube ingestion, website
 * fetching, Search grounding, speech. An OpenAI-compatible provider can take
 * the plain-text work, and, when its model reads images, handwriting too.
 */
import * as gemini from './gemini';
import * as compat from './openaiCompat';
import { getSettings } from './settings';

export type TextProvider = 'gemini' | 'compat';

export function textProvider(): TextProvider {
  return getSettings().textProvider === 'compat' ? 'compat' : 'gemini';
}

/** True when the selected text engine is usable. */
export function hasTextKey(): boolean {
  return textProvider() === 'compat' ? compat.hasCompatConfig() : gemini.hasKey();
}

/** Gemini-only capabilities (audio, PDFs, uploaded files, Google tools). */
export function hasGeminiKey(): boolean {
  return gemini.hasKey();
}

/** The active provider is a compat endpoint whose model reads images. */
function compatSeesImages(): boolean {
  return textProvider() === 'compat' && compat.supportsVision();
}

/** Whether anything here can read an image — Gemini, or a compat model with vision on. */
export function canReadImages(): boolean {
  return gemini.hasKey() || compatSeesImages();
}

export class ProviderError extends Error {}

const isImage = (p: gemini.Part): p is { inlineData: { mimeType: string; data: string } } =>
  'inlineData' in p && p.inlineData.mimeType.startsWith('image/');

function allParts(o: gemini.GenerateOptions): gemini.Part[] {
  return [...(o.parts ?? []), ...(o.contents ?? []).flatMap((c) => c.parts)];
}

/**
 * A call needs Gemini when it carries tools, or media no OpenAI-compatible
 * endpoint can take: audio, PDFs, and fileData, which is a URI inside Gemini's
 * own File API and meaningless anywhere else. Images are the exception — they
 * travel as data URLs, so a vision-capable compat model can have them.
 */
function needsGemini(o: gemini.GenerateOptions): boolean {
  if (o.tools?.length) return true;
  const parts = allParts(o);
  if (parts.some((p) => !('text' in p) && !isImage(p))) return true;
  return parts.some(isImage) && !compatSeesImages();
}

function requireGemini(o?: gemini.GenerateOptions): void {
  if (gemini.hasKey()) return;
  const imagesOnly = !!o && !o.tools?.length && allParts(o).every((p) => 'text' in p || isImage(p));
  throw new ProviderError(
    imagesOnly
      ? 'Reading images needs either a Gemini key, or a text provider whose model reads images — turn on "This model can read images" in Settings.'
      : 'This feature reads files, audio or the web, which only Gemini can do here. Add a Gemini key in Settings.',
  );
}

/**
 * A part for an image, shaped for whichever provider will receive it. Gemini
 * may hand a large file to its File API; a compat provider has no such thing,
 * so the bytes always travel inline.
 */
export async function imagePart(blob: Blob, mimeType: string, name: string, signal?: AbortSignal): Promise<gemini.Part> {
  if (compatSeesImages()) return { inlineData: { mimeType, data: await gemini.blobToBase64(blob) } };
  return gemini.blobPart(blob, mimeType, name, signal);
}

/**
 * Turns Gemini-shaped parts into OpenAI message content, keeping the original
 * order so an instruction still follows the pages it refers to. Plain text
 * stays a plain string, which every endpoint accepts; only a message carrying
 * an image needs the array form.
 */
function toContent(parts: gemini.Part[], trailingText = ''): string | compat.ContentPart[] {
  const out: compat.ContentPart[] = [];
  const pushText = (text: string) => {
    if (!text.trim()) return;
    const last = out[out.length - 1];
    if (last?.type === 'text') last.text += `\n\n${text}`;
    else out.push({ type: 'text', text });
  };
  for (const p of parts) {
    if ('text' in p) pushText(p.text);
    else if (isImage(p)) out.push({ type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } });
  }
  pushText(trailingText);
  if (out.every((c) => c.type === 'text')) return out.map((c) => (c as { text: string }).text).join('\n\n');
  return out;
}

const isEmpty = (c: string | compat.ContentPart[]) => (typeof c === 'string' ? !c.trim() : !c.length);

function toMessages(o: gemini.GenerateOptions): compat.ChatMessage[] {
  const msgs: compat.ChatMessage[] = [];
  if (o.system) msgs.push({ role: 'system', content: o.system });
  for (const c of o.contents ?? []) {
    const content = toContent(c.parts);
    if (!isEmpty(content)) msgs.push({ role: c.role === 'model' ? 'assistant' : 'user', content });
  }
  const tail = toContent(o.parts ?? [], o.prompt ?? '');
  if (!isEmpty(tail)) msgs.push({ role: 'user', content: tail });
  if (!msgs.some((m) => m.role === 'user')) msgs.push({ role: 'user', content: '…' });
  return msgs;
}

export async function generate(o: gemini.GenerateOptions): Promise<string> {
  if (needsGemini(o)) {
    requireGemini(o);
    return gemini.generate(o);
  }
  if (textProvider() === 'gemini') return gemini.generate(o);
  return compat.chat({ messages: toMessages(o), temperature: o.temperature, maxTokens: o.maxOutputTokens, signal: o.signal });
}

/**
 * Not every OpenAI-compatible provider supports schema-constrained output, so the
 * schema is described in the prompt and the reply is parsed defensively.
 */
export async function generateJSON<T>(o: gemini.GenerateOptions & { schema: object }): Promise<T> {
  if (needsGemini(o) || textProvider() === 'gemini') {
    if (needsGemini(o)) requireGemini(o);
    return gemini.generateJSON<T>(o);
  }
  const messages = toMessages(o);
  messages.unshift({
    role: 'system',
    content: `You reply with a single JSON value and nothing else — no prose, no code fences. It must validate against this JSON schema:\n${JSON.stringify(o.schema)}`,
  });
  const text = await compat.chat({ messages, temperature: o.temperature, maxTokens: o.maxOutputTokens, signal: o.signal });
  return compat.extractJson(text) as T;
}

export async function* stream(o: gemini.GenerateOptions): AsyncGenerator<string> {
  if (needsGemini(o)) {
    requireGemini(o);
    yield* gemini.stream(o);
    return;
  }
  if (textProvider() === 'gemini') {
    yield* gemini.stream(o);
    return;
  }
  yield* compat.chatStream({ messages: toMessages(o), temperature: o.temperature, maxTokens: o.maxOutputTokens, signal: o.signal });
}
