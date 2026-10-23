/**
 * Keeping work from being lost: when the last backup was, whether the
 * browser has promised not to clear this site's storage, and a backup that
 * goes to Files or iCloud Drive in one tap.
 */
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, setMeta } from '../db';
import { download, exportBackup } from './backup';
import { toast, toastError } from './events';

const DAY = 86400000;
export const LAST_BACKUP = 'lastBackupAt';
const SNOOZE_KEY = 'scrabbler.backupSnoozedUntil';
const PERSIST_DISMISSED = 'scrabbler.persistDismissed';

/** Days between reminders: a week, or a month while sync keeps a copy elsewhere. */
export function backupInterval(syncing: boolean) {
  return (syncing ? 30 : 7) * DAY;
}

export function backupName(now = new Date()) {
  return `scrabbler-backup-${now.toISOString().slice(0, 10)}.zip`;
}

/** The newest change to anything worth backing up, from the indexes alone. */
export async function lastChangeAt(): Promise<number> {
  const [note, review, study] = await Promise.all([db.notes.orderBy('updatedAt').last(), db.reviews.orderBy('at').last(), db.studyTime.orderBy('start').last()]);
  return Math.max(note?.updatedAt ?? 0, review?.at ?? 0, study?.start ?? 0);
}

export interface BackupState {
  lastAt: number | null;
  changedSince: boolean;
  overdue: boolean;
  /** Snoozed by "Later". */
  snoozed: boolean;
}

/**
 * A backup is due when there is work newer than the last one and the last
 * one is old, or, never having made one, the oldest work is.
 */
export function backupDue(lastAt: number | null, changeAt: number, firstAt: number, now: number, interval: number): { changedSince: boolean; overdue: boolean } {
  const changedSince = changeAt > (lastAt ?? 0);
  return { changedSince, overdue: changedSince && now - (lastAt ?? firstAt) > interval };
}

export function useBackupState(syncing = false): BackupState | undefined {
  return useLiveQuery(async () => {
    const lastAt = await getMeta<number | null>(LAST_BACKUP, null);
    const [changeAt, first] = await Promise.all([lastChangeAt(), db.notes.orderBy('updatedAt').first()]);
    const now = Date.now();
    const due = backupDue(lastAt, changeAt, first?.createdAt ?? now, now, backupInterval(syncing));
    return { lastAt, ...due, snoozed: snoozedUntil() > now };
  }, [syncing]);
}

function snoozedUntil(): number {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function snoozeBackup(days = 2) {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * DAY));
  } catch {
    /* private mode */
  }
}

/**
 * Makes a backup and hands it to the share sheet, where Save to Files puts
 * it in iCloud Drive; a browser without file sharing downloads it. Safari only
 * shares from a tap, and building the zip can outlast the tap, so then a
 * second tap on the toast shares it.
 */
export async function backupNow(): Promise<boolean> {
  let blob: Blob;
  try {
    blob = await exportBackup();
  } catch (e) {
    toastError(e);
    return false;
  }
  const file = new File([blob], backupName(), { type: 'application/zip' });
  const share = async (): Promise<boolean> => {
    try {
      await navigator.share({ files: [file], title: 'Scrabbler backup' });
      await done();
      return true;
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === 'AbortError') return false;
      if (name === 'NotAllowedError') {
        toast('Your backup is ready.', 'info', { label: 'Save it', run: () => void share() });
        return false;
      }
      download(blob, file.name);
      await done();
      return true;
    }
  };
  const done = async () => {
    await setMeta(LAST_BACKUP, Date.now());
    toast('Backed up ✓', 'success');
  };
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) return share();
  download(blob, file.name);
  await done();
  return true;
}

/** Installed to the Home Screen (iOS's own flag, or the display mode). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (navigator as { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** Whether the browser has promised to keep this site's data; null while unknown or unsupported. */
export function usePersisted(): [boolean | null, () => Promise<boolean>] {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null));
  }, []);
  const ask = async () => {
    const ok = (await navigator.storage?.persist?.().catch(() => false)) ?? false;
    setPersisted(ok);
    return ok;
  };
  return [persisted, ask];
}

export function persistDismissed(): boolean {
  try {
    return sessionStorage.getItem(PERSIST_DISMISSED) === '1';
  } catch {
    return false;
  }
}

export function dismissPersist() {
  try {
    sessionStorage.setItem(PERSIST_DISMISSED, '1');
  } catch {
    /* private mode */
  }
}

export function ago(t: number, now = Date.now()): string {
  const d = Math.floor((now - t) / DAY);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  const m = Math.floor(d / 30);
  return m === 1 ? 'a month ago' : `${m} months ago`;
}
