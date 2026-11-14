import Dexie, { type Table } from 'dexie';

export type Stroke = { pts: number[][]; color: string; size: number; tool: 'pen' | 'pencil' | 'hl'; sp?: boolean };
export interface Note { id: string; title: string; folder: string; layout: string; paper: string; content: Record<string, string>; ink: Stroke[]; h: number; pinned?: boolean; draw?: boolean; url?: string; deleted?: number; created: number; updated: number }
export interface Folder { id: string; name: string; color: string }
export interface El { id: string; t: 'text' | 'shape' | 'img'; x: number; y: number; w: number; h: number; r?: number; text?: string; shape?: string; src?: string; fill?: string; stroke?: string; color?: string; font?: string; size?: number; bold?: boolean; italic?: boolean; under?: boolean; align?: string; anim?: string }
export interface Slide { id: string; bg?: string; els: El[]; notes: string; trans?: string; ink: Stroke[] }
export interface Deck { id: string; title: string; theme: string; slides: Slide[]; updated: number }
export interface CardSet { id: string; title: string; created: number }
export interface Card { id: string; set: string; front: string; back: string; due: number; interval: number; ease: number; reps: number }
export interface Quiz { id: string; title: string; questions: { q: string; options: string[]; answer: number; explain: string }[]; best?: number; created: number }
export interface Podcast { id: string; title: string; script: { s: 'A' | 'B'; t: string }[]; audio?: Blob; created: number }
export interface Artifact { id: string; title: string; html: string; updated: number }
export interface Reminder { id: string; title: string; notes?: string; list: string; due?: string; time?: string; flag?: boolean; priority?: number; repeat?: string; done?: boolean; doneAt?: number; notified?: string; created: number }
export interface RList { id: string; name: string; color: string }
export interface Ev { id: string; title: string; color: string; weekly: boolean; day?: number; date?: string; start: string; end: string; room?: string; teacher?: string }
export interface Session { id: string; subject: string; start: number; mins: number }
export interface Source { id: string; name: string; mime: string; data: string }

class DB extends Dexie {
  notes!: Table<Note, string>; folders!: Table<Folder, string>; decks!: Table<Deck, string>;
  cardSets!: Table<CardSet, string>; cards!: Table<Card, string>; quizzes!: Table<Quiz, string>;
  podcasts!: Table<Podcast, string>; artifacts!: Table<Artifact, string>; reminders!: Table<Reminder, string>;
  lists!: Table<RList, string>; events!: Table<Ev, string>; sessions!: Table<Session, string>; sources!: Table<Source, string>;
  constructor() {
    super('scrabbler2');
    this.version(1).stores({
      notes: 'id,folder,updated', folders: 'id', decks: 'id,updated', cardSets: 'id', cards: 'id,set,due',
      quizzes: 'id', podcasts: 'id', artifacts: 'id', reminders: 'id,list,due', lists: 'id', events: 'id',
      sessions: 'id,start', sources: 'id',
    });
  }
}
export const db = new DB();
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const SUBJECT_COLORS = { Law: '#8a5a32', Economics: '#4b5d3e', Mathematics: '#3f3b3d' };

export function newNote(p: Partial<Note> = {}): Note {
  const now = Date.now();
  return { id: uid(), title: '', folder: 'notes', layout: 'free', paper: 'plain', content: {}, ink: [], h: 1100, created: now, updated: now, ...p };
}

const L = (title: string, color: string, day: number, start: string, end: string, room: string, teacher = ''): Ev =>
  ({ id: uid(), title, color, weekly: true, day, start, end, room, teacher });

db.on('populate', () => {
  db.folders.bulkAdd([
    { id: 'notes', name: 'Notes', color: '#1f8a70' },
    { id: 'law', name: 'Law', color: SUBJECT_COLORS.Law },
    { id: 'economics', name: 'Economics', color: SUBJECT_COLORS.Economics },
    { id: 'maths', name: 'Mathematics', color: SUBJECT_COLORS.Mathematics },
    { id: 'clippings', name: 'Clippings', color: '#8e5bb5' },
  ]);
  db.lists.bulkAdd([{ id: 'reminders', name: 'Reminders', color: '#d64933' }, { id: 'homework', name: 'Homework', color: '#2f6fb3' }]);
  const [law, eco, ma] = [SUBJECT_COLORS.Law, SUBJECT_COLORS.Economics, SUBJECT_COLORS.Mathematics];
  db.events.bulkAdd([
    L('Symonds Lecture Programme', '#8b4744', 1, '09:55', '10:50', 'Science SC101'),
    L('Economics', eco, 1, '11:10', '13:00', 'NA104', 'Rob Vaulter'),
    L('Tutor Group P5X', '#575c7e', 1, '13:00', '13:55', 'NA103', 'Elaine Slater'),
    L('Law', law, 2, '11:10', '13:00', 'John Shields JS203', 'Louise Hoddinott'),
    L('Mathematics', ma, 2, '13:55', '14:50', 'Varley VY224', 'Simon Woods'),
    L('Economics', eco, 2, '14:50', '16:40', 'NA104', 'Stephen Maidment'),
    L('LAMDA Public Speaking', '#504459', 3, '09:55', '10:50', 'College Centre CC212', 'Adam Barlow'),
    L('Mathematics', ma, 3, '14:50', '16:40', 'Varley VY224', 'Simon Woods'),
    L('Law', law, 4, '09:00', '10:50', 'John Shields JS203', 'Immie Phelps'),
    L('Economics', eco, 4, '12:05', '13:00', 'NA104', 'Rob Vaulter'),
    L('Mathematics', ma, 5, '11:10', '13:00', 'Varley VY224', 'Simon Woods'),
    L('Law', law, 5, '13:55', '14:50', 'John Shields JS203', 'Immie Phelps'),
  ]);
  db.notes.add(newNote({
    title: 'Welcome to Scrabbler', pinned: true,
    content: { body: `<p>One place for notes, handwriting, slides, reminders, your timetable, a focus clock, a graphing calculator and AI study tools.</p>
<h2>Notes</h2><ul><li>Press <strong>+</strong> for a typed note, a handwritten page, a document template or a web clipping.</li><li>Use <strong>Layout</strong> for Cornell, Maths, Law and Economics pages, and <strong>Paper</strong> for ruled, square grid, graph or dotted paper. Every layout works typed and handwritten.</li><li>Touch the page with Apple Pencil, or press the pen button, to write anywhere.</li><li>Link notes by typing [[Note title]]. Links and #tags appear in the <strong>Graph</strong>.</li></ul>
<h2>Study</h2><p>Add a free Gemini key in <strong>Settings</strong>, tick your sources in <strong>Study</strong>, then generate flashcards, quizzes, podcasts, slide decks and interactive web artefacts.</p>
<p>Everything is stored on this device. Use <strong>Settings → Back up</strong> regularly.</p>` },
  }));
});

const TABLES = ['notes', 'folders', 'decks', 'cardSets', 'cards', 'quizzes', 'artifacts', 'reminders', 'lists', 'events', 'sessions'] as const;
export async function exportAll() {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) out[t] = await db.table(t).toArray();
  return JSON.stringify({ app: 'scrabbler2', at: Date.now(), data: out });
}
export async function importAll(json: string) {
  const { app, data } = JSON.parse(json);
  if (app !== 'scrabbler2') throw new Error('This is not a Scrabbler backup file.');
  await db.transaction('rw', TABLES.map(t => db.table(t)), async () => {
    for (const t of TABLES) if (data[t]) { await db.table(t).clear(); await db.table(t).bulkAdd(data[t]); }
  });
}
