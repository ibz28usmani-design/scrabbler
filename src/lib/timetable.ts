/**
 * The weekly timetable and the college's term dates, and the class times that
 * follow from them. Pure functions with no browser APIs: the push server bundles
 * this same file to work out when to send class alerts.
 *
 * All wall-clock times are in the college's time zone (Europe/London), so a
 * 9:00 class stays at 9:00 across the clocks changing.
 */

export const COLLEGE_TZ = 'Europe/London';

export interface Subject {
  id: string;
  name: string;
  /** Short name for tight spaces: "Econ", "Maths". */
  short?: string;
  color: string;
}

export interface Lesson {
  id: string;
  subjectId: string;
  /** 1 = Monday … 5 = Friday (ISO weekday). */
  day: number;
  /** "HH:MM", 24-hour. */
  start: string;
  end: string;
  room?: string;
  teacher?: string;
}

/** A span of days, inclusive, as "YYYY-MM-DD". */
export interface DateSpan {
  name: string;
  start: string;
  end: string;
  /** False when the dates are a best guess still to be checked against the college. */
  confirmed?: boolean;
}

export interface TermCalendar {
  /** Teaching terms. Days outside every term are holidays. */
  terms: DateSpan[];
  /** Closures inside terms: half terms, bank holidays, training days. */
  closures: DateSpan[];
}

// ------------------------------------------------------------------ dates

/** "YYYY-MM-DD" for a calendar date (no time zone involved). */
export function ymd(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return ymd(y, m, d + n);
}

/** ISO weekday of a "YYYY-MM-DD": 1 = Monday … 7 = Sunday. */
export function weekday(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

const parts = (ms: number, tz: string) => {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
};

/** The date ("YYYY-MM-DD") it is at an instant, in a time zone. */
export function dateIn(ms: number, tz = COLLEGE_TZ): string {
  const p = parts(ms, tz);
  return ymd(p.year, p.month, p.day);
}

/** Minutes past midnight at an instant, in a time zone. */
export function minutesIn(ms: number, tz = COLLEGE_TZ): number {
  const p = parts(ms, tz);
  return p.hour * 60 + p.minute;
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** The instant a wall-clock time happens on a date in a time zone. */
export function zonedTime(key: string, hhmm: string, tz = COLLEGE_TZ): number {
  const [y, mo, d] = key.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi || 0);
  // Guess, then correct by the zone's offset at the guess (twice covers DST edges).
  let t = wall;
  for (let i = 0; i < 2; i++) {
    const p = parts(t, tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    t += wall - shown;
  }
  return t;
}

// ------------------------------------------------------------------ terms

const within = (key: string, s: DateSpan) => key >= s.start && key <= s.end;

export function termOn(key: string, cal: TermCalendar): DateSpan | undefined {
  return cal.terms.find((t) => within(key, t));
}

export function closureOn(key: string, cal: TermCalendar): DateSpan | undefined {
  return cal.closures.find((c) => within(key, c));
}

/** A weekday inside a term and not closed: a day with classes. */
export function isTeachingDay(key: string, cal: TermCalendar): boolean {
  return weekday(key) <= 5 && !!termOn(key, cal) && !closureOn(key, cal);
}

/** What kind of day it is, for labelling the calendar. */
export function dayStatus(key: string, cal: TermCalendar): { kind: 'teaching' | 'weekend' | 'closure' | 'holiday'; label?: string } {
  if (weekday(key) > 5) return { kind: 'weekend' };
  const closure = closureOn(key, cal);
  if (closure && termOn(key, cal)) return { kind: 'closure', label: closure.name };
  if (termOn(key, cal)) return { kind: 'teaching' };
  const named = closure ?? holidayName(key, cal);
  return { kind: 'holiday', label: typeof named === 'string' ? named : named?.name };
}

/** "Christmas holiday" and the like for days between terms. */
function holidayName(key: string, cal: TermCalendar): string | undefined {
  const sorted = [...cal.terms].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < sorted.length - 1; i++) {
    if (key > sorted[i].end && key < sorted[i + 1].start) {
      const month = Number(key.slice(5, 7));
      return month === 12 || month === 1 ? 'Christmas holiday' : month === 3 || month === 4 ? 'Easter holiday' : 'Holiday';
    }
  }
  const last = sorted[sorted.length - 1];
  if (last && key > last.end) return 'Summer holiday';
  return undefined;
}

// ------------------------------------------------------------------ classes

export interface ClassTime {
  lesson: Lesson;
  date: string;
  /** Instants (ms) the class starts and ends. */
  start: number;
  end: number;
}

/** Every class between two instants, in order, skipping weekends, holidays and closures. */
export function classesBetween(lessons: Lesson[], cal: TermCalendar, from: number, to: number, tz = COLLEGE_TZ): ClassTime[] {
  const out: ClassTime[] = [];
  let key = dateIn(from, tz);
  const last = dateIn(to, tz);
  for (let guard = 0; key <= last && guard < 800; guard++, key = addDays(key, 1)) {
    if (!isTeachingDay(key, cal)) continue;
    const wd = weekday(key);
    for (const lesson of lessons) {
      if (lesson.day !== wd) continue;
      const start = zonedTime(key, lesson.start, tz);
      const end = zonedTime(key, lesson.end, tz);
      if (end > from && start < to) out.push({ lesson, date: key, start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The class on now (if any) and the next one to start, looking up to ~8 weeks ahead. */
export function currentAndNext(lessons: Lesson[], cal: TermCalendar, now: number, tz = COLLEGE_TZ): { current?: ClassTime; next?: ClassTime } {
  if (!lessons.length) return {};
  const all = classesBetween(lessons, cal, now, now + 60 * 86400000, tz);
  const current = all.find((c) => c.start <= now && c.end > now);
  const next = all.find((c) => c.start > now);
  return { current, next };
}

/** Is this the first class of its day? (The day's earliest lesson in the timetable.) */
export function isFirstOfDay(c: ClassTime, lessons: Lesson[]): boolean {
  return !lessons.some((l) => l.day === c.lesson.day && l.id !== c.lesson.id && (l.start < c.lesson.start || (l.start === c.lesson.start && l.id < c.lesson.id)));
}

/**
 * Classes whose alert (start minus lead) falls in a given minute — what the
 * push server sends. `firstOnly` keeps just the first class of each day.
 */
export function classAlertsInMinute(lessons: Lesson[], cal: TermCalendar, minuteStart: number, leadMinutes: number, tz = COLLEGE_TZ, firstOnly = false): ClassTime[] {
  const lead = leadMinutes * 60000;
  const window = classesBetween(lessons, cal, minuteStart + lead - 60000, minuteStart + lead + 120000, tz);
  return window.filter((c) => {
    if (firstOnly && !isFirstOfDay(c, lessons)) return false;
    const alertAt = c.start - lead;
    return alertAt >= minuteStart && alertAt < minuteStart + 60000;
  });
}

export function timeRange(l: Lesson) {
  return `${l.start}–${l.end}`;
}

/** "10 min", "1 hour", "1 h 30 min". */
export function leadText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} hour${h === 1 ? '' : 's'}`;
}

/** The words of a class alert; `first` for the heads-up before the day's first class. */
export function classAlertText(c: ClassTime, subjects: Subject[], leadMinutes: number, first = false) {
  const subject = subjects.find((s) => s.id === c.lesson.subjectId);
  const name = subject?.name ?? 'Class';
  const where = [c.lesson.room, c.lesson.teacher].filter(Boolean).join(' · ');
  return {
    title: first ? `First class in ${leadText(leadMinutes)}: ${name}` : leadMinutes > 0 ? `${name} in ${leadText(leadMinutes)}` : `${name} now`,
    body: [timeRange(c.lesson), where].filter(Boolean).join(' · '),
  };
}
