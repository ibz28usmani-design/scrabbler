import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Note } from '../db';
import { parseQuery, resetSearchIndex, searchNotes } from '../lib/search';

let t = 1;
const note = (id: string, title: string, text: string, extra: Partial<Note> = {}): Note =>
  ({ id, folderId: 'law', title, snippet: '', content: '', text: `${title}\n${text}`, pinned: false, createdAt: t, updatedAt: t++, kind: 'note', tags: [], ...extra }) as Note;

describe('search', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((x) => x.clear()));
    resetSearchIndex();
    await db.folders.bulkAdd([
      { id: 'law', name: 'Law', createdAt: 1, order: 0, notesAsSources: true, subjectId: 'law' },
      { id: 'contract', name: 'Contract', createdAt: 1, order: 1, notesAsSources: true, parentId: 'law' },
      { id: 'econ', name: 'Economics', createdAt: 1, order: 2, notesAsSources: true, subjectId: 'economics' },
    ]);
    await db.subjects.bulkAdd([
      { id: 'law', name: 'Law', color: '#000' } as any,
      { id: 'economics', name: 'Economics', color: '#000' } as any,
    ]);
    await db.notes.bulkAdd([
      note('offer', 'Offer and acceptance', 'An offer is a promise to be bound. Acceptance must mirror the offer.', { folderId: 'contract', tags: ['contract'] }),
      note('consid', 'Consideration', 'Consideration must move from the promisee. An offer alone is not enough.', { folderId: 'contract', tags: ['contract'], pinned: true }),
      note('elastic', 'Price elasticity', 'Elasticity measures how demand responds to price changes.', { folderId: 'econ', tags: ['micro'] }),
      note('lec', 'Lecture 3', 'Notes on market failure.', { folderId: 'econ', kind: 'lecture', transcript: [{ start: 0, text: 'Today we cover externalities and public goods.' }] }),
      note('gone', 'Offer in the bin', 'offer offer offer', { deletedAt: 5 }),
    ]);
  });

  it('ranks a title match above a passing mention', async () => {
    const hits = await searchNotes('offer');
    expect(hits.map((h) => h.note.id)).toEqual(['offer', 'consid']);
  });

  it('finds words in stemmed forms and in lecture transcripts', async () => {
    expect((await searchNotes('offers')).map((h) => h.note.id)).toContain('offer');
    expect((await searchNotes('externalities')).map((h) => h.note.id)).toEqual(['lec']);
  });

  it('narrows by tag, folder (with its subfolders), subject and kind', async () => {
    expect((await searchNotes('#contract')).map((h) => h.note.id).sort()).toEqual(['consid', 'offer']);
    expect((await searchNotes('folder:law offer')).map((h) => h.note.id)).toEqual(['offer', 'consid']);
    expect((await searchNotes('subject:economics')).map((h) => h.note.id).sort()).toEqual(['elastic', 'lec']);
    expect((await searchNotes('is:lecture')).map((h) => h.note.id)).toEqual(['lec']);
    expect((await searchNotes('is:pinned')).map((h) => h.note.id)).toEqual(['consid']);
  });

  it('matches an exact phrase and shows the passage around it', async () => {
    const hits = await searchNotes('"mirror the offer"');
    expect(hits.map((h) => h.note.id)).toEqual(['offer']);
    expect(hits[0].excerpt).toContain('mirror the offer');
  });

  it('notices edits, deletions and moves without being told', async () => {
    expect(await searchNotes('frustration')).toEqual([]);
    await db.notes.update('elastic', { text: 'Price elasticity\nFrustration of contract', updatedAt: 999 });
    expect((await searchNotes('frustration')).map((h) => h.note.id)).toEqual(['elastic']);
    await db.notes.update('elastic', { deletedAt: 1000 });
    expect(await searchNotes('frustration')).toEqual([]);
    await db.notes.update('offer', { folderId: 'econ' });
    expect((await searchNotes('subject:economics offer')).map((h) => h.note.id)).toEqual(['offer']);
  });

  it('reads filters, quoted values and plain words', () => {
    expect(parseQuery('tag:law/contract folder:"Contract law" is:pinned "exact words" plain')).toEqual({
      terms: 'plain exact words',
      phrases: ['exact words'],
      tags: ['law/contract'],
      folders: ['contract law'],
      subjects: [],
      is: ['pinned'],
    });
  });
});

describe('a folder a page at a time', () => {
  it('reads pinned notes and the newest of the rest, and counts them all', async () => {
    const { folderPage, setPinned } = await import('../lib/notes');
    await Promise.all(db.tables.map((x) => x.clear()));
    await db.notes.bulkAdd(Array.from({ length: 30 }, (_, i) => note(`n${i}`, `Note ${i}`, '', { folderId: 'big', updatedAt: 1000 + i })));
    await db.notes.update('n29', { deletedAt: 5 });
    await setPinned('n0', true);
    const page = await folderPage('big', 5);
    expect(page.pinned.map((n) => n.id)).toEqual(['n0']);
    expect(page.recent.map((n) => n.id)).toEqual(['n28', 'n27', 'n26', 'n25', 'n24']);
    expect(page.total).toBe(29);
    await setPinned('n0', false);
    expect((await folderPage('big', 5)).pinned).toEqual([]);
  });
});
