import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Exam } from '../db';
import { capForExam, daysBetween, examMultiplier, examStart, nextExams, pullCardsBefore, targetMinutes } from '../lib/exams';
import { makeCard, recordReview, Rating } from '../lib/study';

const DAY = 86400000;
const exam = (subjectId: string, date: string, extra: Partial<Exam> = {}): Exam => ({ id: `${subjectId}-${date}`, subjectId, name: 'Paper 1', date, createdAt: 1, ...extra });

describe('exams', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('picks each subject’s next exam, ignoring past ones', () => {
    const next = nextExams([exam('law', '2026-05-01'), exam('law', '2026-06-10'), exam('law', '2026-06-01'), exam('econ', '2026-06-20')], '2026-05-10');
    expect(next.get('law')?.date).toBe('2026-06-01');
    expect(next.get('econ')?.date).toBe('2026-06-20');
  });

  it('raises the weekly target as the exam nears', () => {
    expect(examMultiplier(undefined)).toBe(1);
    expect(examMultiplier(60)).toBe(1);
    expect(examMultiplier(40)).toBe(1.25);
    expect(examMultiplier(20)).toBe(1.5);
    expect(examMultiplier(10)).toBe(1.75);
    expect(examMultiplier(3)).toBe(2);
    expect(targetMinutes(4, exam('law', '2026-05-13'), '2026-05-10')).toBe(480);
    expect(targetMinutes(4, undefined, '2026-05-10')).toBe(240);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2); // across the clocks going forward
  });

  it('keeps a card from coming due after the exam, and leaves near ones alone', () => {
    const now = 1_000 * DAY;
    const at = now + 20 * DAY;
    expect(capForExam({ due: now + 40 * DAY }, at, now).due).toBe(now + 9.5 * DAY);
    expect(capForExam({ due: now + 5 * DAY }, at, now).due).toBe(now + 5 * DAY);
    expect(capForExam({ due: now + 40 * DAY }, undefined, now).due).toBe(now + 40 * DAY);
    // The exam is tomorrow morning: the eve has passed, nothing to bring forward.
    expect(capForExam({ due: now + 9 * DAY }, now + DAY / 2, now).due).toBe(now + 9 * DAY);
  });

  it('schedules a reviewed card before its subject’s exam', async () => {
    await db.folders.add({ id: 'f', name: 'Law', createdAt: 1, order: 0, notesAsSources: true, subjectId: 'law' });
    await db.decks.add({ id: 'd', name: 'Contract', folderId: 'f', createdAt: 1 });
    const inTen = new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10);
    await db.exams.add(exam('law', inTen));
    const card = makeCard('d', { type: 'basic', front: 'Offer?', back: 'A promise' });
    // A well-known card: Easy would push it months away.
    card.sched = { ...card.sched, state: 2, stability: 200, difficulty: 3, reps: 8, scheduled_days: 120, last_review: Date.now() - 120 * DAY, due: Date.now() };
    await db.cards.add(card);
    const { card: after } = await recordReview(card, Rating.Easy, true, 0, 'study');
    expect(after.sched.due).toBeLessThan(examStart({ date: inTen }) - DAY);
  });

  it('brings existing cards forward when an exam is added', async () => {
    await db.folders.bulkAdd([
      { id: 'f', name: 'Law', createdAt: 1, order: 0, notesAsSources: true, subjectId: 'law' },
      { id: 'sub', name: 'Contract', createdAt: 1, order: 1, notesAsSources: true, parentId: 'f' },
    ]);
    await db.decks.add({ id: 'd', name: 'Contract', folderId: 'sub', createdAt: 1 });
    const far = makeCard('d', { type: 'basic', front: 'a', back: 'b' });
    far.sched = { ...far.sched, state: 2, due: Date.now() + 90 * DAY };
    const fresh = makeCard('d', { type: 'basic', front: 'c', back: 'd' });
    await db.cards.bulkAdd([far, fresh]);
    const e = exam('law', new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10));
    expect(await pullCardsBefore('law', e)).toBe(1);
    expect((await db.cards.get(far.id))!.sched.due).toBeLessThan(examStart(e));
    expect((await db.cards.get(fresh.id))!.sched).toEqual(fresh.sched);
  });
});
