/**
 * A week's revision, fitted around the timetable: each subject's hours still
 * to do this week, in blocks, in the gaps between lessons and in the evening,
 * spread over the days left rather than piled into one.
 */
import type { Lesson, TermCalendar } from './timetable';
import { isTeachingDay, weekday } from './timetable';

export interface PlanBlock {
  day: string;
  /** "HH:MM". */
  start: string;
  minutes: number;
  subjectId: string;
  topic?: string;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Free time on a day, as [start, end) minutes, never before `notBefore`. */
export function freeSlots(day: string, lessons: Lesson[], cal: TermCalendar, notBefore = 0): [number, number][] {
  const teaching = isTeachingDay(day, cal);
  let windows: [number, number][] = teaching
    ? [
        [toMin('08:30'), toMin('17:30')],
        [toMin('18:30'), toMin('21:00')],
      ]
    : [
        [toMin('10:00'), toMin('12:30')],
        [toMin('14:00'), toMin('17:30')],
        [toMin('19:00'), toMin('20:30')],
      ];
  if (teaching) {
    // Lessons, with ten minutes either side to get there and back.
    const busy = lessons.filter((l) => l.day === weekday(day)).map((l) => [toMin(l.start) - 10, toMin(l.end) + 10] as [number, number]);
    for (const [b0, b1] of busy)
      windows = windows.flatMap(([w0, w1]) => (b1 <= w0 || b0 >= w1 ? [[w0, w1]] : ([[w0, b0], [b1, w1]] as [number, number][]).filter(([a, b]) => b > a)));
  }
  return windows.map(([a, b]) => [Math.max(a, notBefore), b] as [number, number]).filter(([a, b]) => b - a >= 25);
}

export interface PlanInput {
  days: string[];
  /** Minutes still to do, per subject. */
  remaining: Map<string, number>;
  slots: Map<string, [number, number][]>;
  /** Topics to suggest per subject, weakest first. */
  topics?: Map<string, string[]>;
  block?: number;
  /** No more revision than this on one day. */
  maxPerDay?: number;
}

export function planWeek({ days, remaining, slots, topics, block = 45, maxPerDay = 180 }: PlanInput): PlanBlock[] {
  const left = new Map([...remaining].filter(([, m]) => m > 0));
  const out: PlanBlock[] = [];
  const topicAt = new Map<string, number>();
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const totalLeft = [...left.values()].reduce((a, b) => a + b, 0);
    if (!totalLeft) break;
    // An even share of what's left for each remaining day.
    let budget = Math.min(maxPerDay, Math.ceil(totalLeft / (days.length - i) / 15) * 15);
    let last = '';
    for (const [s0, s1] of slots.get(day) ?? []) {
      let t = s0;
      while (budget > 0 && s1 - t >= 25) {
        // The subject with most left, but not the one just done if there's another.
        const options = [...left].filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1]);
        const pick = options.find(([id]) => id !== last) ?? options[0];
        if (!pick) break;
        const [subjectId, m] = pick;
        const len = Math.min(block, m, budget, s1 - t);
        if (len < 20) break;
        const list = topics?.get(subjectId) ?? [];
        const k = topicAt.get(subjectId) ?? 0;
        out.push({ day, start: toHHMM(t), minutes: len, subjectId, ...(list.length ? { topic: list[k % list.length] } : {}) });
        topicAt.set(subjectId, k + 1);
        last = subjectId;
        left.set(subjectId, m - len);
        budget -= len;
        t += len + 10;
      }
    }
  }
  return out;
}
