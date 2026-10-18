import { db, uid, type Note } from '../db';
import { nav, getNav } from './nav';
import { indexNote, titleMap } from './links';
import { PAGE_H, type Paper } from './paper';

export async function createNote(folderId: string, patch: Partial<Note> = {}, open = true): Promise<Note> {
  const now = Date.now();
  const note: Note = {
    id: uid(),
    folderId,
    title: '',
    snippet: '',
    content: '',
    text: '',
    pinned: false,
    createdAt: now,
    updatedAt: now,
    kind: 'note',
    ...patch,
  };
  await db.notes.add(note);
  if (open) nav({ view: 'folder', folderId, noteId: note.id, pane: 'editor' });
  return note;
}

/**
 * A note to write by hand, as Apple Notes makes one: a note on the chosen
 * paper whose body is a page-wide sketch, ready for the Pencil.
 */
export async function createHandwrittenNote(folderId: string, paper: Paper): Promise<Note> {
  return createNote(folderId, {
    paper,
    content: { type: 'doc', content: [{ type: 'drawing', attrs: { strokes: [], height: PAGE_H, paper: null, page: true, autoActive: true } }, { type: 'paragraph' }] },
  });
}

let titles: { at: number; map: Map<string, string> } | null = null;

async function currentTitles() {
  if (!titles || Date.now() - titles.at > 30_000) {
    const rows: Pick<Note, 'id' | 'title' | 'updatedAt' | 'deletedAt'>[] = [];
    await db.notes.each((n) => rows.push({ id: n.id, title: n.title, updatedAt: n.updatedAt, deletedAt: n.deletedAt }));
    titles = { at: Date.now(), map: titleMap(rows) };
  }
  return titles.map;
}

/** Its links and tags, from what it says now (see lib/links.ts). */
export async function linksFor(note: Pick<Note, 'id' | 'content' | 'text'>) {
  const { links, tags } = indexNote(note, await currentTitles());
  return { links, tags };
}

/**
 * Re-reads every note's links: a [[Title]] written before its note existed
 * resolves once it does. Run when the app is idle, and after an import.
 */
export async function reindexAll() {
  titles = null;
  const map = await currentTitles();
  const changes: { key: string; changes: Partial<Note> }[] = [];
  await db.notes.each((n) => {
    const { links, tags } = indexNote(n, map);
    if (JSON.stringify(links) !== JSON.stringify(n.links ?? []) || JSON.stringify(tags) !== JSON.stringify(n.tags ?? [])) changes.push({ key: n.id, changes: { links, tags } });
  });
  if (changes.length) await db.notes.bulkUpdate(changes);
  return changes.length;
}

export async function restoreNote(id: string) {
  const n = await db.notes.get(id);
  if (!n) return;
  let folderId = n.folderId;
  if (!(await db.folders.get(folderId))) folderId = (await db.folders.orderBy('order').first())!.id;
  await db.notes.update(id, { deletedAt: undefined, folderId });
  if (getNav().noteId === id) nav({ noteId: null });
}
