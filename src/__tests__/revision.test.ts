import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, inkToNote, legacyInk, uid, type Folder, type Note, type StudySession } from '../db';
import { indexNote, mentionsTitle, tagsIn, titleMap, wikiTitles } from '../lib/links';
import { canNest, descendantIds, folderPath, folderSubject, folderTree, visibleRows } from '../lib/folders';
import { addManual, closeAuto, minutesByDay, startTimer, stopTimer, subjectStreak, tickTimer, getTimer, timeXp, touchStudy, weekMinutes, weekStart } from '../lib/studyTime';

const folder = (id: string, extra: Partial<Folder> = {}): Folder => ({ id, name: id, emoji: '', createdAt: 0, order: 0, notesAsSources: true, ...extra });
const session = (subjectId: string, day: string, minutes: number): StudySession => {
  const [y, m, d] = day.split('-').map(Number);
  const start = new Date(y, m - 1, d, 10).getTime();
  return { id: uid(), subjectId, start, end: start + minutes * 60000, day, source: 'manual', activity: 'manual' };
};

describe('links and tags', () => {
  it('finds [[titles]] and #tags, and leaves colours and numbers alone', () => {
    expect(wikiTitles('see [[Offer]] and [[Acceptance|accepting]] or [[Consideration#Rules]]')).toEqual(['Offer', 'Acceptance', 'Consideration']);
    expect(tagsIn('#law notes on #law/contract, colour #fff is not #1 but (#Econ) is')).toEqual(['law', 'law/contract', 'fff', 'econ']);
  });

  it('links a note to the notes it names, typed or handwritten', () => {
    const titles = titleMap([
      { id: 'a', title: 'Offer', updatedAt: 1 },
      { id: 'b', title: 'Acceptance', updatedAt: 1 },
    ]);
    const content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'noteLink', attrs: { id: 'b' } }] },
        { type: 'drawing', attrs: { strokes: [], ocr: 'remember [[offer]] #exam' } },
      ],
    };
    const idx = indexNote({ id: 'self', content, text: 'and [[Missing]]' }, titles);
    expect(idx.links.sort()).toEqual(['a', 'b']);
    expect(idx.tags).toEqual(['exam']);
    expect(idx.unresolved).toEqual(['Missing']);
  });

  it('spots a title mentioned without a link, whole words only', () => {
    expect(mentionsTitle('The offer was accepted', 'Offer')).toBe(true);
    expect(mentionsTitle('An offeror made it', 'Offer')).toBe(false);
  });
});

describe('nested folders', () => {
  const folders = [folder('law', { subjectId: 'law' }), folder('contract', { parentId: 'law' }), folder('offer', { parentId: 'contract' }), folder('misc', { order: 1 })];

  it('inherits the subject from the nearest folder above', () => {
    expect(folderSubject(folders, 'offer')).toBe('law');
    expect(folderSubject(folders, 'misc')).toBeUndefined();
    expect(folderPath(folders, 'offer').map((f) => f.id)).toEqual(['law', 'contract', 'offer']);
  });

  it('builds the tree and refuses to put a folder inside itself', () => {
    const tree = folderTree(folders);
    expect(tree.map((n) => n.folder.id)).toEqual(['law', 'misc']);
    expect(visibleRows(tree).map((n) => `${n.depth}${n.folder.id}`)).toEqual(['0law', '1contract', '2offer', '0misc']);
    expect(visibleRows(folderTree(folders.map((f) => (f.id === 'law' ? { ...f, collapsed: true } : f)))).length).toBe(2);
    expect(descendantIds(folders, 'law').sort()).toEqual(['contract', 'law', 'offer']);
    expect(canNest(folders, 'law', 'offer')).toBe(false);
    expect(canNest(folders, 'offer', 'misc')).toBe(true);
  });
});

describe('handwritten notes become Apple Notes sketches', () => {
  it('keeps every stroke in a page-wide sketch under the title', () => {
    const n = { id: 'n', title: 'Contract', kind: 'ink', ink: { paper: 'cornell', strokes: [{ t: 'pen', c: '#000', s: 3, p: [1, 2, 0.5] }], height: 2000 } } as unknown as Note;
    const patch = inkToNote(n);
    expect(patch.kind).toBe('note');
    expect(patch.paper).toBe('cornell');
    const back = legacyInk(patch.content);
    expect(back?.strokes).toHaveLength(1);
    expect(back?.height).toBe(2000);
    expect(back?.paper).toBe('cornell');
  });
});

describe('revision time', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('counts a streak of days meeting the minimum, and keeps it alive until today ends', () => {
    const per = minutesByDay([session('law', '2026-10-15', 30), session('law', '2026-10-16', 25), session('law', '2026-10-17', 40), session('law', '2026-10-12', 60)]).get('law');
    expect(subjectStreak(per, 20, '2026-10-18')).toEqual({ days: 3, todayMet: false, todayMinutes: 0, best: 3 });
    expect(subjectStreak(per, 20, '2026-10-19').days).toBe(0);
  });

  it('adds up a Monday-to-Sunday week toward the target', () => {
    expect(weekStart('2026-10-18')).toBe('2026-10-12');
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
    const per = minutesByDay([session('econ', '2026-10-12', 120), session('econ', '2026-10-18', 120), session('econ', '2026-10-19', 60)]).get('econ');
    expect(weekMinutes(per, '2026-10-12')).toBe(240);
    expect(timeXp([session('econ', '2026-10-12', 240)], ['econ'], 240)).toBe(120 + 100);
  });

  it('keeps one session open while you keep working, and stops counting when idle', async () => {
    await db.folders.add(folder('law', { subjectId: 'law' }));
    const t0 = new Date(2026, 9, 18, 9).getTime();
    await touchStudy('notes', { folderId: 'law' }, t0);
    await touchStudy('notes', { folderId: 'law' }, t0 + 60_000);
    await touchStudy('cards', { folderId: 'law' }, t0 + 110_000);
    // Ten idle minutes later: a new session, and the gap isn't counted.
    await touchStudy('notes', { folderId: 'law' }, t0 + 710_000);
    await touchStudy('notes', { folderId: 'law' }, t0 + 770_000);
    await closeAuto();
    const rows = await db.studyTime.orderBy('start').toArray();
    expect(rows.map((r) => [(r.end - r.start) / 1000, r.subjectId])).toEqual([
      [110, 'law'],
      [60, 'law'],
    ]);
  });

  it('logs only the focus blocks of a Pomodoro, and stands automatic tracking aside', async () => {
    await startTimer('maths', 'pomodoro', 25, 5);
    const start = getTimer()!.phaseStart;
    await touchStudy('notes', { subjectId: 'maths' });
    expect(await tickTimer(start + 26 * 60000)).toEqual({ kind: 'focus-done', minutes: 25 });
    expect(getTimer()?.phase).toBe('break');
    expect(await tickTimer(start + 31 * 60000)).toEqual({ kind: 'break-done' });
    await stopTimer();
    expect(getTimer()).toBeNull();
    await addManual('maths', '2026-10-18', 45);
    const rows = await db.studyTime.toArray();
    expect(rows.map((r) => r.source).sort()).toEqual(['manual', 'timer']);
  });
});

describe('unlinked mentions', () => {
  it('links the first plain mention and keeps the text around it', async () => {
    const { linkFirstMention } = await import('../lib/links');
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'An offer, then acceptance.' }] }] };
    const next = linkFirstMention(doc, 'Offer', 'n1') as any;
    expect(next.content[0].content.map((c: any) => c.type === 'text' ? c.text : `[${c.attrs.id}]`)).toEqual(['An ', '[n1]', ', then acceptance.']);
    expect(linkFirstMention(doc, 'Consideration', 'n2')).toBeNull();
  });
});

describe('Obsidian vaults', () => {
  it('reads and writes frontmatter properties', async () => {
    const { frontmatter, parseFrontmatter } = await import('../lib/vault');
    const head = frontmatter({ subject: 'Law', tags: ['contract', 'exam'], created: '2026-10-18T10:00:00.000Z', type: undefined });
    const { props, body } = parseFrontmatter(`${head}Body text`);
    expect(props).toEqual({ subject: 'Law', tags: ['contract', 'exam'], created: '2026-10-18T10:00:00.000Z' });
    expect(body).toBe('Body text');
    expect(parseFrontmatter('---\ntags: [a, "b c"]\n---\nx').props.tags).toEqual(['a', 'b c']);
  });

  it('keeps [[links]] safe from the Markdown parser, aliases included', async () => {
    const { protectWikiLinks } = await import('../lib/vault');
    const { md, links } = protectWikiLinks('See [[Offer]] and [[Acceptance|accepting]] but not ![[pic.png]]');
    expect(md).toBe('See WIKILINK0X and WIKILINK1X but not ![[pic.png]]');
    expect(links).toEqual([
      { target: 'Offer', label: 'Offer' },
      { target: 'Acceptance', label: 'accepting' },
    ]);
  });

  it('writes note links as [[Title]] in Markdown', async () => {
    const { toBlocks } = await import('../lib/export/ir');
    const { toMarkdown } = await import('../lib/export/text');
    const blocks = toBlocks({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'noteLink', attrs: { id: 'x', title: 'Offer' } }] }] } as never);
    expect(toMarkdown(blocks).trim()).toBe('See [[Offer]]');
  });
});

describe('pasted cards (Gizmo has no export)', () => {
  it('reads every shape a copy comes in', async () => {
    const { parseLoose } = await import('../lib/importers');
    const pairs = (s: string) => parseLoose(s).map((c) => [c.front, c.back]);
    expect(pairs('Q: What is offer?\nA: A definite promise\nQ: Acceptance?\nA: Unqualified agreement')).toEqual([
      ['What is offer?', 'A definite promise'],
      ['Acceptance?', 'Unqualified agreement'],
    ]);
    expect(pairs('Offer\tA definite promise\nAcceptance → Unqualified agreement')).toEqual([
      ['Offer', 'A definite promise'],
      ['Acceptance', 'Unqualified agreement'],
    ]);
    expect(pairs('What is PED?\nResponsiveness of demand to price\n\nWhat is YED?\nResponsiveness to income\nusually positive')).toEqual([
      ['What is PED?', 'Responsiveness of demand to price'],
      ['What is YED?', 'Responsiveness to income\nusually positive'],
    ]);
    expect(pairs('1. Offer — a definite promise\n2. Consideration: something of value')).toEqual([
      ['Offer', 'a definite promise'],
      ['Consideration', 'something of value'],
    ]);
    expect(pairs('Offer\nA definite promise\nAcceptance\nUnqualified agreement')).toEqual([
      ['Offer', 'A definite promise'],
      ['Acceptance', 'Unqualified agreement'],
    ]);
  });
});

describe('revision plan', () => {
  it('fits blocks around lessons and spreads them over the days left', async () => {
    const { freeSlots, planWeek } = await import('../lib/revisionPlan');
    const cal = { terms: [{ name: 'Autumn', start: '2026-09-01', end: '2026-12-18' }], closures: [] };
    const lessons = [{ id: 'l', subjectId: 'law', day: 1, start: '09:00', end: '12:00' }];
    const mon = freeSlots('2026-10-12', lessons, cal);
    expect(mon[0]).toEqual([12 * 60 + 10, 17 * 60 + 30]);
    const sat = freeSlots('2026-10-17', lessons, cal);
    expect(sat[0]).toEqual([600, 750]);
    const days = ['2026-10-17', '2026-10-18'];
    const plan = planWeek({ days, remaining: new Map([['law', 90], ['maths', 90]]), slots: new Map(days.map((d) => [d, freeSlots(d, lessons, cal)])), topics: new Map([['law', ['Offer']]]) });
    const total = (s: string) => plan.filter((b) => b.subjectId === s).reduce((a, b) => a + b.minutes, 0);
    expect(total('law')).toBe(90);
    expect(total('maths')).toBe(90);
    expect(new Set(plan.map((b) => b.day)).size).toBe(2);
    expect(plan.find((b) => b.subjectId === 'law')?.topic).toBe('Offer');
  });
});

describe('shape recognition', () => {
  const flat = (pts: number[][]) => pts.flatMap(([x, y]) => [x, y, 0.5]);
  it('straightens a wobbly line and rounds a rough circle', async () => {
    const { recognizeShape } = await import('../lib/shapes');
    const line = flat(Array.from({ length: 30 }, (_, i) => [100 + i * 10, 200 + Math.sin(i) * 2]));
    expect(recognizeShape(line)?.kind).toBe('line');
    const circle = flat(Array.from({ length: 60 }, (_, i) => [300 + 80 * Math.cos((i / 59) * Math.PI * 2) + (i % 3), 300 + 80 * Math.sin((i / 59) * Math.PI * 2)]));
    expect(recognizeShape(circle)?.kind).toBe('ellipse');
  });
  it('squares up a box and leaves handwriting alone', async () => {
    const { recognizeShape } = await import('../lib/shapes');
    const side = (a: number[], b: number[]) => Array.from({ length: 15 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / 15 + (i % 2), a[1] + ((b[1] - a[1]) * i) / 15]);
    const box = flat([...side([100, 100], [300, 102]), ...side([300, 102], [302, 250]), ...side([302, 250], [99, 248]), ...side([99, 248], [101, 103]), [101, 103]]);
    expect(recognizeShape(box)?.kind).toBe('rectangle');
    const scribble = flat(Array.from({ length: 50 }, (_, i) => [100 + i * 4, 100 + ((i * 37) % 23)]));
    expect(recognizeShape(scribble)).toBeNull();
  });
});

describe('Markdown tags', () => {
  it('keeps #tags as tags, and still escapes what would be a heading', async () => {
    const { toMarkdown } = await import('../lib/export/text');
    expect(toMarkdown([{ type: 'paragraph', runs: [{ text: 'Revise #contract law' }] }]).trim()).toBe('Revise #contract law');
    expect(toMarkdown([{ type: 'paragraph', runs: [{ text: '# not a heading' }] }]).trim()).toBe('\\# not a heading');
  });
});
