import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generate, isRetiredModel, GeminiError } from '../lib/gemini';
import { DEFAULT_SETTINGS, getSettings, updateSettings } from '../lib/settings';

const LISTED = ['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-2.5-flash-lite'];
const RETIRED = 'models/gemini-2.5-flash is no longer available to new users. Please use gemini-3.8-flash instead.';

let calls: string[] = [];

/** Google as seen by a new key: every model listed, but the ones in `refused` turned away. */
function google(refused: string[]) {
  return vi.fn(async (url: string) => {
    calls.push(String(url));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (/\/models\?/.test(url)) return json({ models: LISTED.map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) });
    const model = decodeURIComponent(/models\/([^:]+):/.exec(url)![1]);
    if (refused.includes(model)) return json({ error: { message: RETIRED.replace('gemini-2.5-flash', model) } }, 404);
    return json({ candidates: [{ content: { parts: [{ text: `hello from ${model}` }] }, finishReason: 'STOP' }] });
  });
}

beforeEach(() => {
  calls = [];
  updateSettings({ ...DEFAULT_SETTINGS, apiKey: 'AIzaTEST' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  updateSettings({ ...DEFAULT_SETTINGS });
});

describe('retired model fallback', () => {
  it('switches to the newest model and finishes the request', async () => {
    vi.stubGlobal('fetch', google(['gemini-2.5-flash']));
    expect(await generate({ prompt: 'hi' })).toBe('hello from gemini-3.8-flash');
    expect(getSettings().textModel).toBe('gemini-3.8-flash');
    // Later requests go straight to the new model.
    calls = [];
    await generate({ prompt: 'again' });
    expect(calls).toHaveLength(1);
  });

  it('lets requests that hit the retired model together all finish', async () => {
    vi.stubGlobal('fetch', google(['gemini-2.5-flash']));
    const replies = await Promise.all([generate({ prompt: 'a' }), generate({ prompt: 'b' }), generate({ prompt: 'c' })]);
    expect(replies).toEqual(Array(3).fill('hello from gemini-3.8-flash'));
    expect(calls.filter((u) => /\/models\?/.test(u)).length).toBeLessThanOrEqual(1);
  });

  it('moves a retired pick outside the family onto the newest flash', async () => {
    updateSettings({ textModel: 'gemini-2.5-flash-lite' });
    vi.stubGlobal('fetch', google(['gemini-2.5-flash-lite']));
    expect(await generate({ prompt: 'hi' })).toBe('hello from gemini-3.8-flash');
  });

  it('gives up with the original error when there is nothing newer', async () => {
    updateSettings({ textModel: 'gemini-3.8-flash' });
    vi.stubGlobal('fetch', google(['gemini-3.8-flash']));
    await expect(generate({ prompt: 'hi' })).rejects.toThrow(/gemini-3.8-flash is no longer available/);
    expect(getSettings().textModel).toBe('gemini-3.8-flash');
  });

  it('leaves a model the caller chose for itself alone', async () => {
    vi.stubGlobal('fetch', google(['gemini-2.5-flash-lite']));
    await expect(generate({ prompt: 'hi', model: 'gemini-2.5-flash-lite' })).rejects.toThrow(/no longer available/);
    expect(calls.some((u) => /\/models\?/.test(u))).toBe(false);
  });

  it('tells a retired model apart from an ordinary bad request', () => {
    expect(isRetiredModel(new GeminiError('models/x is not found for API version v1beta', 404), 'x')).toBe(true);
    expect(isRetiredModel(new GeminiError('File abc not found', 404), 'gemini-2.5-flash')).toBe(false);
    expect(isRetiredModel(new GeminiError('Model gemini-x is not supported for generateContent.', 400), 'gemini-y')).toBe(true);
    expect(isRetiredModel(new GeminiError('Request contains an invalid argument.', 400), 'gemini-2.5-flash')).toBe(false);
    expect(isRetiredModel(new GeminiError('Free-tier quota reached', 429), 'gemini-2.5-flash')).toBe(false);
  });
});
