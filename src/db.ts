import Dexie, { type EntityTable } from 'dexie';

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

export function uid(): ID {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function putBlob(blob: Blob, name: string): Promise<ID> {
  const id = uid();
  await db.blobs.add({ id, blob, name, mime: blob.type, createdAt: Date.now() });
  return id;
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
  const blobIds = notes.flatMap((n) => (n?.audioBlobId ? [n.audioBlobId] : []));
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
