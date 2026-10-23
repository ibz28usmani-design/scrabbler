/**
 * AI requests take turns: at most two at a time, so a lecture, a notebook
 * answer and a quiz don't all trip the free tier's per-minute limit at once.
 * While one waits — on a rate limit, a busy model or a lost connection — the
 * app says so, with a countdown, instead of failing.
 */
import { useSyncExternalStore } from 'react';
import { sleep } from './events';

export const MAX_CONCURRENT = 2;

export interface AiWait {
  /** Why requests are waiting. */
  kind: 'busy' | 'offline' | 'queued';
  /** When the next try is due (busy), if known. */
  until?: number;
  provider: string;
}

let running = 0;
const queue: (() => void)[] = [];
let wait: AiWait | null = null;
const waits = new Map<number, AiWait>();
let seq = 0;
const listeners = new Set<() => void>();

function publish() {
  // The soonest-ending busy wait, else offline, else queued.
  const all = [...waits.values()];
  wait = all.find((w) => w.kind === 'offline') ?? all.filter((w) => w.kind === 'busy').sort((a, b) => (a.until ?? 0) - (b.until ?? 0))[0] ?? (queue.length ? { kind: 'queued', provider: 'AI' } : null);
  listeners.forEach((l) => l());
}

export function getAiWait() {
  return wait;
}

export function useAiWait(): AiWait | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => wait,
  );
}

/** Runs one request once a slot is free. */
export async function inSlot<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    await new Promise<void>((resolve, reject) => {
      const go = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        const i = queue.indexOf(go);
        if (i >= 0) queue.splice(i, 1);
        publish();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      queue.push(go);
      publish();
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  }
  running++;
  publish();
  try {
    return await fn();
  } finally {
    running--;
    queue.shift()?.();
    publish();
  }
}

/** Waits out a rate limit or busy model, showing when the next try is. */
export async function waitBusy(ms: number, provider: string, signal?: AbortSignal) {
  const id = ++seq;
  waits.set(id, { kind: 'busy', until: Date.now() + ms, provider });
  publish();
  try {
    await sleep(ms, signal);
  } finally {
    waits.delete(id);
    publish();
  }
}

export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Waits for the connection to come back, up to a limit (a lecture can wait
 * for the train to leave the tunnel; a quiz the user is staring at
 * shouldn't wait forever). Resolves true once online.
 */
export async function waitOnline(provider: string, signal?: AbortSignal, limitMs = 10 * 60_000): Promise<boolean> {
  if (!isOffline()) return true;
  const id = ++seq;
  waits.set(id, { kind: 'offline', provider });
  publish();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const done = (v: boolean) => {
        clearTimeout(t);
        window.removeEventListener('online', on);
        signal?.removeEventListener('abort', abort);
        resolve(v);
      };
      const on = () => done(true);
      const abort = () => {
        clearTimeout(t);
        window.removeEventListener('online', on);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const t = setTimeout(() => done(!isOffline()), limitMs);
      window.addEventListener('online', on);
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  } finally {
    waits.delete(id);
    publish();
  }
}

/** For tests. */
export function aiQueueState() {
  return { running, queued: queue.length };
}
