import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Every release must open every older database without losing a row. Each
 * test builds the database as an old release left it, then opens it with
 * today's schema.
 */

async function fresh() {
  vi.resetModules();
  return import('../db');
}

afterEach(async () => {
  const { db } = await import('../db');
  db.close();
  await Dexie.delete('scrabbler');
});

const V1 = {
  folders: 'id, order',
  notes: 'id, folderId, updatedAt, pinned, deletedAt',
  sources: 'id, folderId, createdAt',
  chunks: 'id, sourceId, folderId',
  blobs: 'id',
  chats: 'id, folderId, createdAt',
  studio: 'id, folderId, createdAt',
  decks: 'id, folderId, createdAt',
  cards: 'id, deckId, sched.due',
  reviews: 'id, cardId, deckId, day, at',
  meta: 'key',
};

const sched = { due: 5, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0 };

describe('opening older databases', () => {
  it('brings a first-release database all the way up, keeping every row', async () => {
    const old = new Dexie('scrabbler');
    old.version(1).stores(V1);
    await old.open();
    await old.table('folders').add({ id: 'f', name: 'Law', createdAt: 1, order: 0, notesAsSources: true, emoji: '⚖️' });
    await old.table('notes').bulkAdd([
      { id: 'ink', folderId: 'f', title: 'Offer', snippet: '', content: '', text: '', pinned: false, createdAt: 1, updatedAt: 1, kind: 'ink', ink: { paper: 'lines', strokes: [], height: 1414 } },
      { id: 'typed', folderId: 'f', title: 'Acceptance', snippet: '', content: '<p>See [[Offer]] #contract</p>', text: 'Acceptance\nSee [[Offer]] #contract', pinned: true, createdAt: 2, updatedAt: 2, kind: 'note', lined: true },
      { id: 'lec', folderId: 'f', title: 'Lecture 1', snippet: '', content: '', text: '', pinned: false, createdAt: 3, updatedAt: 3, kind: 'lecture', status: 'ready', transcript: [{ start: 0, text: 'Hi' }] },
    ]);
    await old.table('decks').add({ id: 'd', name: 'Contract', createdAt: 1, folderId: 'f' });
    await old.table('cards').add({ id: 'c', deckId: 'd', type: 'basic', front: 'Offer?', back: 'A promise', sched, createdAt: 1 });
    await old.table('reviews').add({ id: 'r', cardId: 'c', deckId: 'd', rating: 3, correct: true, xp: 10, at: 1, day: '2026-01-01', mode: 'study' });
    await old.table('meta').add({ key: 'game', value: { xp: 120, lives: 5, livesAt: 1, bestStreak: 3 } });
    await old.table('blobs').add({ id: 'b', blob: new Blob(['mp3']), name: 'a.mp3', mime: 'audio/mpeg', createdAt: 1 });
    old.close();

    const { db } = await fresh();
    expect(db.verno).toBe(5);
    expect(await db.notes.count()).toBe(3);
    expect((await db.notes.get('ink'))!.kind).toBe('note');
    expect((await db.notes.get('ink'))!.paper).toBe('lines');
    const typed = (await db.notes.get('typed'))!;
    expect(typed.paper).toBe('lines');
    expect(typed.pinned).toBe(true);
    expect(typed.links).toEqual(['ink']);
    expect(typed.tags).toEqual(['contract']);
    expect((await db.notes.get('lec'))!.transcript).toEqual([{ start: 0, text: 'Hi' }]);
    expect((await db.cards.get('c'))!.front).toBe('Offer?');
    expect(await db.reviews.count()).toBe(1);
    expect(((await db.meta.get('game'))!.value as { xp: number }).xp).toBe(120);
    expect(await db.blobs.count()).toBe(1);
    // Indexes added since are usable on the old rows.
    expect(await db.notes.where('tags').equals('contract').count()).toBe(1);
    expect(await db.notes.where('status').equals('ready').count()).toBe(1);
    expect(await db.cards.where('deckId').equals('d').count()).toBe(1);
    // And the newest tables are there, empty.
    expect(await db.versions.count()).toBe(0);
    expect(await db.exams.count()).toBe(0);
    expect(await db.papers.count()).toBe(0);
    expect(await db.shares.count()).toBe(0);
  });

  it('adds history, exams and past papers to a version 4 database without touching it', async () => {
    const old = new Dexie('scrabbler');
    old.version(4).stores({
      ...V1,
      folders: 'id, order, parentId',
      notes: 'id, folderId, updatedAt, pinned, deletedAt, status, *links, *tags',
      sources: 'id, folderId, createdAt, status',
      studio: 'id, folderId, createdAt, status',
      subjects: 'id',
      lessons: 'id, day',
      reminderLists: 'id, order',
      reminders: 'id, listId',
      studyTime: 'id, day, subjectId, start',
      tutor: 'id, tool, subjectId, createdAt',
    });
    await old.open();
    const note = { id: 'n', folderId: 'f', title: 'T', snippet: '', content: { type: 'doc', content: [] }, text: 'T', pinned: false, createdAt: 1, updatedAt: 1, kind: 'note', links: [], tags: ['x'] };
    await old.table('notes').add(note);
    await old.table('studyTime').add({ id: 's', subjectId: 'law', start: 1, end: 60001, day: '2026-01-01', source: 'auto', activity: 'notes' });
    await old.table('cards').add({ id: 'c', deckId: 'd', type: 'cloze', front: '{{c1::x}}', back: '', sched, createdAt: 1 });
    old.close();

    const { db } = await fresh();
    expect(await db.notes.get('n')).toEqual(note);
    expect(await db.studyTime.count()).toBe(1);
    // Cards gain an index on the note they came from.
    expect(await db.cards.where('noteId').equals('n').count()).toBe(0);
    await db.cards.update('c', { noteId: 'n' });
    expect(await db.cards.where('noteId').equals('n').count()).toBe(1);
  });

  it('backs up every table except the ones it means to leave out', async () => {
    const { db } = await fresh();
    const { TABLES, NOT_BACKED_UP } = await import('../lib/backup');
    const covered = new Set<string>([...TABLES, ...NOT_BACKED_UP]);
    expect(db.tables.map((t) => t.name).filter((n) => !covered.has(n))).toEqual([]);
  });
});
