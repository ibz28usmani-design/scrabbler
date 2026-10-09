export function dayKey(t: number | Date = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function prevDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Apple Notes-style section label for a timestamp. */
export function groupLabel(t: number, now = Date.now()): string {
  const today = startOfDay(now);
  const day = 86400000;
  if (t >= today) return 'Today';
  if (t >= today - day) return 'Yesterday';
  if (t >= today - 7 * day) return 'Previous 7 Days';
  if (t >= today - 30 * day) return 'Previous 30 Days';
  const d = new Date(t);
  const n = new Date(now);
  if (d.getFullYear() === n.getFullYear()) return d.toLocaleString(undefined, { month: 'long' });
  return String(d.getFullYear());
}

export function shortDate(t: number, now = Date.now()): string {
  const d = new Date(t);
  if (t >= startOfDay(now)) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (t >= startOfDay(now) - 6 * 86400000) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric', year: '2-digit' });
}

export function fmtClock(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
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
