/** React hooks over the timetable, term dates and the clock, and keeping the push server in step. */
import { liveQuery } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, getTermCalendar, setMeta, TERM_CALENDAR_KEY } from '../db';
import { scheduleSync, syncPush } from './push';
import { getSettings, useSettings } from './settings';
import type { Lesson, Subject, TermCalendar } from './timetable';

export interface Timetable {
  subjects: Subject[];
  lessons: Lesson[];
  calendar: TermCalendar;
}

export function useTimetable(): Timetable | undefined {
  return useLiveQuery(async () => {
    const [subjects, lessons, calendar] = await Promise.all([db.subjects.toArray(), db.lessons.toArray(), getTermCalendar()]);
    return { subjects, lessons: lessons.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)), calendar };
  }, []);
}

export const saveTermCalendar = (cal: TermCalendar) => setMeta(TERM_CALENDAR_KEY, cal);

/** The current time, ticking every so often. */
export function useNow(everyMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    const wake = () => document.visibilityState === 'visible' && setNow(Date.now());
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [everyMs]);
  return now;
}

/** Re-syncs the push server whenever the timetable, terms, reminders or alert settings change. */
export function usePushSync() {
  const s = useSettings();
  useEffect(() => {
    if (!s.pushEnabled) return;
    const sub = liveQuery(async () => [await db.subjects.toArray(), await db.lessons.toArray(), await db.reminders.toArray(), await db.meta.get(TERM_CALENDAR_KEY)]).subscribe({ next: scheduleSync });
    const onShow = () => document.visibilityState === 'visible' && getSettings().pushEnabled && syncPush().catch(() => {});
    document.addEventListener('visibilitychange', onShow);
    return () => {
      sub.unsubscribe();
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [s.pushEnabled, s.notifyClasses, s.classLeadMinutes, s.notifyReminders, s.pushUrl, s.pushPassword]);
}
