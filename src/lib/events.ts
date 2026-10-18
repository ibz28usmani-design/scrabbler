import { useEffect, useState } from 'react';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

let seq = 0;
const listeners = new Set<(t: Toast) => void>();

export function toast(text: string, kind: Toast['kind'] = 'info') {
  const t = { id: ++seq, text, kind };
  listeners.forEach((l) => l(t));
}

export function emitStatus(text: string) {
  toast(text, 'info');
}

export function toastError(e: unknown) {
  if ((e as Error)?.name === 'AbortError') return;
  const msg = e instanceof Error ? e.message : String(e);
  toast(msg, 'error');
  console.error(e);
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (t: Toast) => {
      setToasts((ts) => [...ts.slice(-3), t]);
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), t.kind === 'error' ? 7000 : 4000);
    };
    listeners.add(on);
    return () => {
      listeners.delete(on);
    };
  }, []);
  return [toasts, (id: number) => setToasts((ts) => ts.filter((x) => x.id !== id))] as const;
}

/** Waits, or rejects with an AbortError as soon as the signal aborts (at once if it already has). */
export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}
