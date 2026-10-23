/** How sync is doing, for the banner, the sidebar and Settings (lib/sync.ts does the work). */
import { useSyncExternalStore } from 'react';
import { getSettings } from './settings';

export interface SyncStatus {
  enabled: boolean;
  running: boolean;
  lastOkAt: number | null;
  error: string | null;
  /** Changes on this device not yet sent. */
  pending: number;
}

const KEY = 'scrabbler.syncStatus';

function load(): Pick<SyncStatus, 'lastOkAt' | 'error'> {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { lastOkAt: typeof s.lastOkAt === 'number' ? s.lastOkAt : null, error: typeof s.error === 'string' ? s.error : null };
  } catch {
    return { lastOkAt: null, error: null };
  }
}

let status: SyncStatus = { enabled: false, running: false, pending: 0, ...load() };
const listeners = new Set<() => void>();

export function getSyncStatus(): SyncStatus {
  const enabled = !!getSettings().syncEnabled;
  if (enabled !== status.enabled) status = { ...status, enabled };
  return status;
}

export function setSyncStatus(patch: Partial<SyncStatus>) {
  status = { ...getSyncStatus(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify({ lastOkAt: status.lastOkAt, error: status.error }));
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSyncStatus,
  );
}
