/**
 * Note history. Each note keeps copies of how it was: before an editing
 * session (one every ten minutes of writing), before every AI rewrite, before a
 * restore and before another device's copy replaces it. Any of them can be
 * restored, and restoring keeps the current text as a version too, so nothing
 * here ever loses words.
 */
import Dexie from 'dexie';
import { db, uid, type ID, type Note, type NoteVersion, type VersionReason } from '../db';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A new edit-session copy at most this often. */
export const EDIT_EVERY = 10 * MIN;
/** At most this many copies per note. */
export const MAX_VERSIONS = 80;

/** Sent when a note's content is replaced from outside its editor, so an open editor reloads it. */
export const NOTE_REPLACED = 'scrabbler:note-replaced';

type Snap = Pick<Note, 'id' | 'title' | 'text' | 'content' | 'updatedAt'>;

const sameContent = (a: unknown, b: unknown) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

/** Keeps a copy of the note as it is now. Returns the copy's id, or null when the last copy already says the same. */
export async function snapshot(note: Snap, reason: VersionReason, label?: string, now = Date.now()): Promise<ID | null> {
  if (!note.text?.trim() && !note.title?.trim() && !hasBlocks(note.content)) return null;
  const last = await latest(note.id);
  if (last && sameContent(last.content, note.content)) return reason === 'edit' ? null : last.id;
  const v: NoteVersion = {
    id: uid(),
    noteId: note.id,
    at: note.updatedAt || now,
    takenAt: now,
    reason,
    ...(label ? { label } : {}),
    title: note.title ?? '',
    text: note.text ?? '',
    content: note.content ?? '',
  };
  await db.versions.add(v);
  lastTaken.set(note.id, now);
  await prune(note.id, now);
  return v.id;
}

function hasBlocks(content: unknown) {
  return typeof content === 'object' && !!(content as { content?: unknown[] })?.content?.some((b: any) => b?.type !== 'paragraph' || b.content?.length);
}

export async function latest(noteId: ID): Promise<NoteVersion | undefined> {
  const all = await db.versions.where('noteId').equals(noteId).sortBy('takenAt');
  return all[all.length - 1];
}

export async function versionsOf(noteId: ID): Promise<NoteVersion[]> {
  return (await db.versions.where('noteId').equals(noteId).sortBy('takenAt')).reverse();
}

/**
 * Called with a note as it was just before a save changed its content. It is
 * kept when the note has gone ten minutes without a copy, so the history holds
 * the start of each stretch of writing rather than every keystroke.
 */
export async function beforeEdit(old: Snap, now = Date.now()) {
  // Every save comes through here: answer from memory while a copy is recent.
  const seen = lastTaken.get(old.id);
  if (seen !== undefined && now - seen < EDIT_EVERY) return;
  const last = await latest(old.id);
  if (last && now - last.takenAt < EDIT_EVERY) {
    lastTaken.set(old.id, last.takenAt);
    return;
  }
  await snapshot(old, 'edit', undefined, now);
}

/** When each note's latest copy was taken, as far as this session knows. */
const lastTaken = new Map<ID, number>();

/**
 * Which copies to keep: everything from the last day, then one an hour for a
 * week, then one a day; AI and restore copies always, up to the cap.
 */
export function toPrune(versions: Pick<NoteVersion, 'id' | 'takenAt' | 'reason'>[], now = Date.now()): ID[] {
  const sorted = [...versions].sort((a, b) => b.takenAt - a.takenAt);
  const keep = new Set<ID>();
  const buckets = new Set<string>();
  for (const v of sorted) {
    const age = now - v.takenAt;
    if (age < DAY || v.reason !== 'edit') {
      keep.add(v.id);
      continue;
    }
    const bucket = age < 7 * DAY ? `h${Math.floor(v.takenAt / HOUR)}` : `d${Math.floor(v.takenAt / DAY)}`;
    if (buckets.has(bucket)) continue;
    buckets.add(bucket);
    keep.add(v.id);
  }
  const kept = sorted.filter((v) => keep.has(v.id)).slice(0, MAX_VERSIONS);
  const ok = new Set(kept.map((v) => v.id));
  return sorted.filter((v) => !ok.has(v.id)).map((v) => v.id);
}

async function prune(noteId: ID, now: number) {
  const all = await db.versions.where('noteId').equals(noteId).toArray();
  const drop = toPrune(all, now);
  if (drop.length) await db.versions.bulkDelete(drop);
}

/**
 * Puts a copy back. What the note says now is kept first, so a restore can
 * itself be undone.
 */
export async function restoreVersion(versionId: ID): Promise<void> {
  const v = await db.versions.get(versionId);
  if (!v) throw new Error('That version is no longer on this device.');
  const note = await db.notes.get(v.noteId);
  if (!note) throw new Error('That note is no longer on this device.');
  await snapshot(note, 'restore', 'Before restoring');
  await replaceContent(note.id, { content: v.content, title: v.title, text: v.text });
}

/**
 * Replaces a note's content from outside the editor and tells an open editor
 * to show it (the editor otherwise keeps what it has, and would save over it).
 */
export async function replaceContent(noteId: ID, patch: Pick<Note, 'content' | 'title' | 'text'>) {
  const { linksFor } = await import('./notes');
  const lines = patch.text.split('\n').map((l) => l.trim()).filter(Boolean);
  await db.notes.update(noteId, {
    ...patch,
    snippet: lines.slice(1, 3).join(' ').slice(0, 160),
    ...(await linksFor({ id: noteId, content: patch.content, text: patch.text })),
    updatedAt: Date.now(),
  });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NOTE_REPLACED, { detail: { noteId, content: patch.content } }));
}

let installed = false;

/**
 * Watches every write to a note's content, whoever makes it (the editor, a
 * lecture being rewritten, another device's copy arriving), and keeps the
 * note as it was before it.
 */
export function installVersionHooks() {
  if (installed) return;
  installed = true;
  db.notes.hook('updating', function (mods, _key, old) {
    // Dexie hands over changes as key paths ("content.content.0…"), not whole fields.
    if (!old || !Object.keys(mods).some((k) => k === 'content' || k.startsWith('content.'))) return;
    const before = old as Note;
    // Outside the save's own transaction, which doesn't cover the versions table.
    this.onsuccess = (after) => {
      if (sameContent(before.content, (after as Note).content)) return;
      void Dexie.ignoreTransaction(() => beforeEdit(before)).catch(() => {});
    };
  });
}

export const REASON_LABEL: Record<VersionReason, string> = {
  edit: 'Before editing',
  ai: 'Before AI',
  restore: 'Before restoring',
  sync: 'Before sync',
  lecture: 'Before lecture notes',
};

/** A line diff for showing what a version changes: kept, added (in the version) and removed (from now). */
export function lineDiff(now: string, then: string): { kind: 'same' | 'add' | 'del'; text: string }[] {
  const a = now.split('\n');
  const b = then.split('\n');
  // Beyond this the table would be too big to build on an iPad: show the version as is.
  if (a.length * b.length > 4_000_000) return b.map((text) => ({ kind: 'same', text }));
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: { kind: 'same' | 'add' | 'del'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: 'del', text: a[i++] });
    else out.push({ kind: 'add', text: b[j++] });
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] });
  while (j < m) out.push({ kind: 'add', text: b[j++] });
  return out;
}
