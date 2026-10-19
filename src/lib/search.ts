/**
 * Searching every note: ranked by relevance (BM25, titles and tags counting
 * most), narrowed by filters, with the matching passage to show. Handwriting
 * the app has read and lecture transcripts are searched too.
 *
 * Filters: tag:law (or #law), folder:contract, subject:economics, is:pinned,
 * is:lecture, is:handwritten, and "an exact phrase". A query that is only
 * filters lists everything they match, newest first.
 */
import { db, type Folder, type ID, type Note } from '../db';
import { tokenize } from './retrieval';

export interface ParsedQuery {
  terms: string;
  phrases: string[];
  tags: string[];
  folders: string[];
  subjects: string[];
  is: string[];
}

export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { terms: '', phrases: [], tags: [], folders: [], subjects: [], is: [] };
  const rest: string[] = [];
  // Filters may quote a value with spaces: folder:"Contract law".
  const re = /(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]+)"|#([\p{L}\p{N}_/-]+)|(\S+)/gu;
  for (const m of q.matchAll(re)) {
    const key = (m[1] ?? m[3])?.toLowerCase();
    const val = (m[2] ?? m[4])?.toLowerCase();
    if (key && val !== undefined) {
      if (key === 'tag') out.tags.push(val.replace(/^#/, ''));
      else if (key === 'folder' || key === 'in') out.folders.push(val);
      else if (key === 'subject') out.subjects.push(val);
      else if (key === 'is' || key === 'has') out.is.push(val);
      else rest.push(m[0]);
    } else if (m[5]) out.phrases.push(m[5].toLowerCase());
    else if (m[6]) out.tags.push(m[6].toLowerCase());
    else if (m[7]) rest.push(m[7]);
  }
  out.terms = [...rest, ...out.phrases].join(' ');
  return out;
}

export interface Hit {
  note: Note;
  score: number;
  /** A passage around the best match, for the result row. */
  excerpt: string;
  /** Words to mark in the title and passage. */
  marks: string[];
}

interface Entry {
  id: ID;
  updatedAt: number;
  kind: Note['kind'];
  tags: string[];
  handwritten: boolean;
  tf: Map<string, number>;
  len: number;
  titleToks: Set<string>;
  title: string;
  /** Title, text and transcript in lower case, for phrases and finding the passage. */
  hay: string;
  /** The same in its own case, for showing the passage. */
  raw: string;
}

/** Tokens per note, kept between searches and refreshed only for notes that changed. */
const index = new Map<ID, Entry>();

const W_TITLE = 3;
const W_TAG = 2;

function entryFor(n: Note): Entry {
  const transcript = n.transcript?.map((s) => s.text).join(' ') ?? '';
  const body = tokenize(`${n.text ?? ''} ${transcript}`);
  const title = tokenize(n.title ?? '');
  const tags = (n.tags ?? []).flatMap((t) => tokenize(t.replace(/\//g, ' ')));
  const tf = new Map<string, number>();
  const add = (w: string, by: number) => tf.set(w, (tf.get(w) ?? 0) + by);
  body.forEach((w) => add(w, 1));
  title.forEach((w) => add(w, W_TITLE));
  tags.forEach((w) => add(w, W_TAG));
  const raw = `${n.title ?? ''}\n${n.text ?? ''}\n${transcript}`;
  return {
    id: n.id,
    updatedAt: n.updatedAt,
    kind: n.kind,
    tags: n.tags ?? [],
    handwritten: JSON.stringify(n.content ?? '').includes('"type":"drawing"'),
    tf,
    len: body.length + title.length * W_TITLE + tags.length * W_TAG,
    titleToks: new Set(title),
    title: n.title ?? '',
    hay: raw.toLowerCase(),
    raw,
  };
}

/** The folders a folder: filter means, subfolders included. */
function folderIds(folders: Folder[], names: string[]): Set<ID> | null {
  if (!names.length) return null;
  const hit = new Set(folders.filter((f) => names.some((n) => f.name.toLowerCase().includes(n))).map((f) => f.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (f.parentId && hit.has(f.parentId) && !hit.has(f.id)) (hit.add(f.id), (grew = true));
  }
  return hit;
}

/** A folder's subject, inherited from the nearest folder above that has one. */
function subjectOf(folders: Map<ID, Folder>, id: ID): string | undefined {
  for (let f = folders.get(id), i = 0; f && i < 50; f = f.parentId ? folders.get(f.parentId) : undefined, i++) if (f.subjectId) return f.subjectId;
  return undefined;
}

/**
 * Brings the token index up to date from the indexes alone: only notes whose
 * updatedAt changed are read. Where each note is and whether it's deleted
 * change without touching updatedAt, so those come from their own indexes.
 */
async function refresh(): Promise<{ folderOf: Map<ID, ID>; deleted: Set<ID> }> {
  const stamps = new Map<ID, number>();
  const folderOf = new Map<ID, ID>();
  await db.notes.orderBy('updatedAt').eachKey((updatedAt, cursor) => {
    stamps.set(cursor.primaryKey as ID, updatedAt as number);
  });
  await db.notes.orderBy('folderId').eachKey((folderId, cursor) => {
    folderOf.set(cursor.primaryKey as ID, folderId as ID);
  });
  const deleted = new Set((await db.notes.where('deletedAt').above(0).primaryKeys()) as ID[]);
  for (const id of index.keys()) if (!stamps.has(id)) index.delete(id);
  const stale = [...stamps].filter(([id, at]) => index.get(id)?.updatedAt !== at).map(([id]) => id);
  // In batches, so a first search over thousands of notes doesn't hold them all at once.
  for (let i = 0; i < stale.length; i += 200) {
    for (const n of await db.notes.bulkGet(stale.slice(i, i + 200))) if (n) index.set(n.id, entryFor(n));
  }
  return { folderOf, deleted };
}

export async function searchNotes(q: string, limit = 200): Promise<Hit[]> {
  const parsed = parseQuery(q);
  const { folderOf, deleted } = await refresh();
  const [folders, subjects] = await Promise.all([db.folders.toArray(), db.subjects.toArray()]);
  const byId = new Map(folders.map((f) => [f.id, f]));
  const inFolders = folderIds(folders, parsed.folders);
  const subjectIds = parsed.subjects.length ? new Set(subjects.filter((s) => parsed.subjects.some((x) => s.name.toLowerCase().includes(x) || s.id === x || s.short?.toLowerCase() === x)).map((s) => s.id)) : null;
  // Pinning doesn't change updatedAt either, and booleans can't be indexed: read it only when asked.
  const pinned = parsed.is.includes('pinned') ? new Set((await db.notes.filter((n) => n.pinned).primaryKeys()) as ID[]) : null;
  const words = Array.from(new Set(tokenize(parsed.terms)));

  const entries: Entry[] = [];
  for (const e of index.values()) {
    if (deleted.has(e.id)) continue;
    if (parsed.tags.length && !parsed.tags.every((t) => e.tags.some((x) => x === t || x.startsWith(`${t}/`)))) continue;
    const folderId = folderOf.get(e.id);
    if (inFolders && (!folderId || !inFolders.has(folderId))) continue;
    if (subjectIds) {
      const sub = folderId ? subjectOf(byId, folderId) : undefined;
      if (!sub || !subjectIds.has(sub)) continue;
    }
    if (pinned && !pinned.has(e.id)) continue;
    if (parsed.is.includes('lecture') && e.kind !== 'lecture') continue;
    if ((parsed.is.includes('handwritten') || parsed.is.includes('drawing')) && !e.handwritten) continue;
    entries.push(e);
  }

  let ranked: { e: Entry; score: number }[];
  if (!words.length && !parsed.phrases.length) {
    ranked = entries.sort((a, b) => b.updatedAt - a.updatedAt).map((e) => ({ e, score: 0 }));
  } else {
    const N = entries.length || 1;
    const avg = entries.reduce((a, e) => a + e.len, 0) / N || 1;
    const df = new Map<string, number>();
    for (const w of words) df.set(w, entries.reduce((a, e) => a + (e.tf.has(w) ? 1 : 0), 0));
    const k1 = 1.4;
    const b = 0.75;
    ranked = [];
    for (const e of entries) {
      if (!parsed.phrases.every((p) => e.hay.includes(p))) continue;
      let score = 0;
      let matched = 0;
      for (const w of words) {
        const f = e.tf.get(w);
        if (!f) continue;
        matched++;
        const n = df.get(w) ?? 0;
        score += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * e.len) / avg)));
      }
      if (words.length && matched === 0) continue;
      // Every word should be there; a near miss still shows, well below.
      if (matched < words.length) score *= matched / words.length / 2;
      if (words.length && words.every((w) => e.titleToks.has(w))) score *= 1.5;
      ranked.push({ e, score: score || 1 });
    }
    ranked.sort((a, b) => b.score - a.score || b.e.updatedAt - a.e.updatedAt);
  }
  const top = ranked.slice(0, limit);
  const notes = await db.notes.bulkGet(top.map((r) => r.e.id));
  const marks = [...parsed.phrases, ...markWords(parsed.terms)];
  return top.flatMap((r, i) => {
    const note = notes[i];
    if (!note || note.deletedAt) return [];
    return [{ note, score: r.score, excerpt: words.length || parsed.phrases.length ? excerpt(r.e, words, parsed.phrases) || note.snippet : note.snippet, marks }];
  });
}

/** The words of a query as typed, for highlighting (the index holds stems). */
function markWords(terms: string): string[] {
  return (terms.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1);
}

/** The passage with the most query words in it, in its own case. */
function excerpt(e: Pick<Entry, 'hay' | 'raw' | 'title'>, words: string[], phrases: string[] = []): string {
  const from = e.title.length + 1;
  const hay = e.hay;
  let best = -1;
  for (const p of phrases) {
    const i = hay.indexOf(p, from);
    if (i >= 0) {
      best = i;
      break;
    }
  }
  if (best < 0) {
    let top = 0;
    // Try a window at each place a query word's stem starts.
    for (const w of words) {
      for (let i = hay.indexOf(w, from), tries = 0; i >= 0 && tries < 200; i = hay.indexOf(w, i + 1), tries++) {
        const win = hay.slice(Math.max(from, i - 40), i + 120);
        const n = words.reduce((a, x) => a + (win.includes(x) ? 1 : 0), 0);
        if (n > top) {
          top = n;
          best = i;
        }
        if (top === words.length) break;
      }
      if (top === words.length) break;
    }
  }
  if (best < 0) return '';
  const start = Math.max(from, e.raw.lastIndexOf(' ', Math.max(from, best - 40)) + 1);
  const raw = e.raw.slice(start, start + 160).replace(/\s+/g, ' ').trim();
  return `${start > from ? '…' : ''}${raw}${start + 160 < e.raw.length ? '…' : ''}`;
}

/** Forgets the token index (after an import replaces notes wholesale). */
export function resetSearchIndex() {
  index.clear();
}
