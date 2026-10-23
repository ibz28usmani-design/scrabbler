/**
 * Exams. Each subject's next exam sets how hard the run-up is: the weekly
 * target grows as it nears, the week's plan gives that subject more of the
 * free time, and no flashcard on it is left to come due after the exam.
 */
import { db, uid, type Card, type Exam, type Folder, type ID } from '../db';
import { folderSubject } from './folders';
import { zonedTime } from './timetable';
import { dayKey } from './dates';

const DAY = 86400000;

export async function addExam(e: Omit<Exam, 'id' | 'createdAt'>): Promise<Exam> {
  const exam: Exam = { ...e, id: uid(), createdAt: Date.now() };
  await db.exams.add(exam);
  return exam;
}

/** Whole days from one "YYYY-MM-DD" to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);
}

/** Each subject's next exam (today's included), soonest first. */
export function nextExams(exams: Exam[], today = dayKey()): Map<string, Exam> {
  const out = new Map<string, Exam>();
  for (const e of [...exams].filter((x) => x.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))) {
    if (!out.has(e.subjectId)) out.set(e.subjectId, e);
  }
  return out;
}

/**
 * How much the weekly target grows with an exam this many days off: as is
 * beyond eight weeks, then a quarter more, half, three quarters, and double
 * in the final week.
 */
export function examMultiplier(daysLeft: number | undefined): number {
  if (daysLeft === undefined || daysLeft < 0 || daysLeft > 56) return 1;
  if (daysLeft > 28) return 1.25;
  if (daysLeft > 14) return 1.5;
  if (daysLeft > 7) return 1.75;
  return 2;
}

/** A subject's weekly target in minutes, given its next exam. */
export function targetMinutes(baseHours: number, exam: Exam | undefined, today = dayKey()): number {
  const m = examMultiplier(exam ? daysBetween(today, exam.date) : undefined);
  // In quarter hours, so the meters read cleanly.
  return Math.round((baseHours * 60 * m) / 15) * 15;
}

/** When the exam starts (09:00 when no time was given), in the college's zone. */
export function examStart(e: Pick<Exam, 'date' | 'time'>): number {
  return zonedTime(e.date, e.time ?? '09:00');
}

/**
 * Keeps a card from coming due after its subject's exam. A review that would
 * land beyond the day before is brought to halfway between now and then, so
 * each review in the run-up comes sooner than the last and the card is seen
 * on the eve. Short intervals, and exams a day or less off, are left alone.
 */
export function capForExam<T extends { due: number }>(sched: T, examAt: number | undefined, now = Date.now()): T {
  if (!examAt) return sched;
  const eve = examAt - DAY;
  if (eve - now <= DAY / 2 || sched.due <= eve) return sched;
  return { ...sched, due: Math.max(now + 10 * 60_000, Math.round(now + (eve - now) / 2)) };
}

/** The exam a card's deck counts toward, through its folder's subject. */
export async function examForCard(card: Pick<Card, 'deckId'>, cache?: { folders: Folder[]; exams: Map<string, Exam> }): Promise<Exam | undefined> {
  const deck = await db.decks.get(card.deckId);
  if (!deck?.folderId) return undefined;
  const folders = cache?.folders ?? (await db.folders.toArray());
  const subject = folderSubject(folders, deck.folderId);
  if (!subject) return undefined;
  const exams = cache?.exams ?? nextExams(await db.exams.toArray());
  return exams.get(subject);
}

/**
 * When a new exam is added, brings forward every card on that subject that
 * would otherwise next come up after it.
 */
export async function pullCardsBefore(subjectId: string, exam: Exam, now = Date.now()): Promise<number> {
  const folders = await db.folders.toArray();
  const deckIds = (await db.decks.toArray()).filter((d) => folderSubject(folders, d.folderId) === subjectId).map((d) => d.id);
  if (!deckIds.length) return 0;
  const at = examStart(exam);
  const changes: { key: ID; changes: Partial<Card> }[] = [];
  await db.cards
    .where('deckId')
    .anyOf(deckIds)
    .each((c) => {
      if (c.sched.state === 0) return;
      const capped = capForExam(c.sched, at, now);
      if (capped.due !== c.sched.due) changes.push({ key: c.id, changes: { sched: capped } });
    });
  if (changes.length) await db.cards.bulkUpdate(changes);
  return changes.length;
}

export function countdown(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  const w = Math.round(days / 7);
  return `in ${w} weeks`;
}
