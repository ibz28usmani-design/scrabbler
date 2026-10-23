import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, deleteNotesForever, type Note } from '../db';
import { beforeEdit, EDIT_EVERY, installVersionHooks, lineDiff, restoreVersion, snapshot, toPrune, versionsOf } from '../lib/versions';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const note = (id: string, text: string, extra: Partial<Note> = {}): Note =>
  ({ id, folderId: 'f', title: text, snippet: '', content: doc(text), text, pinned: false, createdAt: 1, updatedAt: 1, kind: 'note', ...extra }) as Note;
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('note history', () => {
  beforeAll(() => installVersionHooks());
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('keeps the note as it was before an edit, once per stretch of writing', async () => {
    await db.notes.add(note('a', 'first draft'));
    await db.notes.update('a', { content: doc('second draft'), text: 'second draft' });
    await settle();
    await db.notes.update('a', { content: doc('third draft'), text: 'third draft' });
    await settle();
    const vs = await versionsOf('a');
    expect(vs.map((v) => v.text)).toEqual(['first draft']);
    expect(vs[0].reason).toBe('edit');
  });

  it('takes another edit copy once ten minutes have passed', async () => {
    const t0 = 1_000_000;
    await beforeEdit(note('b', 'one'), t0);
    await beforeEdit(note('b', 'two'), t0 + EDIT_EVERY - 1);
    await beforeEdit(note('b', 'three'), t0 + EDIT_EVERY + 1);
    expect((await versionsOf('b')).map((v) => v.text)).toEqual(['three', 'one']);
  });

  it('ignores saves that change nothing but the date', async () => {
    await db.notes.add(note('c', 'same'));
    await db.notes.update('c', { updatedAt: 5, pinned: true });
    await db.notes.update('c', { content: doc('same'), updatedAt: 6 });
    await settle();
    expect(await versionsOf('c')).toHaveLength(0);
  });

  it('restores a version and keeps what it replaced, so the restore can be undone', async () => {
    await db.notes.add(note('d', 'before AI'));
    const id = (await snapshot(note('d', 'before AI'), 'ai', 'Proofread'))!;
    await db.notes.update('d', { content: doc('after AI'), text: 'after AI', title: 'after AI' });
    await settle();
    await restoreVersion(id);
    await settle();
    const n = (await db.notes.get('d'))!;
    expect(n.text).toBe('before AI');
    expect(n.content).toEqual(doc('before AI'));
    const vs = await versionsOf('d');
    expect(vs.some((v) => v.reason === 'restore' && v.text === 'after AI')).toBe(true);
  });

  it('goes with the note when it is deleted for good', async () => {
    await db.notes.add(note('e', 'gone soon'));
    await snapshot(note('e', 'gone soon'), 'ai');
    await deleteNotesForever(['e']);
    expect(await db.versions.where('noteId').equals('e').count()).toBe(0);
  });

  it('thins old edit copies to one an hour, then one a day, but keeps AI copies', () => {
    const now = 100 * 86400000;
    const H = 3600000;
    const vs = [
      { id: 'recent1', takenAt: now - 1 * H, reason: 'edit' as const },
      { id: 'recent2', takenAt: now - 2 * H, reason: 'edit' as const },
      { id: 'week-a', takenAt: now - 50 * H, reason: 'edit' as const },
      { id: 'week-b', takenAt: now - 50 * H + 60000, reason: 'edit' as const },
      { id: 'old-a', takenAt: now - 20 * 24 * H, reason: 'edit' as const },
      { id: 'old-b', takenAt: now - 20 * 24 * H + H, reason: 'edit' as const },
      { id: 'ai-old', takenAt: now - 20 * 24 * H - 2 * H, reason: 'ai' as const },
    ];
    expect(toPrune(vs, now).sort()).toEqual(['old-a', 'week-a']);
  });

  it('diffs lines against the note now', () => {
    expect(lineDiff('a\nb\nc', 'a\nx\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'x' },
      { kind: 'same', text: 'c' },
    ]);
  });
});
