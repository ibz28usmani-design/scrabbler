/**
 * Starting data for Peter Symonds College, Lower Sixth, 2026–27: the weekly
 * timetable (from the college timetable for 5–11 October 2026, study periods
 * left out) and the term dates. Both are editable in the app; this only seeds
 * them the first time.
 *
 * Term dates come from the college's "Dates for the Year" page
 * (psc.ac.uk/calendar). Those marked confirmed: false are best guesses until
 * checked there — the app shows them as unconfirmed.
 */
import type { Lesson, Subject, TermCalendar } from './timetable';

export const SYMONDS_CALENDAR_URL = 'https://psc.ac.uk/calendar/';

export const SEED_SUBJECTS: Subject[] = [
  { id: 'law', name: 'Law', color: '#8a5a32' },
  { id: 'economics', name: 'Economics', short: 'Econ', color: '#4b5d3e' },
  { id: 'maths', name: 'Mathematics', short: 'Maths', color: '#3f3b3d' },
  { id: 'symonds-lecture', name: 'Symonds Lecture Programme', short: 'Lecture', color: '#8b4744' },
  { id: 'lamda', name: 'LAMDA Public Speaking', short: 'LAMDA', color: '#504459' },
  { id: 'tutor', name: 'Tutor Group P5X', short: 'Tutor', color: '#575c7e' },
];

const L = (id: string, subjectId: string, day: number, start: string, end: string, room: string, teacher?: string): Lesson => ({ id, subjectId, day, start, end, room, teacher });

export const SEED_LESSONS: Lesson[] = [
  L('mon-1', 'symonds-lecture', 1, '09:55', '10:50', 'Science SC101'),
  L('mon-2', 'economics', 1, '11:10', '13:00', 'NA104', 'Rob Vaulter'),
  L('mon-3', 'tutor', 1, '13:00', '13:55', 'NA103', 'Elaine Slater'),
  L('tue-1', 'law', 2, '11:10', '13:00', 'John Shields JS203', 'Louise Hoddinott'),
  L('tue-2', 'maths', 2, '13:55', '14:50', 'Varley VY224', 'Simon Woods'),
  L('tue-3', 'economics', 2, '14:50', '16:40', 'NA104', 'Stephen Maidment'),
  L('wed-1', 'lamda', 3, '09:55', '10:50', 'College Centre CC212', 'Adam Barlow'),
  L('wed-2', 'maths', 3, '14:50', '16:40', 'Varley VY224', 'Simon Woods'),
  L('thu-1', 'law', 4, '09:00', '10:50', 'John Shields JS203', 'Immie Phelps'),
  L('thu-2', 'economics', 4, '12:05', '13:00', 'NA104', 'Rob Vaulter'),
  L('fri-1', 'maths', 5, '11:10', '13:00', 'Varley VY224', 'Simon Woods'),
  L('fri-2', 'law', 5, '13:55', '14:50', 'John Shields JS203', 'Immie Phelps'),
];

export const SEED_CALENDAR: TermCalendar = {
  terms: [
    { name: 'Autumn term', start: '2026-09-04', end: '2026-12-18', confirmed: true },
    { name: 'Spring term', start: '2027-01-04', end: '2027-03-25', confirmed: true },
    // The college calendar gives the start (12 April); the end is a guess.
    { name: 'Summer term', start: '2027-04-12', end: '2027-07-16', confirmed: false },
  ],
  closures: [
    // Hampshire's half term. The college calendar may start it on Wed 21 Oct.
    { name: 'Autumn half term', start: '2026-10-26', end: '2026-10-30', confirmed: false },
    { name: 'Spring half term', start: '2027-02-15', end: '2027-02-19', confirmed: true },
    { name: 'May bank holiday', start: '2027-05-03', end: '2027-05-03', confirmed: true },
    { name: 'Summer half term', start: '2027-05-31', end: '2027-06-04', confirmed: false },
  ],
};
