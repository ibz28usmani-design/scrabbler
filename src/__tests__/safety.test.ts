import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ago, backupDue, backupInterval } from '../lib/safety';

const DAY = 86400000;

describe('backup reminders', () => {
  const now = 1000 * DAY;
  const week = backupInterval(false);

  it('asks for a first backup once the oldest work is a week old', () => {
    expect(backupDue(null, now - DAY, now - 3 * DAY, now, week).overdue).toBe(false);
    expect(backupDue(null, now - DAY, now - 8 * DAY, now, week).overdue).toBe(true);
  });

  it('asks again a week after the last one, but only if something changed', () => {
    expect(backupDue(now - 8 * DAY, now - DAY, 0, now, week)).toEqual({ changedSince: true, overdue: true });
    expect(backupDue(now - 8 * DAY, now - 9 * DAY, 0, now, week)).toEqual({ changedSince: false, overdue: false });
    expect(backupDue(now - 2 * DAY, now - DAY, 0, now, week).overdue).toBe(false);
  });

  it('waits a month while sync keeps a copy elsewhere', () => {
    expect(backupDue(now - 8 * DAY, now - DAY, 0, now, backupInterval(true)).overdue).toBe(false);
    expect(backupDue(now - 31 * DAY, now - DAY, 0, now, backupInterval(true)).overdue).toBe(true);
  });

  it('says how long ago', () => {
    expect(ago(now - 1000, now)).toBe('today');
    expect(ago(now - DAY - 1000, now)).toBe('yesterday');
    expect(ago(now - 12 * DAY, now)).toBe('12 days ago');
    expect(ago(now - 65 * DAY, now)).toBe('2 months ago');
  });
});
