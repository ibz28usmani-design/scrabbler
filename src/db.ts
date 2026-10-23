import Dexie, { type EntityTable } from 'dexie';
import type { Lesson, Subject, TermCalendar } from './lib/timetable';
import type { Reminder, ReminderList } from './lib/reminders';
import { JOB_LOCK, locks } from './lib/jobs';
import type { Paper } from './lib/paper';
import { indexNote, titleMap } from './lib/links';

export type ID = string;

export interface Folder {
  id: ID;
  name: string;
  /** Its icon's name (components/AppIcon.tsx). */
  icon?: string;
  /** Before icons: an emoji, read as the icon it maps to. */
  emoji?: string;
  createdAt: number;
  order: number;
  /** When true, the folder's own notes are used as sources in chat/studio. */
  notesAsSources: boolean;
  /** The folder this one sits inside; none for a top-level folder. */
  parentId?: ID;
  /** The timetable subject its notes and decks count toward; inherited by subfolders. */
  subjectId?: string;
  /** Its subfolders are folded away in the sidebar. */
  collapsed?: boolean;
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
  /** When it was pinned: indexed, so a folder's pinned notes are found without reading the rest. */
  pinnedAt?: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  /** 'ink' only on notes from before handwriting moved inline; see migrateInkNotes. */
  kind: 'note' | 'lecture' | 'ink';
  /** Present when kind === 'ink'. */
  ink?: InkDoc;
  /** Typed notes: ruled lines behind the text. Superseded by `paper`. */
  lined?: boolean;
  /** The note's paper, as in Apple Notes' Lines & Grids: behind the text and its sketches. */
  paper?: Paper;
  /** Ids of the notes this one links to (lib/links.ts). */
  links?: ID[];
  /** Its #tags, lower case. */
  tags?: string[];
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
  /** The lecture a transcript source came from, so rewriting its notes replaces it. */
  noteId?: ID;
  /** What a web-research (Discover) source looked into, so it can be retried. */
  topic?: string;
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
  /** Its icon's name (components/AppIcon.tsx). */
  icon?: string;
  /** Before icons: an emoji, read as the icon it maps to. */
  emoji?: string;
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
  /** The note it was made from, for a card cut from a highlight. */
  noteId?: ID;
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

/** What a stretch of revision time was spent on. */
export type StudyActivity = 'notes' | 'cards' | 'quiz' | 'tutor' | 'notebook' | 'lecture' | 'timer' | 'manual';

/** A stretch of revision time on one subject (lib/studyTime.ts). */
export interface StudySession {
  id: ID;
  /** A timetable subject id, or 'other'. */
  subjectId: string;
  start: number;
  end: number;
  /** The local day it started on, "YYYY-MM-DD". */
  day: string;
  source: 'auto' | 'timer' | 'manual';
  activity: StudyActivity;
  folderId?: ID;
  label?: string;
}

export type TutorTool = 'blurt' | 'feynman' | 'exam' | 'socratic' | 'mock' | 'paper';

/** One go at a tutor exercise, kept so weak spots can be found across them. */
export interface TutorAttempt {
  id: ID;
  tool: TutorTool;
  subjectId?: string;
  folderId?: ID;
  topic: string;
  /** The question set, for exam and mock attempts. */
  prompt?: string;
  answer: string;
  /** The tutor's marking, as Markdown. */
  feedback: string;
  score?: number;
  max?: number;
  /** Ideas the answer missed or got wrong. */
  gaps?: string[];
  createdAt: number;
}

export interface Meta {
  key: string;
  value: unknown;
}

/** Why a note's earlier state was kept (lib/versions.ts). */
export type VersionReason = 'edit' | 'ai' | 'restore' | 'sync' | 'lecture';

/** A note as it once was, kept so an edit, an AI rewrite or a sync can be undone. */
export interface NoteVersion {
  id: ID;
  noteId: ID;
  /** When the note looked like this (its updatedAt then). */
  at: number;
  /** When the copy was taken. */
  takenAt: number;
  reason: VersionReason;
  /** What was about to happen, e.g. "Proofread". */
  label?: string;
  title: string;
  text: string;
  content: unknown;
}

/** An exam on a subject's calendar: revision, cards and the week's plan build toward it. */
export interface Exam {
  id: ID;
  subjectId: string;
  /** e.g. "Paper 1: Contract". */
  name: string;
  /** Its local day, "YYYY-MM-DD". */
  date: string;
  /** Start time, "HH:MM", when known. */
  time?: string;
  createdAt: number;
}

/** A real past paper and its mark scheme, sat in the tutor and marked against the scheme. */
export interface PastPaper {
  id: ID;
  subjectId?: string;
  title: string;
  /** The paper's text, as read from its PDF or photos. */
  questions: string;
  /** The board's mark scheme, as read from its PDF; empty when there isn't one. */
  markScheme: string;
  minutes: number;
  /** The paper split into its questions, each with its part of the mark scheme. */
  parts?: PaperPart[];
  paperBlobId?: ID;
  schemeBlobId?: ID;
  createdAt: number;
}

export interface PaperPart {
  /** As printed: "1", "2(a)", "03.2". */
  num: string;
  question: string;
  marks: number;
  /** This question's mark scheme, as the board wrote it; empty when there isn't one. */
  scheme: string;
}

/** A note or deck published read-only through the push server (lib/share.ts). */
export interface Share {
  id: ID;
  kind: 'note' | 'deck';
  refId: ID;
  title: string;
  url: string;
  createdAt: number;
  updatedAt: number;
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
  studyTime: EntityTable<StudySession, 'id'>;
  tutor: EntityTable<TutorAttempt, 'id'>;
  versions: EntityTable<NoteVersion, 'id'>;
  exams: EntityTable<Exam, 'id'>;
  papers: EntityTable<PastPaper, 'id'>;
  shares: EntityTable<Share, 'id'>;
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

// Find work in flight (a transcription, a source being read) without loading every note.
db.version(3).stores({
  notes: 'id, folderId, updatedAt, pinned, deletedAt, status',
  sources: 'id, folderId, createdAt, status',
  studio: 'id, folderId, createdAt, status',
});

// Nested folders, subjects, links and tags, revision time and the tutor.
// Handwritten notes become typed notes holding one page-wide sketch, as in Apple Notes.
db.version(4)
  .stores({
    folders: 'id, order, parentId',
    notes: 'id, folderId, updatedAt, pinned, deletedAt, status, *links, *tags',
    studyTime: 'id, day, subjectId, start',
    tutor: 'id, tool, subjectId, createdAt',
  })
  .upgrade(async (tx) => {
    const notes = tx.table('notes');
    await notes.toCollection().modify((n: Note) => {
      if (n.kind === 'ink' && n.ink) Object.assign(n, inkToNote(n));
      if (n.lined && !n.paper) n.paper = 'lines';
    });
    const all: Note[] = await notes.toArray();
    const titles = titleMap(all);
    for (const n of all) {
      const { links, tags } = indexNote(n, titles);
      await notes.update(n.id, { links, tags });
    }
  });

// Note history, exam dates, past papers and shared links.
db.version(5).stores({
  versions: 'id, noteId, takenAt',
  exams: 'id, subjectId, date',
  papers: 'id, subjectId, createdAt',
  shares: 'id, refId',
  cards: 'id, deckId, sched.due, noteId',
});

// A folder's notes newest first, a page at a time, and its pinned notes, without loading them all.
db.version(6)
  .stores({
    notes: 'id, folderId, updatedAt, pinned, deletedAt, status, *links, *tags, [folderId+updatedAt], pinnedAt',
  })
  .upgrade(async (tx) => {
    await tx
      .table('notes')
      .filter((n: Note) => n.pinned && !n.pinnedAt)
      .modify((n: Note) => {
        n.pinnedAt = n.updatedAt || Date.now();
      });
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
  // An earlier version may still show the file, and can be restored.
  await db.versions.each((v) => attachmentBlobIds(v.content).forEach((id) => used.add(id)));
  const orphans = candidates.filter((id) => !used.has(id));
  await db.blobs.bulkDelete(orphans);
  return orphans.length;
}

const BUSY_NOTE = ['recording', 'transcribing', 'writing'];
// Typed loosely: Dexie's key-path types recurse on MindNode.
const studioTable = () => db.studio as any;

/**
 * Work the app was doing when it was closed (transcribing, writing notes,
 * reading a source, making a studio item) never finishes. Mark it failed so it
 * offers a retry instead of a spinner for ever — each job, unless a tab still
 * open holds its claim.
 */
export async function failInterrupted() {
  const held = new Set(((await locks()?.query())?.held ?? []).map((l) => l.name));
  const orphan = (row: { id: ID }) => !held.has(JOB_LOCK + row.id);
  const error = 'Interrupted when the app closed. Try again.';
  await db.notes.where('status').anyOf(BUSY_NOTE).filter(orphan).modify({ status: 'error', error });
  await db.sources.where('status').equals('processing').filter(orphan).modify({ status: 'error', error });
  await studioTable().where('status').equals('working').filter(orphan).modify({ status: 'error', error });
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
    await db.folders.add({ id: folderId, name: 'Notes', icon: 'notes', createdAt: Date.now(), order: 0, notesAsSources: true });
    const { welcomeNote } = await import('./lib/welcome');
    await db.notes.add(welcomeNote(folderId));
  }
  const { installVersionHooks } = await import('./lib/versions');
  installVersionHooks();
  const { installSyncHooks } = await import('./lib/sync');
  installSyncHooks();
  const old = await db.notes.where('deletedAt').below(Date.now() - THIRTY_DAYS).toArray();
  if (old.length) await deleteNotesForever(old.map((n) => n.id));
  await sweepAttachments();
  await failInterrupted();
  await seedCalendar();
  await seedSubjectFolders();
}

/**
 * A top-level folder for each subject you revise, the first time only. Folders
 * already tagged with a subject count, so one you made yourself isn't doubled.
 */
export async function seedSubjectFolders() {
  if (await getMeta('subjectFoldersSeeded', false)) return;
  const { getSettings } = await import('./lib/settings');
  const subjects = await db.subjects.toArray();
  const folders = await db.folders.toArray();
  const icon: Record<string, string> = { law: 'scales', economics: 'chart', maths: 'maths' };
  let order = folders.length;
  for (const id of getSettings().revisionSubjects) {
    const sub = subjects.find((x) => x.id === id);
    if (!sub || folders.some((f) => f.subjectId === id || f.name.toLowerCase() === sub.name.toLowerCase())) continue;
    await db.folders.add({ id: uid(), name: sub.name, icon: icon[id] ?? 'books', createdAt: Date.now(), order: order++, notesAsSources: true, subjectId: id });
  }
  // A folder already named for a subject is taken to be that subject's.
  for (const f of folders) {
    const sub = !f.subjectId && !f.parentId && subjects.find((x) => x.name.toLowerCase() === f.name.toLowerCase() || x.short?.toLowerCase() === f.name.toLowerCase());
    if (sub) await db.folders.update(f.id, { subjectId: sub.id });
  }
  await setMeta('subjectFoldersSeeded', true);
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
  // Autumn half term was first guessed as 26 Oct; it starts Tue 20 Oct. Fix calendars still holding the guess.
  const cal = await getTermCalendar();
  const guess = cal.closures.find((c) => c.name === 'Autumn half term' && c.start === '2026-10-26' && !c.confirmed);
  if (guess) {
    Object.assign(guess, SEED_CALENDAR.closures.find((c) => c.name === 'Autumn half term'));
    await setMeta(TERM_CALENDAR_KEY, cal);
  }
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
 * A handwritten note from before handwriting moved inline, as Apple Notes has
 * it: a typed note whose title is its first line and whose body is one sketch
 * the width of the page, on the paper it was written on. The strokes keep
 * their coordinates, so nothing moves.
 */
export function inkToNote(n: Note): Partial<Note> {
  const ink = n.ink!;
  const title = n.title.trim();
  const content = {
    type: 'doc',
    content: [
      ...(title ? [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] }] : []),
      { type: 'drawing', attrs: { strokes: ink.strokes, height: ink.height, paper: ink.paper, page: true } },
      { type: 'paragraph' },
    ],
  };
  return { kind: 'note', content, paper: ink.paper, ink: undefined, text: title, snippet: n.snippet };
}

/** A note that is all handwriting, which exports as pages rather than a typed document. */
export function handwrittenPage(note: Note): InkDoc | null {
  if (note.kind === 'ink' && note.ink) return note.ink;
  return legacyInk(note.content, note.paper ?? (note.lined ? 'lines' : 'blank'));
}

/** A handwritten page: [heading?] + one drawing + [empty paragraph]. Exports it as pages rather than a typed document. */
export function legacyInk(content: unknown, notePaper: Paper = 'blank'): InkDoc | null {
  const blocks = ((content as { content?: any[] })?.content ?? []).filter((b) => !(b.type === 'paragraph' && !b.content?.length));
  const drawings = blocks.filter((b) => b.type === 'drawing');
  const others = blocks.filter((b) => b.type !== 'drawing');
  if (drawings.length !== 1 || others.length > 1) return null;
  if (others.length === 1 && others[0].type !== 'heading') return null;
  const a = drawings[0].attrs ?? {};
  return { paper: a.paper ?? notePaper, strokes: Array.isArray(a.strokes) ? a.strokes : [], height: Number(a.height) || 1414 };
}

export async function deleteNotesForever(ids: ID[]) {
  await db.transaction('rw', db.notes, db.blobs, db.versions, async () => {
    const gone = new Set(ids);
    const notes = await db.notes.bulkGet(ids);
    const blobIds = new Set(notes.flatMap((n) => (n ? [...(n.audioBlobId ? [n.audioBlobId] : []), ...attachmentBlobIds(n.content)] : [])));
    // A duplicated or copied block shares its file with another note: keep that one.
    await db.notes.each((n) => {
      if (gone.has(n.id)) return;
      if (n.audioBlobId) blobIds.delete(n.audioBlobId);
      attachmentBlobIds(n.content).forEach((id) => blobIds.delete(id));
    });
    await db.versions.each((v) => !gone.has(v.noteId) && attachmentBlobIds(v.content).forEach((id) => blobIds.delete(id)));
    await db.notes.bulkDelete(ids);
    await db.versions.where('noteId').anyOf(ids).delete();
    await db.blobs.bulkDelete([...blobIds]);
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
  await db.transaction('rw', [db.notes, db.chats, db.studio, db.folders, db.decks, db.blobs], async () => {
    // Audio Overviews' recordings go with their studio items.
    const audio = (await db.studio.where('folderId').equals(id).toArray()).flatMap((it) => (it.audioBlobId ? [it.audioBlobId] : []));
    await db.blobs.bulkDelete(audio);
    // Notes go to Recently Deleted rather than vanishing.
    await db.notes.where('folderId').equals(id).modify({ deletedAt: now });
    await db.chats.where('folderId').equals(id).delete();
    await db.studio.where('folderId').equals(id).delete();
    await db.decks.where('folderId').equals(id).modify({ folderId: undefined });
    // Its subfolders move up a level rather than going with it.
    const parentId = (await db.folders.get(id))?.parentId;
    await db.folders.where('parentId').equals(id).modify((f: Folder) => {
      if (parentId) f.parentId = parentId;
      else delete f.parentId;
    });
    await db.folders.delete(id);
  });
}

export async function deleteDeck(id: ID) {
  // Its reviews stay: they are the streak and activity history.
  await db.transaction('rw', db.decks, db.cards, async () => {
    await db.cards.where('deckId').equals(id).delete();
    await db.decks.delete(id);
  });
}
