import Dexie, { type EntityTable } from 'dexie';
import type { Lesson, Subject, TermCalendar } from './lib/timetable';
import type { Reminder, ReminderList } from './lib/reminders';

export type ID = string;

export interface Folder {
  id: ID;
  name: string;
  emoji: string;
  createdAt: number;
  order: number;
  /** When true, the folder's own notes are used as sources in chat/studio. */
  notesAsSources: boolean;
}

export interface TranscriptSegment {
  start: number; // seconds
  end?: number;
  speaker?: string;
  text: string;
}

/** A handwritten page: an endless canvas on one of the paper templates. */
export interface InkDoc {
  paper: 'blank' | 'lines' | 'grid' | 'cornell' | 'dots';
  /** Strokes in the 1000-unit-wide logical space (see lib/ink.ts). */
  strokes: { t: 'pen' | 'pencil' | 'marker'; c: string; s: number; p: number[] }[];
  /** Canvas height in logical units — grows as you write. */
  height: number;
}

export interface Note {
  id: ID;
  folderId: ID;
  title: string;
  snippet: string;
  /** TipTap JSON document */
  content: unknown;
  text: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  kind: 'note' | 'lecture' | 'ink';
  /** Present when kind === 'ink'. */
  ink?: InkDoc;
  /** Typed notes: ruled lines behind the text. */
  lined?: boolean;
  /** Typed notes: document typeface. */
  font?: 'serif' | 'sans' | 'mono';
  audioBlobId?: ID;
  transcript?: TranscriptSegment[];
  status?: 'recording' | 'transcribing' | 'writing' | 'ready' | 'error';
  error?: string;
}

export type SourceKind = 'pdf' | 'text' | 'url' | 'youtube' | 'audio' | 'image';

export interface Source {
  id: ID;
  folderId: ID;
  kind: SourceKind;
  title: string;
  text: string;
  url?: string;
  blobId?: ID;
  status: 'processing' | 'ready' | 'error';
  error?: string;
  enabled: boolean;
  createdAt: number;
  summary?: string;
}

export interface Chunk {
  id: ID;
  sourceId: ID;
  folderId: ID;
  idx: number;
  text: string;
  page?: number;
}

export interface StoredBlob {
  id: ID;
  blob: Blob;
  name: string;
  mime: string;
  createdAt: number;
  /** Files dropped into a note's text; swept once no note refers to them. */
  kind?: 'attachment';
}

export interface Citation {
  n: number;
  sourceId: ID;
  chunkId?: ID;
  title: string;
  text: string;
  page?: number;
}

export interface ChatMessage {
  id: ID;
  folderId: ID;
  role: 'user' | 'model';
  text: string;
  citations?: Citation[];
  createdAt: number;
  error?: boolean;
}

export type StudioKind = 'briefing' | 'studyguide' | 'faq' | 'timeline' | 'cheatsheet' | 'mindmap' | 'podcast';

export interface MindNode {
  label: string;
  children?: MindNode[];
}

export interface PodcastLine {
  speaker: string;
  text: string;
}

export interface StudioItem {
  id: ID;
  folderId: ID;
  kind: StudioKind;
  title: string;
  markdown?: string;
  mind?: MindNode;
  script?: PodcastLine[];
  audioBlobId?: ID;
  status: 'working' | 'ready' | 'error';
  progress?: string;
  error?: string;
  createdAt: number;
}

export type CardType = 'basic' | 'cloze' | 'mcq' | 'tf' | 'typed';

export interface SchedState {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: number;
}

export interface Deck {
  id: ID;
  name: string;
  folderId?: ID;
  noteId?: ID;
  createdAt: number;
  emoji: string;
}

export interface Card {
  id: ID;
  deckId: ID;
  type: CardType;
  front: string;
  back: string;
  options?: string[];
  /** index into options for mcq; 1/0 for tf */
  answer?: number;
  explanation?: string;
  sched: SchedState;
  createdAt: number;
  suspended?: boolean;
}

export interface ReviewEntry {
  id: ID;
  cardId: ID;
  deckId: ID;
  rating: number;
  correct: boolean;
  xp: number;
  at: number;
  day: string;
  mode: 'study' | 'quiz';
  wasNew?: boolean;
}

export interface Meta {
  key: string;
  value: unknown;
}

export const db = new Dexie('scrabbler') as Dexie & {
  folders: EntityTable<Folder, 'id'>;
  notes: EntityTable<Note, 'id'>;
  sources: EntityTable<Source, 'id'>;
  chunks: EntityTable<Chunk, 'id'>;
  blobs: EntityTable<StoredBlob, 'id'>;
  chats: EntityTable<ChatMessage, 'id'>;
  studio: EntityTable<StudioItem, 'id'>;
  decks: EntityTable<Deck, 'id'>;
  cards: EntityTable<Card, 'id'>;
  reviews: EntityTable<ReviewEntry, 'id'>;
  meta: EntityTable<Meta, 'key'>;
  subjects: EntityTable<Subject, 'id'>;
  lessons: EntityTable<Lesson, 'id'>;
  reminderLists: EntityTable<ReminderList, 'id'>;
  reminders: EntityTable<Reminder, 'id'>;
};

db.version(1).stores({
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
});

// Calendar and reminders.
db.version(2).stores({
  subjects: 'id',
  lessons: 'id, day',
  reminderLists: 'id, order',
  reminders: 'id, listId',
});

export function uid(): ID {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function putBlob(blob: Blob, name: string, kind?: StoredBlob['kind']): Promise<ID> {
  const id = uid();
  await db.blobs.add({ id, blob, name, mime: blob.type, createdAt: Date.now(), ...(kind ? { kind } : {}) });
  return id;
}

/** Ids of the files attached inside a typed note's content (TipTap JSON, or HTML). */
export function attachmentBlobIds(content: unknown): ID[] {
  const out = new Set<ID>();
  if (typeof content === 'string') {
    for (const m of content.matchAll(/data-blob="([^"]+)"/g)) out.add(m[1]);
  } else {
    const walk = (n: any) => {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'attachment' && typeof n.attrs?.blobId === 'string' && n.attrs.blobId) out.add(n.attrs.blobId);
      if (Array.isArray(n.content)) n.content.forEach(walk);
    };
    walk(content);
  }
  return [...out];
}

const ONE_DAY = 24 * 3600 * 1000;

/**
 * Removes attached files no note (Recently Deleted included) refers to any more.
 * Only files a day old or more, so one removed a moment ago can still be undone.
 */
export async function sweepAttachments(now = Date.now()) {
  const candidates = await db.blobs.filter((b) => b.kind === 'attachment' && b.createdAt < now - ONE_DAY).primaryKeys();
  if (!candidates.length) return 0;
  const used = new Set<ID>();
  await db.notes.each((n) => attachmentBlobIds(n.content).forEach((id) => used.add(id)));
  const orphans = candidates.filter((id) => !used.has(id));
  await db.blobs.bulkDelete(orphans);
  return orphans.length;
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return (row?.value as T) ?? fallback;
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}

const THIRTY_DAYS = 30 * 24 * 3600 * 1000;

/** Seed first-run content and purge notes deleted more than 30 days ago. */
export async function initDb() {
  const count = await db.folders.count();
  if (count === 0) {
    const folderId = uid();
    await db.folders.add({ id: folderId, name: 'Notes', emoji: '🗒️', createdAt: Date.now(), order: 0, notesAsSources: true });
    const { welcomeNote } = await import('./lib/welcome');
    await db.notes.add(welcomeNote(folderId));
  }
  const old = await db.notes.where('deletedAt').below(Date.now() - THIRTY_DAYS).toArray();
  if (old.length) await deleteNotesForever(old.map((n) => n.id));
  await migrateHandwrittenNotes();
  await sweepAttachments();
  await seedCalendar();
}

export const TERM_CALENDAR_KEY = 'termCalendar';

/** The timetable, term dates and a first reminders list, the first time only. */
export async function seedCalendar() {
  const { SEED_CALENDAR, SEED_LESSONS, SEED_SUBJECTS } = await import('./lib/symonds');
  if (!(await getMeta('timetableSeeded', false))) {
    await db.transaction('rw', db.subjects, db.lessons, db.meta, async () => {
      if (!(await db.subjects.count())) await db.subjects.bulkAdd(SEED_SUBJECTS);
      if (!(await db.lessons.count())) await db.lessons.bulkAdd(SEED_LESSONS);
      await setMeta('timetableSeeded', true);
    });
  }
  if (!(await db.meta.get(TERM_CALENDAR_KEY))) await setMeta(TERM_CALENDAR_KEY, SEED_CALENDAR);
  if (!(await db.reminderLists.count())) await db.reminderLists.add({ id: uid(), name: 'Reminders', color: '#2b2a28', order: 0, createdAt: Date.now() });
  // Lists from before the app's own palette: Apple blue becomes ink, and so on.
  const { OLD_LIST_COLORS } = await import('./lib/reminders');
  await db.reminderLists.toCollection().modify((l) => {
    const c = OLD_LIST_COLORS[l.color.toLowerCase()];
    if (c) l.color = c;
  });
}

export async function getTermCalendar(): Promise<TermCalendar> {
  return getMeta<TermCalendar>(TERM_CALENDAR_KEY, { terms: [], closures: [] });
}

/**
 * Handwritten notes used to be typed notes holding a single drawing block.
 * They become real handwritten notes (endless canvas) the first time we see them.
 */
export async function migrateHandwrittenNotes() {
  const candidates = await db.notes.filter((n) => n.kind === 'note' && !!n.content && typeof n.content === 'object').toArray();
  for (const n of candidates) {
    const ink = legacyInk(n.content);
    if (ink) await db.notes.update(n.id, { kind: 'ink', ink, content: '', snippet: n.snippet === 'Drawing' ? '' : n.snippet });
  }
}

/** Matches [heading?] + one drawing + [empty paragraph] — the old handwritten-note shape. */
export function legacyInk(content: unknown): InkDoc | null {
  const blocks = ((content as { content?: any[] })?.content ?? []).filter((b) => !(b.type === 'paragraph' && !b.content?.length));
  const drawings = blocks.filter((b) => b.type === 'drawing');
  const others = blocks.filter((b) => b.type !== 'drawing');
  if (drawings.length !== 1 || others.length > 1) return null;
  if (others.length === 1 && others[0].type !== 'heading') return null;
  const a = drawings[0].attrs ?? {};
  return { paper: a.paper ?? 'blank', strokes: Array.isArray(a.strokes) ? a.strokes : [], height: Number(a.height) || 1414 };
}

export async function deleteNotesForever(ids: ID[]) {
  const notes = await db.notes.bulkGet(ids);
  const blobIds = notes.flatMap((n) => (n ? [...(n.audioBlobId ? [n.audioBlobId] : []), ...attachmentBlobIds(n.content)] : []));
  await db.transaction('rw', db.notes, db.blobs, async () => {
    await db.notes.bulkDelete(ids);
    await db.blobs.bulkDelete(blobIds);
  });
}

export async function deleteSource(id: ID) {
  const s = await db.sources.get(id);
  await db.transaction('rw', db.sources, db.chunks, db.blobs, async () => {
    await db.chunks.where('sourceId').equals(id).delete();
    if (s?.blobId) await db.blobs.delete(s.blobId);
    await db.sources.delete(id);
  });
}

export async function deleteFolder(id: ID) {
  const sources = await db.sources.where('folderId').equals(id).toArray();
  for (const s of sources) await deleteSource(s.id);
  const now = Date.now();
  await db.transaction('rw', [db.notes, db.chats, db.studio, db.folders, db.decks], async () => {
    // Notes go to Recently Deleted rather than vanishing.
    await db.notes.where('folderId').equals(id).modify({ deletedAt: now });
    await db.chats.where('folderId').equals(id).delete();
    await db.studio.where('folderId').equals(id).delete();
    await db.decks.where('folderId').equals(id).modify({ folderId: undefined });
    await db.folders.delete(id);
  });
}

export async function deleteDeck(id: ID) {
  await db.transaction('rw', db.decks, db.cards, db.reviews, async () => {
    await db.cards.where('deckId').equals(id).delete();
    await db.decks.delete(id);
  });
}
