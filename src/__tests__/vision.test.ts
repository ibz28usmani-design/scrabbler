import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canReadImages, generate, imagePart, ProviderError } from '../lib/llm';
import { CompatError, looksMultimodal } from '../lib/openaiCompat';
import { DEFAULT_SETTINGS, updateSettings } from '../lib/settings';

const COMPAT = {
  textProvider: 'compat' as const,
  compatBaseUrl: 'https://example.invalid/v1',
  compatKey: 'k-test',
  compatModel: 'z-ai/glm-5.3-flash',
  compatVision: true,
  apiKey: '',
};

/** A 1x1 PNG, enough to exercise the image path. */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const png = () => ({ inlineData: { mimeType: 'image/png', data: PNG_B64 } });

let sent: { url: string; body: any }[] = [];

function mockFetch(reply = 'transcribed text') {
  return vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init.body ?? '{}')) });
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

beforeEach(() => {
  sent = [];
  updateSettings({ ...DEFAULT_SETTINGS });
});

afterEach(() => {
  vi.unstubAllGlobals();
  updateSettings({ ...DEFAULT_SETTINGS });
});

describe('vision capability detection', () => {
  it('spots models whose names suggest they read images', () => {
    for (const m of ['z-ai/glm-5.3-flash', 'qwen/qwen2.5-vl-7b', 'gpt-4o', 'google/gemma-3-27b', 'mistral/pixtral-12b', 'meta/llama-3.2-11b-vision'])
      expect(looksMultimodal(m), m).toBe(true);
  });

  it('leaves text-only and non-chat models alone', () => {
    for (const m of ['meta/llama-3.1-8b-instruct', 'qwen/qwen3-4b', 'nvidia/nv-embedqa-e5-v5', 'openai/whisper-large', ''])
      expect(looksMultimodal(m), m).toBe(false);
  });

  it('only counts vision when the compat provider is the active one', () => {
    updateSettings({ ...COMPAT, textProvider: 'gemini' });
    expect(canReadImages()).toBe(false);
    updateSettings({ ...COMPAT });
    expect(canReadImages()).toBe(true);
    updateSettings({ ...COMPAT, compatVision: false });
    expect(canReadImages()).toBe(false);
    // A Gemini key is always enough on its own.
    updateSettings({ ...COMPAT, compatVision: false, apiKey: 'AIzaTEST' });
    expect(canReadImages()).toBe(true);
  });
});

describe('routing images to an OpenAI-compatible provider', () => {
  it('sends them as data URLs, after the pages and before the instruction', async () => {
    updateSettings({ ...COMPAT });
    vi.stubGlobal('fetch', mockFetch('Hello from GLM'));
    const out = await generate({ parts: [png(), png()], prompt: 'Transcribe these pages.', temperature: 0 });

    expect(out).toBe('Hello from GLM');
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://example.invalid/v1/chat/completions');
    expect(sent[0].body.model).toBe('z-ai/glm-5.3-flash');
    const content = sent[0].body.messages.at(-1).content;
    expect(content.map((c: any) => c.type)).toEqual(['image_url', 'image_url', 'text']);
    expect(content[0].image_url.url).toBe(`data:image/png;base64,${PNG_B64}`);
    expect(content[2].text).toBe('Transcribe these pages.');
  });

  it('leaves text-only calls as a plain string, which every endpoint accepts', async () => {
    updateSettings({ ...COMPAT });
    vi.stubGlobal('fetch', mockFetch());
    await generate({ prompt: 'Summarise this.' });
    expect(sent[0].body.messages.at(-1).content).toBe('Summarise this.');
  });

  it('refuses images when the model is not marked as reading them', async () => {
    updateSettings({ ...COMPAT, compatVision: false });
    vi.stubGlobal('fetch', mockFetch());
    await expect(generate({ parts: [png()], prompt: 'Read this.' })).rejects.toThrow(ProviderError);
    await expect(generate({ parts: [png()], prompt: 'Read this.' })).rejects.toThrow(/can read images/i);
    expect(sent).toHaveLength(0);
  });

  it('keeps audio, PDFs and uploaded files on Gemini whatever the model claims', async () => {
    updateSettings({ ...COMPAT });
    vi.stubGlobal('fetch', mockFetch());
    const audio = { inlineData: { mimeType: 'audio/mpeg', data: 'AA==' } };
    const pdf = { inlineData: { mimeType: 'application/pdf', data: 'AA==' } };
    const uploaded = { fileData: { mimeType: 'image/png', fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/x' } };
    for (const part of [audio, pdf, uploaded]) {
      await expect(generate({ parts: [part], prompt: 'Read this.' })).rejects.toThrow(/only Gemini/i);
    }
    expect(sent).toHaveLength(0);
  });

  it('keeps tool-backed calls on Gemini even with only text', async () => {
    updateSettings({ ...COMPAT });
    vi.stubGlobal('fetch', mockFetch());
    await expect(generate({ prompt: 'Search the web.', tools: [{ googleSearch: {} }] })).rejects.toThrow(/only Gemini/i);
    expect(sent).toHaveLength(0);
  });

  it('refuses a request too large to send rather than failing opaquely', async () => {
    updateSettings({ ...COMPAT });
    vi.stubGlobal('fetch', mockFetch());
    const huge = { inlineData: { mimeType: 'image/png', data: 'A'.repeat(21 * 1024 * 1024) } };
    await expect(generate({ parts: [huge], prompt: 'Read this.' })).rejects.toThrow(CompatError);
    await expect(generate({ parts: [huge], prompt: 'Read this.' })).rejects.toThrow(/fewer pages|too much/i);
    expect(sent).toHaveLength(0);
  });
});

/** Node has no FileReader; the browser does. Stand one in so blobToBase64 runs. */
class FakeFileReader {
  result = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(blob: Blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type};base64,${Buffer.from(b).toString('base64')}`;
      this.onload?.();
    });
  }
}

describe('imagePart', () => {
  const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  beforeEach(() => vi.stubGlobal('FileReader', FakeFileReader));

  it('inlines for a compat provider, which has no file store to upload to', async () => {
    updateSettings({ ...COMPAT });
    const part = await imagePart(blob(), 'image/png', 'page-1.png');
    expect(part).toEqual({ inlineData: { mimeType: 'image/png', data: 'AQID' } });
  });

  it('defers to Gemini when Gemini is the engine', async () => {
    updateSettings({ ...DEFAULT_SETTINGS, apiKey: 'AIzaTEST' });
    const part = await imagePart(blob(), 'image/png', 'page-1.png');
    // Small blobs stay inline there too, but it is Gemini's own helper deciding.
    expect(part).toHaveProperty('inlineData');
  });
});
