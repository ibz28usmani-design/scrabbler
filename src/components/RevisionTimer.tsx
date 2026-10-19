import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../db';
import type { Subject } from '../lib/timetable';
import { dayKey, fmtClock, prevDay } from '../lib/dates';
import { nav, useNav } from '../lib/nav';
import { useSettings } from '../lib/settings';
import { minutesByDay, phaseElapsed, subjectStreak, tickTimer, useTimer, weekMinutes, weekStart, type RevisionTimer } from '../lib/studyTime';
import { toast } from '../lib/events';
import { ITimer } from './Icons';

/*
 * The parts of Revision the whole app needs — the timer that keeps running
 * elsewhere, its chip, and the week's figures — apart from the page itself,
 * which loads only when opened.
 */

/** Ticks once a second while the timer runs, so phase changes happen on time. */
export function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/**
 * Runs the revision timer wherever you are in the app: moves Pomodoro phases
 * on, logs focus blocks, and says so.
 */
export function useTimerEngine() {
  const timer = useTimer();
  useEffect(() => {
    if (!timer) return;
    const run = async () => {
      const ev = await tickTimer();
      if (!ev) return;
      if (ev.kind === 'focus-done') {
        toast(`Focus block done — ${Math.round(ev.minutes)} minutes logged. Take a break.`, 'success');
        navigator.vibrate?.([120, 80, 120]);
      } else if (ev.kind === 'break-done') {
        toast('Break over — back to it.', 'info');
        navigator.vibrate?.(120);
      } else toast('The timer had run four hours, so it stopped and logged four hours. Edit the entry if that’s wrong.', 'info');
    };
    void run();
    const t = setInterval(run, 1000);
    return () => clearInterval(t);
  }, [timer]);
}

/** The running timer, pinned to a corner when you're elsewhere in the app. */
export function TimerChip() {
  const timer = useTimer();
  const { view } = useNav();
  const now = useNow(!!timer);
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  if (!timer || view === 'revision') return null;
  const name = subjects.find((s) => s.id === timer.subjectId)?.short ?? subjects.find((s) => s.id === timer.subjectId)?.name ?? 'Other';
  return (
    <button className={`timer-chip ${timer.phase}`} onClick={() => nav({ view: 'revision', pane: 'list' })} aria-label="Revision timer">
      <ITimer size={16} />
      <span className="timer-chip-clock">{clockFor(timer, now)}</span>
      <span className="timer-chip-label">{timer.phase === 'break' ? 'Break' : name}</span>
    </button>
  );
}

export function clockFor(t: RevisionTimer, now: number) {
  const elapsed = phaseElapsed(t, now) / 1000;
  if (t.mode === 'stopwatch') return fmtClock(elapsed);
  const total = (t.phase === 'focus' ? t.focusMin : t.breakMin) * 60;
  return fmtClock(Math.max(0, total - elapsed));
}

export interface SubjectStats {
  subject: Subject | { id: string; name: string; short?: string };
  streak: ReturnType<typeof subjectStreak>;
  week: number;
  perDay: Map<string, number> | undefined;
}

export function useRevisionData() {
  const settings = useSettings();
  const since = useMemo(() => {
    let d = dayKey();
    for (let i = 0; i < 400; i++) d = prevDay(d);
    return d;
  }, []);
  const sessions = useLiveQuery(() => db.studyTime.where('day').aboveOrEqual(since).toArray(), [since]);
  const subjects = useLiveQuery(() => db.subjects.toArray(), []);
  return useMemo(() => {
    if (!sessions || !subjects) return null;
    const today = dayKey();
    const monday = weekStart(today);
    const byDay = minutesByDay(sessions);
    const tracked = settings.revisionSubjects.map((id) => subjects.find((s) => s.id === id) ?? { id, name: id });
    const stats: SubjectStats[] = tracked.map((subject) => ({
      subject,
      streak: subjectStreak(byDay.get(subject.id), settings.streakMinMinutes, today),
      week: weekMinutes(byDay.get(subject.id), monday),
      perDay: byDay.get(subject.id),
    }));
    const otherIds = [...byDay.keys()].filter((id) => !settings.revisionSubjects.includes(id));
    const otherWeek = otherIds.reduce((sum, id) => sum + weekMinutes(byDay.get(id), monday), 0);
    return { sessions, subjects, stats, otherWeek, byDay, today, monday };
  }, [sessions, subjects, settings.revisionSubjects, settings.streakMinMinutes]);
}

/** For the sidebar: the longest streak running, and whether a timer is going. */
export function useRevisionSummary() {
  const data = useRevisionData();
  const timer = useTimer();
  if (!data) return null;
  return { bestStreak: Math.max(0, ...data.stats.map((s) => s.streak.days)), timerOn: !!timer };
}

