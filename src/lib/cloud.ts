/**
 * The optional server you own (push-server/): end-to-end encrypted sync between
 * devices, and push notifications for classes and reminders when the app is closed.
 */
import { useSyncExternalStore } from 'react';
import { db, uid } from './db';
import { getS, setS } from './ui';
import type { Lesson, Subject, TermCalendar } from './timetable';

const SYNCED = ['notes', 'folders', 'decks', 'cardSets', 'cards', 'quizzes', 'artifacts', 'reminders', 'lists', 'events', 'sessions'] as const;
const NS = 's2:'; // keeps this version's rows apart from the previous app's on the same server
const SEP = '|';
const PART = 1_400_000;

/* ---------- which rows changed here since the last sync ---------- */
let dirty: Record<string, [number, number]> = JSON.parse(localStorage.getItem('scr2-dirty') || '{}');
let saveT: ReturnType<typeof setTimeout> | undefined;
const saveDirty = () => { clearTimeout(saveT); saveT = setTimeout(() => localStorage.setItem('scr2-dirty', JSON.stringify(dirty)), 150); };
const listeners = new Set<(table: string) => void>();
/** Called for every local change to a synced table. */
export const onLocalChange = (f: (table: string) => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
function touch(t: string, k: unknown, del: number, tx: any) {
  if (tx?.remote || k == null) return;
  if (getS().syncOn) { dirty[t + SEP + k] = [Date.now(), del]; saveDirty(); }
  listeners.forEach(f => f(t));
}
for (const t of SYNCED) {
  const tbl = db.table(t);
  tbl.hook('creating', function (pk, obj, tx) { touch(t, pk ?? (obj as any).id, 0, tx); });
  tbl.hook('updating', function (_m, pk, _o, tx) { touch(t, pk, 0, tx); });
  tbl.hook('deleting', function (pk, _o, tx) { touch(t, pk, 1, tx); });
}
export async function markAllDirty() {
  const now = Date.now();
  for (const t of SYNCED) for (const k of await db.table(t).toCollection().primaryKeys()) dirty[t + SEP + k] = [now, 0];
  saveDirty();
}

/* ---------- notes changed by another device, so open editors can reload ---------- */
const revs = new Map<string, number>(), revSubs = new Set<() => void>();
export const useRev = (id?: string) => useSyncExternalStore(cb => { revSubs.add(cb); return () => { revSubs.delete(cb); }; }, () => (id && revs.get(id)) || 0);

/* ---------- server calls and encryption ---------- */
const base = () => getS().server.trim().replace(/\/+$/, '');
async function api(path: string, body: unknown) {
  if (!base()) throw new Error('Enter your server address first.');
  const r = await fetch(base() + path, { method: 'POST', headers: { Authorization: 'Bearer ' + getS().password, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Server error ${r.status}`);
  return j;
}
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
let keyFor = '', key: CryptoKey | null = null;
async function getKey() {
  const pass = getS().syncPass;
  if (!pass) throw new Error('Choose a sync passphrase first.');
  const { salt } = await api('/sync/salt', {});
  if (key && keyFor === pass + salt) return key;
  const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(salt), iterations: 150000, hash: 'SHA-256' }, raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  keyFor = pass + salt;
  return key;
}
async function enc(k: CryptoKey, obj: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64(out);
}
async function dec(k: CryptoKey, data: string) {
  const u = unb64(data);
  try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, k, u.subarray(12)))); }
  catch { throw new Error('Wrong sync passphrase: it must match the one used on your other devices.'); }
}

/* ---------- sync ---------- */
let running: Promise<{ pulled: number; pushed: number }> | null = null;
export const syncNow = () => (running ||= doSync().finally(() => { running = null; }));
async function doSync() {
  const k = await getKey(), dev = (localStorage.getItem('scr2-dev') || (localStorage.setItem('scr2-dev', uid() + uid()), localStorage.getItem('scr2-dev')))!;
  let pulled = 0, pushed = 0;

  // Pull: everything other devices changed since last time. The newer edit wins.
  for (let since = +(localStorage.getItem('scr2-seq') || 0), more = true; more;) {
    const res = await api('/sync/pull', { since });
    const ops: { t: string; id: string; obj?: any }[] = [];
    for (const r of res.rows) {
      if (!r.t.startsWith(NS) || r.dev === dev) continue;
      const t = r.t.slice(NS.length), mine = dirty[t + SEP + r.k];
      if (!SYNCED.includes(t as any) || (mine && mine[0] > r.at)) continue;
      if (r.del) { ops.push({ t, id: r.k }); continue; }
      let data = r.data || '';
      for (let n = 0; n < r.parts; n++) data += (await api('/sync/part/get', { t: r.t, k: r.k, n })).data;
      ops.push({ t, id: r.k, obj: await dec(k, data) });
    }
    await db.transaction('rw', SYNCED.map(t => db.table(t)), async tx => {
      (tx as any).remote = true;
      for (const o of ops) { if (o.obj) await db.table(o.t).put(o.obj); else await db.table(o.t).delete(o.id); }
    });
    for (const o of ops) { delete dirty[o.t + SEP + o.id]; if (o.t === 'notes') revs.set(o.id, (revs.get(o.id) || 0) + 1); }
    if (ops.length) { saveDirty(); revSubs.forEach(f => f()); }
    pulled += ops.length; since = res.seq; more = res.more;
    localStorage.setItem('scr2-seq', String(since));
  }

  // Push: everything changed here.
  const todo = Object.entries(dirty);
  for (let i = 0; i < todo.length;) {
    const rows: any[] = [], sent: [string, number][] = [];
    for (let size = 0; i < todo.length && rows.length < 300 && size < 4e6; i++) {
      const [id, [at, del]] = todo[i], cut = id.indexOf(SEP), t = id.slice(0, cut), kk = id.slice(cut + 1);
      const obj = del ? null : await db.table(t).get(kk);
      sent.push([id, at]);
      if (!obj) { rows.push({ t: NS + t, k: kk, at, del: true }); continue; }
      const data = await enc(k, obj);
      if (data.length <= PART) { rows.push({ t: NS + t, k: kk, at, data }); size += data.length; continue; }
      const parts = Math.ceil(data.length / PART);
      for (let n = 0; n < parts; n++) await api('/sync/part/put', { t: NS + t, k: kk, n, at, data: data.slice(n * PART, (n + 1) * PART) });
      rows.push({ t: NS + t, k: kk, at, parts });
    }
    await api('/sync/push', { dev, rows });
    for (const [id, at] of sent) if (dirty[id]?.[0] === at) delete dirty[id];
    pushed += rows.length; saveDirty();
  }
  setS({ syncAt: Date.now() });
  return { pulled, pushed };
}
export async function enableSync() {
  setS({ syncOn: true });
  try { await getKey(); await markAllDirty(); return await syncNow(); } catch (e) { setS({ syncOn: false }); throw e; }
}

/* ---------- push notifications ---------- */
/** Term dates the server uses so it never alerts at weekends or in the holidays (Peter Symonds, 2026–27). */
export const CALENDAR: TermCalendar = {
  terms: [{ name: 'Autumn term', start: '2026-09-04', end: '2026-12-18' }, { name: 'Spring term', start: '2027-01-04', end: '2027-03-25' }, { name: 'Summer term', start: '2027-04-12', end: '2027-07-16' }],
  closures: [{ name: 'Autumn half term', start: '2026-10-20', end: '2026-10-30' }, { name: 'Spring half term', start: '2027-02-15', end: '2027-02-19' }, { name: 'May bank holiday', start: '2027-05-03', end: '2027-05-03' }, { name: 'Summer half term', start: '2027-05-31', end: '2027-06-04' }],
};
const pushDev = () => (localStorage.getItem('scr2-push') || (localStorage.setItem('scr2-push', uid() + uid()), localStorage.getItem('scr2-push')))!;
async function registration() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Install Scrabbler on your Home Screen first (Share → Add to Home Screen). iPadOS only lets installed web apps receive notifications.');
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>(r => setTimeout(() => r(null), 6000))]);
  if (!reg) throw new Error('The app is not fully installed yet. Reload and try again.');
  return reg;
}
/** Sends this device's timetable and reminder times to the server. */
export async function sendSchedule() {
  if (!getS().pushOn) return;
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  const evs = (await db.events.toArray()).filter(e => e.weekly), slug = (s: string) => s.toLowerCase().replace(/\W+/g, '-');
  const subjects: Subject[] = [...new Map(evs.map(e => [slug(e.title), { id: slug(e.title), name: e.title, color: e.color }])).values()];
  const lessons: Lesson[] = evs.map(e => ({ id: e.id, subjectId: slug(e.title), day: e.day!, start: e.start, end: e.end, room: e.room, teacher: e.teacher }));
  const alerts = (await db.reminders.filter(r => !r.done && !!r.due).toArray())
    .map(r => ({ at: new Date(`${r.due}T${r.time || '09:00'}`).getTime(), title: 'Reminder', body: r.title, tag: 'rem-' + r.id, url: './?open=reminders' })).filter(a => a.at > Date.now());
  await api('/sync', { id: pushDev(), subscription: sub.toJSON(), subjects, lessons, calendar: CALENDAR, classAlerts: true, leadMinutes: getS().lead, firstLeadMinutes: getS().firstLead, alerts });
}
export async function enablePush() {
  const reg = await registration();
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were not allowed. Allow them for Scrabbler in the device settings.');
  const r = await fetch(base() + '/vapid'), j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Could not reach your server.');
  if (!(await reg.pushManager.getSubscription())) await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64(j.publicKey) });
  setS({ pushOn: true });
  await sendSchedule();
}
export const testPush = () => api('/test', { id: pushDev() });
export async function disablePush() {
  setS({ pushOn: false });
  await api('/unsubscribe', { id: pushDev() }).catch(() => {});
  await (await (await registration()).pushManager.getSubscription())?.unsubscribe();
}
