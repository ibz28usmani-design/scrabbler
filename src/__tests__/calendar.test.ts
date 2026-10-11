import { describe, expect, it } from 'vitest';
import { addDays, classAlertsInMinute, classAlertText, classesBetween, currentAndNext, dateIn, dayStatus, isTeachingDay, weekday, zonedTime } from '../lib/timetable';
import { SEED_CALENDAR, SEED_LESSONS, SEED_SUBJECTS } from '../lib/symonds';
import { alertTimes, dayTitle, dueLabel, groupScheduled, groupToday, inSmartList, nextDue, parseQuickDue, type Reminder } from '../lib/reminders';

const at = (iso: string) => new Date(iso).getTime();

describe('timetable times', () => {
  it('reads wall-clock London time across the clocks changing', () => {
    // BST (UTC+1) in October before the change, GMT after.
    expect(new Date(zonedTime('2026-10-15', '09:00')).toISOString()).toBe('2026-10-15T08:00:00.000Z');
    expect(new Date(zonedTime('2026-11-05', '09:00')).toISOString()).toBe('2026-11-05T09:00:00.000Z');
    expect(dateIn(at('2026-10-15T23:30:00Z'))).toBe('2026-10-16');
    expect(weekday('2026-10-11')).toBe(7);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('knows term, half term, holidays and weekends', () => {
    expect(isTeachingDay('2026-10-12', SEED_CALENDAR)).toBe(true);
    expect(isTeachingDay('2026-10-27', SEED_CALENDAR)).toBe(false);
    expect(dayStatus('2026-10-27', SEED_CALENDAR)).toEqual({ kind: 'closure', label: 'Autumn half term' });
    expect(dayStatus('2026-12-23', SEED_CALENDAR)).toEqual({ kind: 'holiday', label: 'Christmas holiday' });
    expect(dayStatus('2027-04-01', SEED_CALENDAR)).toEqual({ kind: 'holiday', label: 'Easter holiday' });
    expect(dayStatus('2026-10-17', SEED_CALENDAR).kind).toBe('weekend');
    expect(isTeachingDay('2027-05-03', SEED_CALENDAR)).toBe(false);
  });
});

describe('classes', () => {
  it('lists the week of 12 October like the college timetable', () => {
    const week = classesBetween(SEED_LESSONS, SEED_CALENDAR, zonedTime('2026-10-12', '00:00'), zonedTime('2026-10-17', '00:00'));
    expect(week).toHaveLength(12);
    expect(week[0].lesson.id).toBe('mon-1');
    expect(new Date(week[0].start).toISOString()).toBe('2026-10-12T08:55:00.000Z');
  });

  it('skips half term entirely', () => {
    const ht = classesBetween(SEED_LESSONS, SEED_CALENDAR, zonedTime('2026-10-24', '00:00'), zonedTime('2026-11-01', '00:00'));
    expect(ht).toEqual([]);
  });

  it('finds the class on now and the next one, across a weekend and a break', () => {
    // Sunday evening 11 Oct → Monday's lecture.
    const sun = currentAndNext(SEED_LESSONS, SEED_CALENDAR, at('2026-10-11T18:37:00Z'));
    expect(sun.current).toBeUndefined();
    expect(sun.next?.lesson.id).toBe('mon-1');
    // During Thursday's Law double.
    const thu = currentAndNext(SEED_LESSONS, SEED_CALENDAR, zonedTime('2026-10-15', '10:00'));
    expect(thu.current?.lesson.id).toBe('thu-1');
    expect(thu.next?.lesson.id).toBe('thu-2');
    // Friday afternoon before half term → Monday 2 November.
    const fri = currentAndNext(SEED_LESSONS, SEED_CALENDAR, zonedTime('2026-10-23', '15:00'));
    expect(fri.next?.date).toBe('2026-11-02');
  });

  it('alerts in exactly one minute, the lead time before class', () => {
    const minute = zonedTime('2026-10-15', '08:50');
    const due = classAlertsInMinute(SEED_LESSONS, SEED_CALENDAR, minute, 10);
    expect(due.map((c) => c.lesson.id)).toEqual(['thu-1']);
    expect(classAlertsInMinute(SEED_LESSONS, SEED_CALENDAR, minute + 60000, 10)).toEqual([]);
    expect(classAlertsInMinute(SEED_LESSONS, SEED_CALENDAR, zonedTime('2026-10-27', '08:50'), 10)).toEqual([]);
    expect(classAlertText(due[0], SEED_SUBJECTS, 10)).toEqual({ title: 'Law in 10 min', body: '09:00–10:50 · John Shields JS203 · Immie Phelps' });
  });

  it('gives the first class of each day a heads-up an hour before', () => {
    const first = (date: string, at: string) => classAlertsInMinute(SEED_LESSONS, SEED_CALENDAR, zonedTime(date, at), 60, undefined, true).map((c) => c.lesson.id);
    expect(first('2026-10-12', '08:55')).toEqual(['mon-1']);
    expect(first('2026-10-12', '10:10')).toEqual([]); // Monday's 11:10 Economics isn't the first class
    expect(first('2026-10-13', '10:10')).toEqual(['tue-1']);
    expect(first('2026-10-15', '08:00')).toEqual(['thu-1']);
    expect(first('2026-10-16', '10:10')).toEqual(['fri-1']);
    expect(first('2026-10-29', '08:00')).toEqual([]); // half term
    const thu = classAlertsInMinute(SEED_LESSONS, SEED_CALENDAR, zonedTime('2026-10-15', '08:00'), 60, undefined, true)[0];
    expect(classAlertText(thu, SEED_SUBJECTS, 60, true).title).toBe('First class in 1 hour: Law');
  });

  it('back-to-back classes each get their own alert', () => {
    // Monday: Economics ends 13:00, Tutor Group starts 13:00.
    const due = classAlertsInMinute(SEED_LESSONS, SEED_CALENDAR, zonedTime('2026-10-12', '12:55'), 5);
    expect(due.map((c) => c.lesson.id)).toEqual(['mon-3']);
  });
});

const R = (p: Partial<Reminder>): Reminder => ({ id: Math.random().toString(36), listId: 'l', title: 't', flagged: false, priority: 0, completed: false, order: 0, createdAt: 0, updatedAt: 0, ...p });

describe('reminders', () => {
  const today = '2026-10-12';

  it('fills the smart lists like Apple Reminders', () => {
    const overdue = R({ due: '2026-10-10' });
    const later = R({ due: '2026-10-20', flagged: true });
    const undated = R({});
    const done = R({ due: today, completed: true });
    const all = [overdue, later, undated, done];
    expect(all.filter((r) => inSmartList(r, 'today', today))).toEqual([overdue]);
    expect(all.filter((r) => inSmartList(r, 'scheduled', today))).toEqual([overdue, later]);
    expect(all.filter((r) => inSmartList(r, 'all', today))).toHaveLength(3);
    expect(all.filter((r) => inSmartList(r, 'flagged', today))).toEqual([later]);
    expect(all.filter((r) => inSmartList(r, 'completed', today))).toEqual([done]);
  });

  it('groups Today into overdue, all-day, morning, afternoon and tonight', () => {
    const g = groupToday([R({ due: today, time: '19:30' }), R({ due: today }), R({ due: '2026-10-01' }), R({ due: today, time: '08:00' }), R({ due: today, time: '13:00' })], today);
    expect(g.map((x) => x.title)).toEqual(['Overdue', 'Today', 'Morning', 'Afternoon', 'Tonight']);
    const s = groupScheduled([R({ due: '2026-10-14' }), R({ due: '2026-10-01' }), R({ due: '2026-10-13' })], today);
    expect(s.map((x) => x.title)).toEqual(['Overdue', 'Tomorrow', 'Wednesday']);
  });

  it('labels due dates', () => {
    expect(dueLabel(R({ due: today, time: '16:00' }), today)).toEqual({ text: 'Today, 16:00', overdue: false });
    expect(dueLabel(R({ due: '2026-10-09' }), today)).toEqual({ text: 'Fri 9 Oct', overdue: true });
    expect(dayTitle('2027-01-04', today)).toBe('Mon 4 Jan 2027');
  });

  it('repeats to the right next date', () => {
    expect(nextDue('2026-10-16', 'weekdays')).toBe('2026-10-19');
    expect(nextDue('2027-01-31', 'monthly')).toBe('2027-02-28');
    expect(nextDue('2028-02-29', 'yearly')).toBe('2029-02-28');
    expect(nextDue('2026-10-12', 'fortnightly')).toBe('2026-10-26');
  });

  it('alerts at the due time, at 9:00 when all-day, and early when asked', () => {
    const inst = (d: string, t: string) => zonedTime(d, t);
    expect(alertTimes(R({ due: today, time: '16:00', early: 30 }), inst)).toEqual([zonedTime(today, '15:30'), zonedTime(today, '16:00')]);
    expect(alertTimes(R({ due: today }), inst)).toEqual([zonedTime(today, '09:00')]);
    expect(alertTimes(R({ due: today, completed: true }), inst)).toEqual([]);
    expect(alertTimes(R({}), inst)).toEqual([]);
  });

  it('reads a date and time out of a quick-typed title', () => {
    expect(parseQuickDue('Law essay tomorrow at 4pm', today)).toEqual({ title: 'Law essay', due: '2026-10-13', time: '16:00' });
    expect(parseQuickDue('Maths homework friday', today)).toEqual({ title: 'Maths homework', due: '2026-10-16', time: undefined });
    expect(parseQuickDue('Revise tonight', today)).toEqual({ title: 'Revise', due: today, time: '19:00' });
    expect(parseQuickDue('Read chapter 3', today)).toEqual({ title: 'Read chapter 3', due: undefined, time: undefined });
  });
});
