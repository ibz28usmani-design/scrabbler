import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

describe('upgrading to version 4', () => {
  it('turns handwritten notes into notes with a page sketch, and indexes links', async () => {
    // The database as the previous release left it.
    const old = new Dexie('scrabbler');
    old.version(3).stores({
      folders: 'id, order',
      notes: 'id, folderId, updatedAt, pinned, deletedAt, status',
      meta: 'key',
    });
    await old.open();
    await old.table('notes').bulkAdd([
      { id: 'ink', folderId: 'f', title: 'Contract', snippet: 'Handwritten', content: '', text: '', pinned: false, createdAt: 1, updatedAt: 1, kind: 'ink', ink: { paper: 'cornell', strokes: [{ t: 'pen', c: '#000', s: 3, p: [10, 20, 0.5, 30, 40, 0.5] }], height: 2828 } },
      { id: 'typed', folderId: 'f', title: 'Offer', snippet: '', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'noteLink', attrs: { id: 'ink', title: 'Contract' } }] }] }, text: 'Offer #law', pinned: false, createdAt: 1, updatedAt: 1, kind: 'note', lined: true },
    ]);
    old.close();

    const { db, handwrittenPage } = await import('../db');
    const ink = (await db.notes.get('ink'))!;
    expect(ink.kind).toBe('note');
    expect(ink.ink).toBeUndefined();
    expect(ink.paper).toBe('cornell');
    const page = handwrittenPage(ink);
    expect(page?.strokes).toHaveLength(1);
    expect(page?.height).toBe(2828);
    const typed = (await db.notes.get('typed'))!;
    expect(typed.paper).toBe('lines');
    expect(typed.links).toEqual(['ink']);
    expect(typed.tags).toEqual(['law']);
    expect((await db.notes.where('links').equals('ink').toArray()).map((n) => n.id)).toEqual(['typed']);
  });
});
