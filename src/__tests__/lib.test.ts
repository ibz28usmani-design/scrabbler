import { describe, expect, it } from 'vitest';
import { bm25, chunkText, citedNumbers, selectChunks } from '../lib/retrieval';
import { clozeAnswers, clozeBack, clozeFront, levelFor, newSched, nextSched, previewIntervals, Rating, refill, similarity, streakFrom, MAX_LIVES, LIFE_REFILL_MS } from '../lib/study';
import { parseCsvRows, parseDelimited, stripHtml } from '../lib/importers';
import { salvageSegments } from '../lib/ai';
import { parseClock, fmtClock, groupLabel, prevDay } from '../lib/dates';
import { youtubeId } from '../lib/sources';
import { modelUpgrades, newestModel } from '../lib/gemini';

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
    expect(fmtClock(NaN)).toBe('0:00');
    expect(fmtClock(Infinity)).toBe('0:00');
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

describe('settings migration', () => {
  it('carries a single saved place into both orientations', async () => {
    const { migrate, DEFAULT_SETTINGS } = await import('../lib/settings');
    const m = migrate({ ...DEFAULT_SETTINGS, inkToolbarEdge: 'left' as never, inkToolbarSpot: 'bl' as never });
    expect(m.inkToolbarEdge).toEqual({ portrait: 'left', landscape: 'left' });
    expect(m.inkToolbarSpot).toEqual({ portrait: 'bl', landscape: 'bl' });
  });

  it('moves a tucked circle off a side and into the nearest corner', async () => {
    const { migrate, DEFAULT_SETTINGS } = await import('../lib/settings');
    const at = (spot: string) => migrate({ ...DEFAULT_SETTINGS, inkToolbarSpot: spot as never }).inkToolbarSpot.portrait;
    expect(at('left')).toBe('tl');
    expect(at('right')).toBe('tr');
    expect(at('top')).toBe('tr');
    expect(at('bottom')).toBe('br');
  });

  it('keeps the two orientations apart, and falls back on nonsense', async () => {
    const { migrate, DEFAULT_SETTINGS } = await import('../lib/settings');
    const m = migrate({
      ...DEFAULT_SETTINGS,
      inkToolbarEdge: { portrait: 'bottom', landscape: 'left' },
      inkToolbarSpot: { portrait: 'bl', landscape: 'oops' as never },
    });
    expect(m.inkToolbarEdge).toEqual({ portrait: 'bottom', landscape: 'left' });
    expect(m.inkToolbarSpot).toEqual({ portrait: 'bl', landscape: 'tr' });
  });

  it('leaves the rest of the settings alone', async () => {
    const { migrate, DEFAULT_SETTINGS } = await import('../lib/settings');
    const kept = migrate({ ...DEFAULT_SETTINGS, apiKey: 'AIzaX' });
    expect(kept.apiKey).toBe('AIzaX');
  });
});

describe('where the ink palette settles', () => {
  const W = 1194;
  const H = 790;

  it('centres on whichever edge the drop was nearest', async () => {
    const { placeAt } = await import('../components/InkToolbar');
    expect(placeAt(20, H / 2, W, H).edge).toBe('left');
    expect(placeAt(W - 20, H / 2, W, H).edge).toBe('right');
    expect(placeAt(W / 2, 14, W, H).edge).toBe('top');
    expect(placeAt(W / 2, H - 14, W, H).edge).toBe('bottom');
  });

  it('reaches all four corners, bottom ones included', async () => {
    const { placeAt } = await import('../components/InkToolbar');
    const I = 30;
    expect(placeAt(I, I, W, H)).toMatchObject({ corner: 'tl', inCorner: true });
    expect(placeAt(W - I, I, W, H)).toMatchObject({ corner: 'tr', inCorner: true });
    expect(placeAt(I, H - I, W, H)).toMatchObject({ corner: 'bl', inCorner: true });
    expect(placeAt(W - I, H - I, W, H)).toMatchObject({ corner: 'br', inCorner: true });
  });

  it('does not tuck away a drop in the middle of an edge', async () => {
    const { placeAt } = await import('../components/InkToolbar');
    for (const [x, y] of [
      [10, H / 2],
      [W - 10, H / 2],
      [W / 2, 10],
      [W / 2, H - 10],
    ])
      expect(placeAt(x, y, W, H).inCorner, `${x},${y}`).toBe(false);
  });

  it('names the nearest corner even for a drop nowhere near one', async () => {
    const { placeAt } = await import('../components/InkToolbar');
    // A cancelled pointer settles wherever it last was; the circle lives in the
    // corners, so every position has to name one.
    expect(placeAt(W / 2 + 1, H / 2 + 1, W, H).corner).toBe('br');
    expect(placeAt(W / 2 - 1, H / 2 - 1, W, H).corner).toBe('tl');
  });
});

describe('the ruler', () => {
  const flat = { on: true, x: 500, y: 400, angle: 0 };

  it('measures across itself, signed, so each side keeps its own edge', async () => {
    const { rulerFrame } = await import('../lib/ink');
    expect(rulerFrame(flat, 600, 400)).toMatchObject({ t: 100, n: 0 });
    expect(rulerFrame(flat, 500, 430).n).toBeCloseTo(30);
    expect(rulerFrame(flat, 500, 370).n).toBeCloseTo(-30);
    const upright = { ...flat, angle: 90 };
    expect(rulerFrame(upright, 500, 500).t).toBeCloseTo(100);
    expect(rulerFrame(upright, 540, 400).n).toBeCloseTo(-40);
  });

  it('lands a stroke on the edge nearest the hand, not down the middle', async () => {
    const { snapToRuler, RULER_HALF_W } = await import('../lib/ink');
    // Below it: the lower edge, however far off the line the hand wandered.
    const below = snapToRuler(flat, 620, 455);
    expect(below.x).toBeCloseTo(620);
    expect(below.y).toBeCloseTo(400 + RULER_HALF_W);
    // Above it: the upper edge.
    expect(snapToRuler(flat, 620, 352).y).toBeCloseTo(400 - RULER_HALF_W);
    // Drawn across the body, it still takes an edge rather than the centre.
    expect(Math.abs(snapToRuler(flat, 500, 405).y - 400)).toBe(RULER_HALF_W);
  });

  it('turns a wobble into a straight line', async () => {
    const { snapToRuler } = await import('../lib/ink');
    const wobble = [
      [300, 436],
      [400, 441],
      [500, 429],
      [600, 438],
    ];
    const ys = wobble.map(([x, y]) => snapToRuler(flat, x, y).y);
    expect(new Set(ys).size).toBe(1);
  });

  it('only catches strokes that start within reach, and never when put away', async () => {
    const { rulerCatches, RULER_SNAP } = await import('../lib/ink');
    expect(rulerCatches(flat, 500, 400 + RULER_SNAP - 1)).toBe(true);
    expect(rulerCatches(flat, 500, 400 + RULER_SNAP + 1)).toBe(false);
    expect(rulerCatches({ ...flat, on: false }, 500, 400)).toBe(false);
  });

  it('gives the ends to a turn and the body to a shove, and the page to neither', async () => {
    const { rulerGrab, rulerEnds } = await import('../lib/ink');
    const [a, b] = rulerEnds(flat);
    expect(rulerGrab(flat, a.x, a.y)).toBe('rotate');
    expect(rulerGrab(flat, b.x, b.y)).toBe('rotate');
    expect(rulerGrab(flat, 500, 400)).toBe('move');
    expect(rulerGrab(flat, 500, 600)).toBeNull();
    // Past the end of the ruler is the page, not the ruler.
    expect(rulerGrab(flat, b.x + 120, b.y)).toBeNull();
    expect(rulerGrab({ ...flat, on: false }, 500, 400)).toBeNull();
  });

  it('settles on the angles a hand is aiming for, and leaves the rest alone', async () => {
    const { tidyAngle } = await import('../lib/ink');
    expect(tidyAngle(1.4)).toBe(0);
    expect(tidyAngle(44)).toBe(45);
    expect(tidyAngle(91.8)).toBe(90);
    expect(tidyAngle(-1)).toBe(0);
    expect(tidyAngle(179)).toBe(0);
    expect(tidyAngle(37)).toBe(37);
    expect(tidyAngle(200)).toBe(20);
  });
});

describe('the pixel eraser', () => {
  /** A flat 300-unit line at y=100, sampled every 10 units. */
  const flat = { t: 'pen' as const, c: '#1f1f1f', s: 3, p: Array.from({ length: 31 }, (_, i) => [100 + i * 10, 100, 0.5]).flat() };

  it('leaves a stroke it never reached entirely alone', async () => {
    const { erasePixels } = await import('../lib/ink');
    expect(erasePixels(flat, 200, 400, 20)).toBeNull();
    // Just outside the nib plus half the stroke's own width.
    expect(erasePixels(flat, 200, 100 + 20 + 3, 20)).toBeNull();
  });

  it('cuts a stroke in two where the nib crosses it', async () => {
    const { erasePixels } = await import('../lib/ink');
    const left = erasePixels(flat, 250, 100, 20)!;
    expect(left).toHaveLength(2);
    const xs = (st: { p: number[] }) => st.p.filter((_, i) => i % 3 === 0);
    // The gap is the nib, and nothing survives inside it.
    expect(Math.max(...xs(left[0]))).toBeLessThan(250 - 20);
    expect(Math.min(...xs(left[1]))).toBeGreaterThan(250 + 20);
    // The far ends are untouched.
    expect(Math.min(...xs(left[0]))).toBe(100);
    expect(Math.max(...xs(left[1]))).toBe(400);
  });

  it('takes an end off rather than splitting, when it rubs at an end', async () => {
    const { erasePixels } = await import('../lib/ink');
    const left = erasePixels(flat, 100, 100, 30)!;
    expect(left).toHaveLength(1);
    expect(Math.min(...left[0].p.filter((_, i) => i % 3 === 0))).toBeGreaterThan(129);
  });

  it('erases a short stroke to nothing rather than leaving a speck', async () => {
    const { erasePixels } = await import('../lib/ink');
    const dot = { ...flat, p: [200, 200, 0.5, 203, 201, 0.5] };
    expect(erasePixels(dot, 200, 200, 25)).toEqual([]);
  });

  it('cuts a ruled line, which has points too far apart to catch by point alone', async () => {
    const { erasePixels } = await import('../lib/ink');
    // Two points, 600 apart: a nib in the middle touches neither of them.
    const ruled = { ...flat, p: [100, 100, 0.5, 700, 100, 0.5] };
    const left = erasePixels(ruled, 400, 100, 25)!;
    expect(left).toHaveLength(2);
    expect(Math.max(...left[0].p.filter((_, i) => i % 3 === 0))).toBeCloseTo(400 - 25 - 1.5, 0);
  });

  it('keeps the stroke it did not touch when rubbing across a page of them', async () => {
    const { erasePixelsAll } = await import('../lib/ink');
    const other = { ...flat, p: [100, 800, 0.5, 400, 800, 0.5] };
    const out = erasePixelsAll([flat, other], 250, 100, 20)!;
    expect(out).toHaveLength(3);
    expect(out[2]).toBe(other);
    expect(erasePixelsAll([other], 250, 100, 20)).toBeNull();
  });
});

describe('date groups', () => {
  it('counts days by the calendar across a clock change', () => {
    // Tests run in London time (vite.config.ts): the clocks went back on 25 Oct 2026, a 25-hour day.
    const now = new Date(2026, 9, 26, 12).getTime();
    expect(groupLabel(new Date(2026, 9, 25, 0, 30).getTime(), now)).toBe('Yesterday');
    expect(groupLabel(new Date(2026, 9, 24, 23, 30).getTime(), now)).toBe('Previous 7 Days');
  });
});

describe('gemini models', () => {
  const names = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3.8-flash', 'gemini-3.8-flash-preview-09-2026', 'gemini-3.8-pro-preview', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-preview-tts', 'gemini-3.8-flash-tts'];

  it('picks the newest version, stable before preview', () => {
    expect(newestModel(names, 'flash')).toBe('gemini-3.8-flash');
    expect(newestModel(names, 'pro')).toBe('gemini-3.8-pro-preview');
    expect(newestModel(names, 'tts')).toBe('gemini-3.8-flash-tts');
    expect(newestModel(['gemini-3.8-flash', 'gemini-3.10-flash'], 'flash')).toBe('gemini-3.10-flash');
  });

  it('moves a retired model that is still listed onto the newest one', () => {
    expect(modelUpgrades(names, { textModel: 'gemini-2.5-flash', proModel: 'gemini-2.5-pro', ttsModel: 'gemini-2.5-flash-preview-tts' })).toEqual({
      textModel: 'gemini-3.8-flash',
      proModel: 'gemini-3.8-pro-preview',
      ttsModel: 'gemini-3.8-flash-tts',
    });
  });

  it('leaves current and deliberate picks alone', () => {
    expect(modelUpgrades(names, { textModel: 'gemini-2.5-flash-lite', proModel: 'gemini-3.8-pro-preview', ttsModel: 'gemini-3.8-flash-tts' })).toEqual({});
  });
});
