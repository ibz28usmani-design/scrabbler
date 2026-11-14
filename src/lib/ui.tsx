import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Note } from './db';

/* ---------- settings (localStorage) ---------- */
const DEF = {
  theme: 'auto' as 'auto' | 'light' | 'dark', key: '', textModel: 'gemini-2.5-flash', ttsModel: 'gemini-2.5-flash-preview-tts',
  work: 25, short: 5, long: 15, rounds: 4, deg: true, srcSel: [] as string[], clock24: true,
};
export type Settings = typeof DEF;
const LS = typeof localStorage === 'undefined' ? null : localStorage;
let S: Settings = { ...DEF, ...JSON.parse(LS?.getItem('scr2') || '{}') };
const subs = new Set<() => void>();
const sub = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
export const getS = () => S;
export const setS = (p: Partial<Settings>) => { S = { ...S, ...p }; LS?.setItem('scr2', JSON.stringify(S)); subs.forEach(f => f()); };
export const useS = () => useSyncExternalStore(sub, getS);

/* ---------- toasts ---------- */
let toasts: { id: number; msg: string }[] = [];
const tsubs = new Set<() => void>();
export function toast(msg: string) {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, msg }]; tsubs.forEach(f => f());
  setTimeout(() => { toasts = toasts.filter(t => t.id !== id); tsubs.forEach(f => f()); }, 4500);
}
export function Toasts() {
  const list = useSyncExternalStore(cb => { tsubs.add(cb); return () => { tsubs.delete(cb); }; }, () => toasts);
  return <div className="toasts" role="status">{list.map(t => <div key={t.id} className="toast">{t.msg}</div>)}</div>;
}
/** Wraps an async action: shows errors as a toast instead of throwing. */
export const guard = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
  try { return await fn(); } catch (e: any) { toast(e?.message || String(e)); return undefined; }
};
export function notify(title: string, body = '') {
  toast(body ? `${title} — ${body}` : title);
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted')
      navigator.serviceWorker?.ready.then(r => r.showNotification(title, { body, icon: 'icon-192.png' })).catch(() => {});
  } catch { /* in-app toast already shown */ }
}
export function beep(times = 3) {
  try {
    const ctx = new AudioContext();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.start(t); o.stop(t + 0.3);
    }
  } catch { /* no audio */ }
}

/* ---------- small components ---------- */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-bg" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="ib" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
export function IB({ on, title, onClick, children, disabled }: { on?: boolean; title: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return <button className={'ib' + (on ? ' on' : '')} title={title} aria-label={title} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={onClick}>{children}</button>;
}
/** A text field for values saved to the database as you type: keeps its own text while focused so the caret never jumps. */
export function Field({ value, onChange, area, ...rest }: { value: string; onChange: (v: string) => void; area?: boolean; [k: string]: any }) {
  const [v, setV] = useState(value), focused = useRef(false);
  useEffect(() => { if (!focused.current) setV(value); }, [value]);
  const p = { ...rest, value: v, onFocus: () => { focused.current = true; }, onBlur: () => { focused.current = false; }, onChange: (e: any) => { setV(e.target.value); onChange(e.target.value); } };
  return area ? <textarea {...p} /> : <input {...p} />;
}
export function Head({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return <header className="head"><div><h1>{title}</h1>{sub && <p className="label">{sub}</p>}</div><div className="row">{children}</div></header>;
}

/* ---------- text + date helpers ---------- */
export const strip = (html: string) => html.replace(/<(br|\/p|\/h\d|\/li|\/div|\/tr)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
export const noteText = (n: Note) => Object.values(n.content || {}).map(strip).join('\n').trim();
export const linksOf = (t: string) => [...t.matchAll(/\[\[([^\]\n]+)\]\]/g)].map(m => m[1].trim());
export const tagsOf = (t: string) => [...new Set([...t.matchAll(/(?:^|\s)#([a-zA-Z][\w-]*)/g)].map(m => m[1].toLowerCase()))];
export const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const mins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
export const isoDay = (d: Date) => d.getDay() || 7;
export const monday = (d: Date) => addDays(d, 1 - isoDay(d));
export const nice = (ts: number | string) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export function download(name: string, data: Blob | string, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
/** Prints a copy of the given nodes with the given @page rule. */
export function printNodes(nodes: Element[], page: string, cls = '') {
  const host = document.getElementById('print')!;
  host.className = cls; host.replaceChildren(...nodes.map(n => n.cloneNode(true)));
  let st = document.getElementById('page-style');
  if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.appendChild(st); }
  st.textContent = `@page{${page}}`;
  window.print();
}
export const fileToDataUrl = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f); });
