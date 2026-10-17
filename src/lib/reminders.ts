/**
 * Reminders, after Apple's Reminders app: lists, smart lists (Today, Scheduled,
 * All, Flagged, Completed), due dates and times, flags, priority and repeats —
 * plus what Scrabbler adds: the subject and the kind of work a reminder is for.
 * The logic here is pure; the database and screens use it.
 */
import { addDays, weekday, ymd } from './timetable';

export type Priority = 0 | 1 | 2 | 3;
export type Repeat = 'daily' | 'weekdays' | 'weekly' | 'fortnightly' | 'monthly' | 'yearly';

export interface ReminderList {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: number;
}

export interface Reminder {
  id: string;
  listId: string;
  title: string;
  notes?: string;
  url?: string;
  /** Due date, "YYYY-MM-DD". */
  due?: string;
  /** Due time, "HH:MM"; only with a date. */
  time?: string;
  flagged: boolean;
  priority: Priority;
  completed: boolean;
  completedAt?: number;
  subjectId?: string;
  type?: ReminderType;
  repeat?: Repeat;
  /** The day of the month a monthly or yearly repeat keeps to, so 31 Jan → 28 Feb → 31 Mar. */
  repeatDay?: number;
  /** Alert this many minutes before the due time as well. */
  early?: number;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export const REMINDER_TYPES = [
  { id: 'homework', label: 'Homework', emoji: '📝' },
  { id: 'essay', label: 'Essay', emoji: '✍️' },
  { id: 'revision', label: 'Revision', emoji: '🔁' },
  { id: 'exam', label: 'Exam', emoji: '🎓' },
  { id: 'test', label: 'Test', emoji: '✅' },
  { id: 'reading', label: 'Reading', emoji: '📖' },
  { id: 'coursework', label: 'Coursework', emoji: '📂' },
  { id: 'presentation', label: 'Presentation', emoji: '🎤' },
  { id: 'deadline', label: 'Deadline', emoji: '⏰' },
  { id: 'admin', label: 'Admin', emoji: '📋' },
  { id: 'personal', label: 'Personal', emoji: '🙂' },
] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number]['id'];
export const typeInfo = (t?: string) => REMINDER_TYPES.find((x) => x.id === t);

export const REPEATS: { id: Repeat; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'fortnightly', label: 'Fortnightly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];

/** List colours in the app's inks: charcoal, then muted earth and print colours. */
export const LIST_COLORS = ['#2b2a28', '#b42318', '#c2621b', '#b8862b', '#4b6b3e', '#2f6f73', '#2f4f7a', '#5b4a8a', '#9b3d6b', '#8a5a32', '#77736a'];

/** Lists made before the app's palette carried Apple's colours; map each to its nearest ink. */
export const OLD_LIST_COLORS: Record<string, string> = {
  '#ff3b30': '#b42318',
  '#ff9500': '#c2621b',
  '#ffcc00': '#b8862b',
  '#34c759': '#4b6b3e',
  '#5ac8fa': '#2f6f73',
  '#007aff': '#2b2a28',
  '#5856d6': '#2f4f7a',
  '#af52de': '#5b4a8a',
  '#ff2d55': '#9b3d6b',
  '#a2845e': '#8a5a32',
  '#8e8e93': '#77736a',
};

/** When an all-day reminder alerts, as in Apple Reminders. */
export const ALL_DAY_ALERT = '09:00';

export type SmartList = 'today' | 'scheduled' | 'all' | 'flagged' | 'completed';

export function inSmartList(r: Reminder, list: SmartList, today: string): boolean {
  switch (list) {
    case 'today':
      return !r.completed && !!r.due && r.due <= today;
    case 'scheduled':
      return !r.completed && !!r.due;
    case 'all':
      return !r.completed;
    case 'flagged':
      return !r.completed && r.flagged;
    case 'completed':
      return r.completed;
  }
}

/** Earlier due first (time within a day; all-day first), then priority, then manual order. */
export function byDue(a: Reminder, b: Reminder): number {
  const ka = a.due ? `${a.due} ${a.time ?? ''}` : '~';
  const kb = b.due ? `${b.due} ${b.time ?? ''}` : '~';
  return ka.localeCompare(kb) || b.priority - a.priority || a.order - b.order;
}

export interface Group<T> {
  key: string;
  title: string;
  items: T[];
}

/** Today's sections in Apple's order: overdue, then all-day, morning, afternoon, tonight. */
export function groupToday(items: Reminder[], today: string): Group<Reminder>[] {
  const groups: Group<Reminder>[] = [
    { key: 'overdue', title: 'Overdue', items: [] },
    { key: 'allday', title: 'Today', items: [] },
    { key: 'morning', title: 'Morning', items: [] },
    { key: 'afternoon', title: 'Afternoon', items: [] },
    { key: 'tonight', title: 'Tonight', items: [] },
  ];
  for (const r of [...items].sort(byDue)) {
    if (!r.due) continue;
    if (r.due < today) groups[0].items.push(r);
    else if (!r.time) groups[1].items.push(r);
    else if (r.time < '12:00') groups[2].items.push(r);
    else if (r.time < '17:00') groups[3].items.push(r);
    else groups[4].items.push(r);
  }
  return groups.filter((g) => g.items.length);
}

/** Scheduled: one section per day, with overdue ones first. */
export function groupScheduled(items: Reminder[], today: string): Group<Reminder>[] {
  const map = new Map<string, Reminder[]>();
  for (const r of [...items].sort(byDue)) {
    if (!r.due) continue;
    const k = r.due < today ? 'overdue' : r.due;
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map.entries()].map(([k, list]) => ({ key: k, title: k === 'overdue' ? 'Overdue' : dayTitle(k, today), items: list }));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LONG_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "Today", "Tomorrow", "Yesterday", a weekday this week, or "Mon 12 Oct". */
export function dayTitle(key: string, today: string): string {
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  if (key === addDays(today, -1)) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  if (key > today && key <= addDays(today, 6)) return LONG_DAYS[weekday(key) - 1];
  const thisYear = key.slice(0, 4) === today.slice(0, 4);
  return `${DAYS[weekday(key) - 1]} ${d} ${MONTHS[m - 1]}${thisYear ? '' : ` ${y}`}`;
}

/** The due line under a reminder: "Today, 16:00", "Tomorrow", "Mon 12 Oct". */
export function dueLabel(r: Reminder, today: string): { text: string; overdue: boolean } | null {
  if (!r.due) return null;
  const text = r.time ? `${dayTitle(r.due, today)}, ${r.time}` : dayTitle(r.due, today);
  return { text, overdue: !r.completed && r.due < today };
}

/** The next due date of a repeating reminder; `day` is the day of the month it keeps to. */
export function nextDue(due: string, repeat: Repeat, day?: number): string {
  const [y, m, dueDay] = due.split('-').map(Number);
  const d = day ?? dueDay;
  switch (repeat) {
    case 'daily':
      return addDays(due, 1);
    case 'weekdays': {
      let next = addDays(due, 1);
      while (weekday(next) > 5) next = addDays(next, 1);
      return next;
    }
    case 'weekly':
      return addDays(due, 7);
    case 'fortnightly':
      return addDays(due, 14);
    case 'monthly': {
      // 31 Jan → 28/29 Feb, not 3 March; and back to the 31st after.
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      return ymd(y, m + 1, Math.min(d, last));
    }
    case 'yearly': {
      const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
      return ymd(y + 1, m, Math.min(d, last));
    }
  }
}

/** Instants (ms) a reminder alerts at: its due time (09:00 if all-day), and an early alert. */
export function alertTimes(r: Reminder, toInstant: (date: string, hhmm: string) => number): number[] {
  if (!r.due || r.completed) return [];
  const at = toInstant(r.due, r.time ?? ALL_DAY_ALERT);
  const out = [at];
  if (r.early && r.time) out.unshift(at - r.early * 60000);
  return out;
}

/** "!", "!!", "!!!" as Apple shows priority before the title. */
export const priorityMarks = (p: Priority) => '!'.repeat(p);

/** Parses "tomorrow 4pm" style dates out of a quick-typed title — the common cases only. */
export function parseQuickDue(title: string, today: string): { title: string; due?: string; time?: string } {
  let rest = title;
  let due: string | undefined;
  let time: string | undefined;
  const tm = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(rest) ?? /\bat\s+(\d{1,2}):(\d{2})\b/i.exec(rest);
  if (tm) {
    let h = Number(tm[1]) % 24;
    const mer = tm[3]?.toLowerCase();
    if (mer === 'pm' && h < 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
    time = `${String(h).padStart(2, '0')}:${tm[2] ?? '00'}`;
    rest = rest.replace(tm[0], ' ');
  }
  const dm = /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(rest);
  if (dm) {
    const w = dm[1].toLowerCase();
    if (w === 'today' || w === 'tonight') due = today;
    else if (w === 'tomorrow') due = addDays(today, 1);
    else {
      const target = LONG_DAYS.findIndex((d) => d.toLowerCase() === w) + 1;
      let k = addDays(today, 1);
      while (weekday(k) !== target) k = addDays(k, 1);
      due = k;
    }
    if (w === 'tonight' && !time) time = '19:00';
    rest = rest.replace(dm[0], ' ');
  }
  if (time && !due) due = today;
  const cleaned = rest.replace(/\s+(on|by|at|due)\s*$/i, '').replace(/\s{2,}/g, ' ').trim();
  return { title: cleaned || title.trim(), due, time };
}
