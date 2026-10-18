/**
 * Revision time, per subject. Three ways in:
 *
 *  - Automatically: working in a subject's notes, cards, quizzes or the tutor
 *    keeps a session open; it stops counting after `idleMinutes` with no tap,
 *    keystroke or stroke, so leaving a note open doesn't count.
 *  - A revision timer (Pomodoro or stopwatch) for work off the screen. While it
 *    runs, automatic tracking stands aside so nothing is counted twice.
 *  - Entries you add or correct yourself.
 *
 * Streaks and the weekly meters are worked out from the sessions, never stored,
 * so a corrected entry corrects them too.
 */
import { useSyncExternalStore } from 'react';
import { db, uid, type ID, type StudyActivity, type StudySession } from '../db';
import { dayKey, prevDay } from './dates';
import { folderSubject, OTHER_SUBJECT } from './folders';
import { getSettings } from './settings';

const MIN = 60_000;
/** A timer left running this long is taken to have been forgotten. */
export const TIMER_CAP_MS = 4 * 60 * MIN;
/** Shorter automatic sessions than this were a glance, not revision. */
const MIN_AUTO_MS = 30_000;

// ---------------------------------------------------------------- pure stats

export const minutesOf = (s: Pick<StudySession, 'start' | 'end'>) => Math.max(0, s.end - s.start) / MIN;

/** subject → day → minutes. */
export function minutesByDay(sessions: StudySession[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const s of sessions) {
    const m = out.get(s.subjectId) ?? new Map<string, number>();
    m.set(s.day, (m.get(s.day) ?? 0) + minutesOf(s));
    out.set(s.subjectId, m);
  }
  return out;
}

/** The Monday of the week a day falls in, as "YYYY-MM-DD". */
export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(d - ((date.getDay() + 6) % 7));
  return dayKey(date);
}

/** The seven days of the week starting `monday`. */
export function weekDays(monday: string): string[] {
  const [y, m, d] = monday.split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => dayKey(new Date(y, m - 1, d + i)));
}

export function weekMinutes(perDay: Map<string, number> | undefined, monday: string): number {
  return weekDays(monday).reduce((sum, d) => sum + (perDay?.get(d) ?? 0), 0);
}

export interface SubjectStreak {
  /** Days in a row meeting the minimum, today included once it's met. */
  days: number;
  todayMet: boolean;
  todayMinutes: number;
  /** The longest run ever, in days. */
  best: number;
}

/**
 * Consecutive days with at least `min` minutes. A streak survives until the
 * end of today: yesterday's run still counts while today's revision is to do.
 */
export function subjectStreak(perDay: Map<string, number> | undefined, min: number, today: string): SubjectStreak {
  const met = (d: string) => (perDay?.get(d) ?? 0) >= min;
  const todayMinutes = perDay?.get(today) ?? 0;
  const todayMet = met(today);
  let days = todayMet ? 1 : 0;
  for (let d = prevDay(today); met(d); d = prevDay(d)) days++;
  let best = days;
  const sorted = [...(perDay?.keys() ?? [])].filter(met).sort();
  let run = 0;
  let last = '';
  for (const d of sorted) {
    run = last && prevDay(d) === last ? run + 1 : 1;
    last = d;
    best = Math.max(best, run);
  }
  return { days, todayMet, todayMinutes, best };
}

/** XP from revision time: one point every two minutes, and 100 for each subject's week on target. */
export function timeXp(sessions: StudySession[], subjects: string[], targetMin: number): number {
  const total = sessions.reduce((sum, s) => sum + minutesOf(s), 0);
  const byDay = minutesByDay(sessions);
  let bonus = 0;
  for (const id of subjects) {
    const weeks = new Set([...(byDay.get(id)?.keys() ?? [])].map(weekStart));
    for (const w of weeks) if (weekMinutes(byDay.get(id), w) >= targetMin) bonus += 100;
  }
  return Math.floor(total / 2) + bonus;
}

export function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
}

// ---------------------------------------------------------------- the timer

export interface RevisionTimer {
  subjectId: string;
  label?: string;
  mode: 'pomodoro' | 'stopwatch';
  focusMin: number;
  breakMin: number;
  phase: 'focus' | 'break';
  /** When this phase began, moved forward by any time spent paused. */
  phaseStart: number;
  pausedAt?: number;
  /** Focus blocks finished in this run. */
  cycles: number;
}

const TIMER_KEY = 'scrabbler.timer';
let timer: RevisionTimer | null = loadTimer();
const timerListeners = new Set<() => void>();

function loadTimer(): RevisionTimer | null {
  try {
    return JSON.parse(localStorage.getItem(TIMER_KEY) || 'null');
  } catch {
    return null;
  }
}

function setTimer(t: RevisionTimer | null) {
  timer = t;
  try {
    if (t) localStorage.setItem(TIMER_KEY, JSON.stringify(t));
    else localStorage.removeItem(TIMER_KEY);
  } catch {
    /* storage unavailable */
  }
  timerListeners.forEach((l) => l());
}

export function getTimer() {
  return timer;
}

export function useTimer(): RevisionTimer | null {
  return useSyncExternalStore(
    (cb) => {
      timerListeners.add(cb);
      return () => timerListeners.delete(cb);
    },
    () => timer,
  );
}

/** Milliseconds into the current phase. */
export function phaseElapsed(t: RevisionTimer, now = Date.now()): number {
  return (t.pausedAt ?? now) - t.phaseStart;
}

export async function startTimer(subjectId: string, mode: RevisionTimer['mode'], focusMin = 25, breakMin = 5, label?: string) {
  await closeAuto();
  if (timer) await stopTimer();
  setTimer({ subjectId, label, mode, focusMin, breakMin, phase: 'focus', phaseStart: Date.now(), cycles: 0 });
}

export function pauseTimer() {
  if (timer && !timer.pausedAt) setTimer({ ...timer, pausedAt: Date.now() });
}

export function resumeTimer() {
  if (timer?.pausedAt) setTimer({ ...timer, phaseStart: timer.phaseStart + (Date.now() - timer.pausedAt), pausedAt: undefined });
}

/** Ends the run, logging the focus time of the block in progress. */
export async function stopTimer(): Promise<number> {
  const t = timer;
  if (!t) return 0;
  setTimer(null);
  if (t.phase !== 'focus') return 0;
  const ms = Math.min(phaseElapsed(t), t.mode === 'pomodoro' ? t.focusMin * MIN : TIMER_CAP_MS);
  return logTimer(t, t.phaseStart, ms);
}

async function logTimer(t: RevisionTimer, start: number, ms: number): Promise<number> {
  if (ms < MIN) return 0;
  await db.studyTime.add({ id: uid(), subjectId: t.subjectId, start, end: start + ms, day: dayKey(start), source: 'timer', activity: 'timer', label: t.label });
  return ms / MIN;
}

export type TimerEvent = { kind: 'focus-done'; minutes: number } | { kind: 'break-done' } | { kind: 'capped' };

/**
 * Moves the timer on by the clock: a Pomodoro's focus block ends and is
 * logged, its break ends. Works however long the app was away, since an iPad
 * suspends it whenever you switch apps or lock the screen.
 */
export async function tickTimer(now = Date.now()): Promise<TimerEvent | null> {
  const t = timer;
  if (!t || t.pausedAt) return null;
  const elapsed = now - t.phaseStart;
  if (t.mode === 'stopwatch') {
    if (elapsed < TIMER_CAP_MS) return null;
    setTimer(null);
    await logTimer(t, t.phaseStart, TIMER_CAP_MS);
    return { kind: 'capped' };
  }
  if (t.phase === 'focus' && elapsed >= t.focusMin * MIN) {
    setTimer({ ...t, phase: 'break', phaseStart: t.phaseStart + t.focusMin * MIN, cycles: t.cycles + 1 });
    return { kind: 'focus-done', minutes: await logTimer(t, t.phaseStart, t.focusMin * MIN) };
  }
  if (t.phase === 'break' && elapsed >= t.breakMin * MIN) {
    // Long gone: don't start a focus block nobody is there for.
    if (elapsed > (t.breakMin + 30) * MIN) {
      setTimer(null);
      return { kind: 'break-done' };
    }
    setTimer({ ...t, phase: 'focus', phaseStart: t.phaseStart + t.breakMin * MIN });
    return { kind: 'break-done' };
  }
  return null;
}

// ---------------------------------------------------------------- automatic tracking

interface Live {
  id: ID;
  subjectId: string;
  start: number;
  end: number;
  activity: StudyActivity;
  folderId?: ID;
  savedAt: number;
}

let live: Live | null = null;
let subjectCache: { at: number; map: Map<string, string | undefined> } = { at: 0, map: new Map() };

async function subjectFor(folderId: ID | undefined): Promise<string> {
  if (!folderId) return OTHER_SUBJECT;
  const now = Date.now();
  if (now - subjectCache.at > 30_000) subjectCache = { at: now, map: new Map() };
  if (!subjectCache.map.has(folderId)) subjectCache.map.set(folderId, folderSubject(await db.folders.toArray(), folderId));
  return subjectCache.map.get(folderId) ?? OTHER_SUBJECT;
}

/** Forget cached folder subjects, after a folder's subject or place changes. */
export function foldersChanged() {
  subjectCache = { at: 0, map: new Map() };
}

async function save(l: Live) {
  if (l.end - l.start < MIN_AUTO_MS) return;
  l.savedAt = Date.now();
  await db.studyTime.put({ id: l.id, subjectId: l.subjectId, start: l.start, end: l.end, day: dayKey(l.start), source: 'auto', activity: l.activity, folderId: l.folderId });
}

/** Ends the automatic session in progress. */
export async function closeAuto() {
  const l = live;
  live = null;
  if (l) await save(l);
}

/**
 * Something was done: a keystroke, a stroke, a card answered. Keeps the
 * subject's session open, or starts one. Pass the subject outright, or the
 * folder whose subject it is.
 */
export async function touchStudy(activity: StudyActivity, where: { folderId?: ID; subjectId?: string } = {}, now = Date.now()) {
  if (timer) return;
  const subjectId = where.subjectId ?? (await subjectFor(where.folderId));
  const idle = getSettings().idleMinutes * MIN;
  // A session doesn't run past midnight: each day's minutes are that day's.
  if (live && live.subjectId === subjectId && now - live.end <= idle && dayKey(now) === dayKey(live.start)) {
    live.end = now;
    if (activity !== live.activity && activity !== 'notes') live.activity = activity;
    if (now - live.savedAt > 20_000) await save(live);
    return;
  }
  await closeAuto();
  live = { id: uid(), subjectId, start: now, end: now, activity, folderId: where.folderId, savedAt: now };
}

/** Logs time you spent away from the app. */
export async function addManual(subjectId: string, day: string, minutes: number, label?: string) {
  const [y, m, d] = day.split('-').map(Number);
  const start = new Date(y, m - 1, d, 12).getTime();
  await db.studyTime.add({ id: uid(), subjectId, start, end: start + minutes * MIN, day, source: 'manual', activity: 'manual', label });
}

export async function sessionsSince(day: string): Promise<StudySession[]> {
  return db.studyTime.where('day').aboveOrEqual(day).toArray();
}
