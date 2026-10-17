export function dayKey(t: number | Date = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function prevDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}

/** Local midnight `back` days before t's day — by the calendar, so a 23- or 25-hour day doesn't shift it. */
const startOfDay = (t: number, back = 0) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - back);
  return d.getTime();
};

/** Apple Notes-style section label for a timestamp. */
export function groupLabel(t: number, now = Date.now()): string {
  if (t >= startOfDay(now)) return 'Today';
  if (t >= startOfDay(now, 1)) return 'Yesterday';
  if (t >= startOfDay(now, 7)) return 'Previous 7 Days';
  if (t >= startOfDay(now, 30)) return 'Previous 30 Days';
  const d = new Date(t);
  const n = new Date(now);
  if (d.getFullYear() === n.getFullYear()) return d.toLocaleString(undefined, { month: 'long' });
  return String(d.getFullYear());
}

export function shortDate(t: number, now = Date.now()): string {
  const d = new Date(t);
  if (t >= startOfDay(now)) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (t >= startOfDay(now, 6)) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric', year: '2-digit' });
}

export function fmtClock(sec: number): string {
  sec = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Parses "mm:ss", "h:mm:ss" or plain seconds. */
export function parseClock(v: string | number): number {
  if (typeof v === 'number') return v;
  const parts = v.trim().split(':').map(Number);
  if (parts.some((p) => Number.isNaN(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
