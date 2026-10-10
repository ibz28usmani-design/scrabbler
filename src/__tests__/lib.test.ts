import { describe, expect, it } from 'vitest';
import { bm25, chunkText, citedNumbers, selectChunks } from '../lib/retrieval';
import { clozeAnswers, clozeBack, clozeFront, levelFor, newSched, nextSched, previewIntervals, Rating, refill, similarity, streakFrom, MAX_LIVES, LIFE_REFILL_MS } from '../lib/study';
import { parseCsvRows, parseDelimited, stripHtml } from '../lib/importers';
import { salvageSegments } from '../lib/ai';
import { parseClock, fmtClock, prevDay } from '../lib/dates';
import { youtubeId } from '../lib/sources';

describe('retrieval', () => {
  it('chunks long text and keeps page numbers', () => {
    const para = 'Photosynthesis converts light energy into chemical energy. '.repeat(40);
    const chunks = chunkText([{ page: 3, text: `${para}\n\n${para}` }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.page === 3 && c.text.length <= 1600)).toBe(true);
  });

  it('ranks the relevant chunk first', () => {
    const docs = [
      { id: 'a', text: 'The mitochondria is the powerhouse of the cell and produces ATP.' },
      { id: 'b', text: 'The French Revolution began in 1789 with the storming of the Bastille.' },
      { id: 'c', text: 'Chloroplasts perform photosynthesis in plant cells.' },
    ];
    expect(bm25(docs, 'what produces ATP in cells?')[0].doc.id).toBe('a');
    expect(bm25(docs, 'Bastille revolution')[0].doc.id).toBe('b');
  });

  it('sends small corpora whole and trims big ones', () => {
    const small = [{ id: '1', sourceId: 's', idx: 0, text: 'hello world' }];
    expect(selectChunks(small, 'x')).toHaveLength(1);
    const big = Array.from({ length: 300 }, (_, i) => ({ id: String(i), sourceId: 's' + (i % 3), idx: Math.floor(i / 3), text: (i === 150 ? 'quantum entanglement ' : 'filler text about nothing ') .repeat(40) }));
    const picked = selectChunks(big, 'quantum entanglement', 20_000, 10);
    expect(picked.length).toBeLessThan(big.length);
    expect(picked.some((c) => c.id === '150')).toBe(true);
  });

  it('parses citation markers including lists and ranges', () => {
    expect(citedNumbers('A [1]. B [2, 4]. C [6–8].').sort((a, b) => a - b)).toEqual([1, 2, 4, 6, 7, 8]);
  });
});

describe('study engine', () => {
  it('schedules a good review further out than again', () => {
    const s = newSched(new Date('2026-01-01T10:00:00Z'));
    const now = new Date('2026-01-01T10:00:00Z');
    const good = nextSched(s, Rating.Good, now);
    const again = nextSched(s, Rating.Again, now);
    expect(good.due).toBeGreaterThan(again.due);
    expect(Object.keys(previewIntervals(s, now))).toHaveLength(4);
  });

  it('computes levels', () => {
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(100).level).toBe(2);
    expect(levelFor(299).level).toBe(2);
    expect(levelFor(300).level).toBe(3);
  });

  it('refills lives over time', () => {
    const t = 1_000_000;
    const g = refill({ xp: 0, lives: 2, livesAt: t, bestStreak: 0 }, t + LIFE_REFILL_MS * 2 + 5);
    expect(g.lives).toBe(4);
    expect(refill({ xp: 0, lives: 0, livesAt: t, bestStreak: 0 }, t + LIFE_REFILL_MS * 99).lives).toBe(MAX_LIVES);
  });

  it('counts streaks of days meeting the goal', () => {
    const today = '2026-03-10';
    const m = new Map([
      [today, 20],
      [prevDay(today), 25],
      [prevDay(prevDay(today)), 3],
    ]);
    expect(streakFrom(m, 20, today)).toEqual({ days: 2, todayCount: 20, todayMet: true });
    const m2 = new Map([[prevDay(today), 30]]);
    expect(streakFrom(m2, 20, today).days).toBe(1); // today not met yet, streak alive
  });

  it('handles cloze text', () => {
    const t = 'The {{c1::mitochondria}} makes {{c2::ATP::energy}}.';
    expect(clozeFront(t)).toBe('The […] makes [energy].');
    expect(clozeBack(t)).toBe('The ⟦mitochondria⟧ makes ⟦ATP⟧.');
    expect(clozeAnswers(t)).toEqual(['mitochondria', 'ATP']);
  });

  it('fuzzy-matches typed answers', () => {
    expect(similarity('The Mitochondria', 'mitochondria')).toBe(1);
    expect(similarity('mitocondria', 'mitochondria')).toBeGreaterThan(0.85);
    expect(similarity('ribosome', 'mitochondria')).toBeLessThan(0.5);
  });
});

describe('importers', () => {
  it('parses Quizlet tab-separated exports', () => {
    const cards = parseDelimited('cat\tgato\ndog\tperro\n\nbad', '\\t', '\\n');
    expect(cards).toEqual([
      { type: 'basic', front: 'cat', back: 'gato' },
      { type: 'basic', front: 'dog', back: 'perro' },
    ]);
  });

  it('parses quoted CSV with commas and newlines', () => {
    expect(parseCsvRows('"a, b",c\n"line1\nline2","x ""q"""')).toEqual([
      ['a, b', 'c'],
      ['line1\nline2', 'x "q"'],
    ]);
    expect(parseDelimited('"Term, one",Def\nT2,D2', ',', '\\n')).toHaveLength(2);
  });

  it('auto-detects separators and cloze cards', () => {
    const cards = parseDelimited('The {{c1::sun}} is a star - astronomy\nH2O - water', 'auto', '\\n');
    expect(cards[0].type).toBe('cloze');
    expect(cards[1]).toEqual({ type: 'basic', front: 'H2O', back: 'water' });
  });

  it('strips Anki HTML', () => {
    expect(stripHtml('<b>Hi</b><br>there&nbsp;[sound:a.mp3]<img src="x.png">')).toBe('Hi\nthere');
  });
});

describe('misc', () => {
  it('salvages truncated transcript JSON', () => {
    const t = '[{"start":"00:01","speaker":"A","text":"Hello"},{"start":"00:05","speaker":"A","text":"Wor';
    expect(salvageSegments(t)).toHaveLength(1);
    expect(salvageSegments('[{"start":"0:01","text":"x"}]')).toHaveLength(1);
  });

  it('parses clocks', () => {
    expect(parseClock('01:30')).toBe(90);
    expect(parseClock('1:02:03')).toBe(3723);
    expect(fmtClock(3723)).toBe('1:02:03');
  });

  it('extracts YouTube ids', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://example.com')).toBeNull();
  });
});

describe('openai-compatible provider', () => {
  it('parses plain, fenced and prose-wrapped JSON', async () => {
    const { extractJson } = await import('../lib/openaiCompat');
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Sure! Here you go:\n{"cards":[{"front":"q"}]}\nHope that helps.')).toEqual({ cards: [{ front: 'q' }] });
    expect(extractJson('Here is the list: [1,2,3]')).toEqual([1, 2, 3]);
  });

  it('strips reasoning spans before parsing', async () => {
    const { extractJson } = await import('../lib/openaiCompat');
    expect(extractJson('<think>Let me plan this out.</think>{"ok":true}')).toEqual({ ok: true });
  });

  it('throws a useful error on unparseable output', async () => {
    const { extractJson } = await import('../lib/openaiCompat');
    expect(() => extractJson('I cannot do that.')).toThrow(/malformed JSON/i);
  });

  it('picks the closest model to the preset suggestion', async () => {
    const { pickModel } = await import('../lib/openaiCompat');
    const models = ['meta/llama-3.1-8b', 'z-ai/glm-5.3-flash', 'qwen/qwen3-4b'];
    expect(pickModel(models, 'z-ai/glm-5.3-flash')).toBe('z-ai/glm-5.3-flash');
    // Exact id missing: fall back to the same name under another org prefix.
    expect(pickModel(['zai-org/glm-5.3-flash', 'meta/llama-3.1-8b'], 'z-ai/glm-5.3-flash')).toBe('zai-org/glm-5.3-flash');
    // Then to the same family.
    expect(pickModel(['zai/glm-4.7', 'meta/llama-3.1-8b'], 'z-ai/glm-5.3-flash')).toBe('zai/glm-4.7');
    // Nothing similar: first available, never an unusable empty string.
    expect(pickModel(['meta/llama-3.1-8b'], 'z-ai/glm-5.3-flash')).toBe('meta/llama-3.1-8b');
    expect(pickModel([], 'z-ai/glm-5.3-flash')).toBe('z-ai/glm-5.3-flash');
  });

  it('treats a same-origin base URL as a proxy that needs no key', async () => {
    const { isProxyBase } = await import('../lib/openaiCompat');
    expect(isProxyBase('/llm')).toBe(true);
    expect(isProxyBase('https://integrate.api.nvidia.com/v1')).toBe(false);
  });
});
