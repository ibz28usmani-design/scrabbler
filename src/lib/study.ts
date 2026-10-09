import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card as FCard, type Grade } from 'ts-fsrs';
import { db, getMeta, setMeta, uid, type Card, type ReviewEntry, type SchedState } from '../db';
import { dayKey, prevDay } from './dates';
import { getSettings } from './settings';

export { Rating, State };

const scheduler = fsrs(generatorParameters({ enable_fuzz: true, enable_short_term: true, request_retention: 0.9 }));

export function newSched(now = new Date()): SchedState {
  return toSched(createEmptyCard(now));
}

function toSched(c: FCard): SchedState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review?.getTime(),
  };
}

function fromSched(s: SchedState): FCard {
  return {
    ...s,
    due: new Date(s.due),
    state: s.state as State,
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  };
}

export function formatInterval(ms: number): string {
  const m = ms / 60000;
  if (m < 1) return '<1m';
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

/** Interval labels for Again/Hard/Good/Easy. */
export function previewIntervals(s: SchedState, now = new Date()): Record<number, string> {
  const p = scheduler.repeat(fromSched(s), now);
  const out: Record<number, string> = {};
  for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]) {
    out[r] = formatInterval(p[r].card.due.getTime() - now.getTime());
  }
  return out;
}

export function nextSched(s: SchedState, rating: Grade, now = new Date()): SchedState {
  return toSched(scheduler.next(fromSched(s), now, rating).card);
}

// ---------------------------------------------------------------- gamification

export const MAX_LIVES = 5;
export const LIFE_REFILL_MS = 30 * 60 * 1000;

export interface GameState {
  xp: number;
  lives: number;
  livesAt: number;
  bestStreak: number;
}

const GAME_KEY = 'game';
const DEFAULT_GAME: GameState = { xp: 0, lives: MAX_LIVES, livesAt: Date.now(), bestStreak: 0 };

export function refill(g: GameState, now = Date.now()): GameState {
  if (g.lives >= MAX_LIVES) return { ...g, livesAt: now };
  const gained = Math.floor((now - g.livesAt) / LIFE_REFILL_MS);
  if (gained <= 0) return g;
  const lives = Math.min(MAX_LIVES, g.lives + gained);
  return { ...g, lives, livesAt: lives >= MAX_LIVES ? now : g.livesAt + gained * LIFE_REFILL_MS };
}

export async function getGame(): Promise<GameState> {
  const g = refill(await getMeta(GAME_KEY, DEFAULT_GAME));
  return g;
}

export function nextLifeIn(g: GameState, now = Date.now()): number {
  if (g.lives >= MAX_LIVES) return 0;
  return Math.max(0, LIFE_REFILL_MS - (now - g.livesAt));
}

export function levelFor(xp: number): { level: number; into: number; span: number } {
  // Level n starts at 50 * n * (n - 1) XP: 0, 100, 300, 600, 1000…
  let level = 1;
  while (50 * (level + 1) * level <= xp) level++;
  const base = 50 * level * (level - 1);
  const span = 100 * level;
  return { level, into: xp - base, span };
}

export function xpFor(rating: number, correct: boolean, combo: number, mode: 'study' | 'quiz'): number {
  let xp = 0;
  if (mode === 'quiz') xp = correct ? 8 : 1;
  else if (rating === Rating.Easy) xp = 12;
  else if (rating === Rating.Good) xp = 10;
  else if (rating === Rating.Hard) xp = 6;
  else xp = 1;
  if (correct && combo >= 5) xp += Math.min(10, Math.floor(combo / 5) * 2);
  return xp;
}

export interface RecordResult {
  game: GameState;
  xp: number;
  card: Card;
}

/** Applies a review: reschedules (study mode), logs it, and updates XP/lives. */
export async function recordReview(
  card: Card,
  rating: Grade,
  correct: boolean,
  combo: number,
  mode: 'study' | 'quiz',
): Promise<RecordResult> {
  const now = Date.now();
  let game = await getGame();
  const xp = game.lives > 0 ? xpFor(rating, correct, combo, mode) : 0;
  const wasNew = card.sched.state === State.New;
  const updated: Card = mode === 'study' ? { ...card, sched: nextSched(card.sched, rating, new Date(now)) } : card;
  if (!correct && game.lives > 0) {
    if (game.lives === MAX_LIVES) game.livesAt = now;
    game.lives -= 1;
  }
  game.xp += xp;
  const entry: ReviewEntry = { id: uid(), cardId: card.id, deckId: card.deckId, rating, correct, xp, at: now, day: dayKey(now), mode, wasNew };
  await db.transaction('rw', db.cards, db.reviews, db.meta, async () => {
    if (mode === 'study') await db.cards.put(updated);
    await db.reviews.add(entry);
    const streak = await computeStreak();
    game.bestStreak = Math.max(game.bestStreak, streak.days);
    await setMeta(GAME_KEY, game);
  });
  return { game, xp, card: updated };
}

export async function setGame(g: GameState) {
  await setMeta(GAME_KEY, g);
}

export interface StreakInfo {
  days: number;
  todayCount: number;
  todayMet: boolean;
}

export async function computeStreak(goal?: number): Promise<StreakInfo> {
  const target = goal ?? getSettings().dailyGoal;
  const since = Date.now() - 400 * 86400000;
  const rows = await db.reviews.where('at').above(since).toArray();
  const perDay = new Map<string, number>();
  for (const r of rows) perDay.set(r.day, (perDay.get(r.day) ?? 0) + 1);
  return streakFrom(perDay, target, dayKey());
}

export function streakFrom(perDay: Map<string, number>, goal: number, today: string): StreakInfo {
  const todayCount = perDay.get(today) ?? 0;
  const todayMet = todayCount >= goal;
  let days = todayMet ? 1 : 0;
  let d = prevDay(today);
  while ((perDay.get(d) ?? 0) >= goal) {
    days++;
    d = prevDay(d);
  }
  return { days, todayCount, todayMet };
}

/** Cards due now plus today's allowance of new cards. */
export async function buildQueue(deckIds: string[], newPerDay: number): Promise<Card[]> {
  const now = Date.now();
  const cards = (await db.cards.where('deckId').anyOf(deckIds).toArray()).filter((c) => !c.suspended);
  const today = dayKey();
  const introducedToday = (await db.reviews.where('day').equals(today).toArray()).filter((r) => r.wasNew && deckIds.includes(r.deckId)).length;
  const due = cards.filter((c) => c.sched.state !== State.New && c.sched.due <= now).sort((a, b) => a.sched.due - b.sched.due);
  const fresh = cards
    .filter((c) => c.sched.state === State.New)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, Math.max(0, newPerDay - introducedToday));
  // Interleave new cards among reviews so sessions feel varied.
  const out: Card[] = [];
  let i = 0;
  let j = 0;
  while (i < due.length || j < fresh.length) {
    if (i < due.length) out.push(due[i++]);
    if (i < due.length) out.push(due[i++]);
    if (j < fresh.length) out.push(fresh[j++]);
  }
  return out;
}

export function deckCounts(cards: Card[], now = Date.now()) {
  let due = 0;
  let fresh = 0;
  let learning = 0;
  for (const c of cards) {
    if (c.suspended) continue;
    if (c.sched.state === State.New) fresh++;
    else if (c.sched.due <= now) {
      due++;
      if (c.sched.state === State.Learning || c.sched.state === State.Relearning) learning++;
    }
  }
  return { due, fresh, learning, total: cards.length };
}

// ---------------------------------------------------------------- answer helpers

export const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export function clozeFront(text: string): string {
  return text.replace(CLOZE_RE, (_m, _n, _ans, hint) => `[${hint ? hint : '…'}]`);
}

export function clozeBack(text: string): string {
  return text.replace(CLOZE_RE, (_m, _n, ans) => `⟦${ans}⟧`);
}

export function clozeAnswers(text: string): string[] {
  return [...text.matchAll(CLOZE_RE)].map((m) => m[2]);
}

export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function similarity(a: string, b: string): number {
  a = normalizeAnswer(a);
  b = normalizeAnswer(b);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - dp[a.length][b.length] / Math.max(a.length, b.length);
}

export function makeCard(deckId: string, partial: Partial<Card> & Pick<Card, 'type' | 'front' | 'back'>, at = Date.now()): Card {
  return {
    id: uid(),
    deckId,
    createdAt: at,
    sched: newSched(new Date(at)),
    ...partial,
  };
}
