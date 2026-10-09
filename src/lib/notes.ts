import { db, uid, type Note } from '../db';
import { nav, getNav } from './nav';
import { HANDWRITING_TEMPLATES, PAGE_H, type Paper } from './paper';

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

/** Creates a handwritten note: an endless canvas on the chosen paper. */
export async function createHandwrittenNote(folderId: string, paper: Paper): Promise<Note> {
  const tpl = HANDWRITING_TEMPLATES.find((t) => t.paper === paper) ?? HANDWRITING_TEMPLATES[0];
  return createNote(folderId, {
    kind: 'ink',
    title: '',
    snippet: `Handwritten · ${tpl.label}`,
    ink: { paper: tpl.paper, strokes: [], height: PAGE_H },
  });
}

export async function restoreNote(id: string) {
  const n = await db.notes.get(id);
  if (!n) return;
  let folderId = n.folderId;
  if (!(await db.folders.get(folderId))) folderId = (await db.folders.orderBy('order').first())!.id;
  await db.notes.update(id, { deletedAt: undefined, folderId });
  if (getNav().noteId === id) nav({ noteId: null });
}
