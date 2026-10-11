/**
 * The app's side of push notifications: subscribing this device on your push
 * server (push-server/) and keeping it up to date with the timetable, term
 * dates and reminder times it alerts from.
 */
import { db, getTermCalendar, uid } from '../db';
import { getSettings, updateSettings } from './settings';
import { alertTimes, typeInfo, type Reminder } from './reminders';
import type { Lesson, Subject, TermCalendar } from './timetable';

export interface PushPayload {
  id: string;
  subscription: PushSubscriptionJSON;
  subjects: Subject[];
  lessons: Lesson[];
  calendar: TermCalendar;
  classAlerts: boolean;
  leadMinutes: number;
  firstLeadMinutes: number;
  alerts: { at: number; title: string; body: string; tag: string; url: string }[];
}

/** Why push can't work here, or null when it can. */
export function pushBlocker(): string | null {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    const installed = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
    return installed ? 'This browser can’t receive push notifications.' : 'Add Scrabbler to your Home Screen first (Share → Add to Home Screen), then open it from there — iPadOS only lets installed web apps receive notifications.';
  }
  return null;
}

const base = () => getSettings().pushUrl.trim().replace(/\/+$/, '');

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getSettings().pushPassword}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The push server answered ${res.status}.`);
  return data as T;
}

/** Checks the server address and fetches its public key (kept for the subscribe tap). */
export async function connectServer(): Promise<string> {
  if (!/^https:\/\/[^/]+/.test(base())) throw new Error('Paste your worker’s https:// address.');
  let res: Response;
  try {
    res = await fetch(`${base()}/vapid`);
  } catch {
    throw new Error('Couldn’t reach that address. Check it, and that the worker is deployed.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.publicKey) throw new Error(data.error || 'That address isn’t a Scrabbler push server.');
  updateSettings({ pushPublicKey: data.publicKey });
  return data.publicKey;
}

const keyBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

let readyReg: ServiceWorkerRegistration | null = null;

/**
 * Gets the service worker and the server's key ready before the tap, so the
 * tap itself can go straight to subscribing — the call iPadOS shows its
 * permission request for. Anything awaited first can cost the request.
 */
export function primePush() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then((r) => (readyReg = r)).catch(() => {});
  if (base() && !getSettings().pushPublicKey) connectServer().catch(() => {});
}

/** What the iPad reports, for working out why notifications won't turn on. */
export function pushDiagnostics(): string {
  const installed = matchMedia('(display-mode: standalone)').matches || !!(navigator as { standalone?: boolean }).standalone;
  const perm = typeof Notification === 'undefined' ? 'unavailable' : Notification.permission;
  const safari = /Version\/([\d.]+)/.exec(navigator.userAgent)?.[1];
  return [
    `Installed app: ${installed ? 'yes' : 'no'}`,
    `Permission: ${perm}`,
    `Push: ${'PushManager' in window ? 'yes' : 'no'}`,
    `Service worker: ${readyReg ? 'ready' : 'not ready'}`,
    `Server key: ${getSettings().pushPublicKey ? 'yes' : 'no'}`,
    safari ? `Safari ${safari}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const refusedMessage = (before: NotificationPermission, detail = '') =>
  (before === 'denied'
    ? 'Notifications are off for Scrabbler. Turn them on in the iPad’s Settings → Notifications → Scrabbler.'
    : 'iPadOS said no without showing the permission request.') + (detail ? ` (${detail})` : '');

/**
 * Turns notifications on. Call straight from a tap. With the service worker
 * and key ready (see primePush) it subscribes at once, which is what shows
 * Apple's permission request; otherwise it asks for permission first.
 */
export async function enablePush(): Promise<void> {
  const blocker = pushBlocker();
  if (blocker) throw new Error(blocker);
  const before = Notification.permission;
  const key = getSettings().pushPublicKey;
  let sub: PushSubscription | null = null;

  if (readyReg && key) {
    const reg = readyReg;
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    } catch (e) {
      const err = e as Error;
      // Subscribed before with an old server key: swap it (no prompt needed once allowed).
      if (Notification.permission === 'granted') {
        await (await reg.pushManager.getSubscription())?.unsubscribe();
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      } else {
        throw new Error(refusedMessage(before, `${err.name}: ${err.message}`));
      }
    }
  } else {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error(refusedMessage(before, `asked before the app was ready — tap again`));
    const k = key || (await connectServer());
    const reg = await navigator.serviceWorker.ready;
    readyReg = reg;
    sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, k)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(k) });
  }

  if (!getSettings().pushDeviceId) updateSettings({ pushDeviceId: `device-${uid().replace(/[^\w-]/g, '').slice(0, 24)}` });
  updateSettings({ pushEnabled: true });
  lastSent = '';
  await syncPush(true);
}

function sameKey(sub: PushSubscription, key: string) {
  const current = sub.options.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = keyBytes(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export async function disablePush() {
  const id = getSettings().pushDeviceId;
  updateSettings({ pushEnabled: false });
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    await sub?.unsubscribe();
    if (id && base()) await call('/unsubscribe', { id });
  } catch {
    /* already gone */
  }
}

export async function sendTest(): Promise<void> {
  const r = await call<{ ok: boolean; status: number; error?: string }>('/test', { id: getSettings().pushDeviceId });
  if (!r.ok) throw new Error(r.error ?? `Apple’s push service refused it (${r.status}). Try turning notifications off and on.`);
}

const localInstant = (date: string, hhmm: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
};

/** The reminder alerts for the next 60 days, as the push server wants them. */
export function reminderAlerts(reminders: Reminder[], subjects: Subject[], now = Date.now()) {
  const horizon = now + 60 * 86400000;
  const out: PushPayload['alerts'] = [];
  for (const r of reminders) {
    const times = alertTimes(r, localInstant);
    times.forEach((at, i) => {
      if (at <= now || at > horizon) return;
      const early = r.early && r.time && i === 0 && times.length > 1;
      const subject = subjects.find((s) => s.id === r.subjectId)?.name;
      const kind = typeInfo(r.type)?.label;
      out.push({
        at,
        title: early ? `In ${r.early} min: ${r.title}` : r.title,
        body: [kind, subject, r.time ? `Due ${r.time}` : 'Due today'].filter(Boolean).join(' · '),
        tag: `reminder-${r.id}-${i}`,
        url: './?open=reminders',
      });
    });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 400);
}

let lastSent = '';
let timer = 0;

/** Sends the server what it needs, if it changed since last time. */
export async function syncPush(force = false): Promise<void> {
  const s = getSettings();
  if (!s.pushEnabled || !s.pushDeviceId || !base() || pushBlocker()) return;
  const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  if (!sub) return;
  const [subjects, lessons, calendar, reminders] = await Promise.all([db.subjects.toArray(), db.lessons.toArray(), getTermCalendar(), db.reminders.toArray()]);
  const payload: PushPayload = {
    id: s.pushDeviceId,
    subscription: sub.toJSON() as PushSubscriptionJSON,
    subjects,
    lessons,
    calendar,
    classAlerts: s.notifyClasses,
    leadMinutes: s.classLeadMinutes,
    firstLeadMinutes: s.firstClassLeadMinutes,
    alerts: s.notifyReminders ? reminderAlerts(reminders, subjects) : [],
  };
  const body = JSON.stringify(payload);
  if (!force && body === lastSent) return;
  await call('/sync', payload);
  lastSent = body;
}

/** A change happened: sync a moment later, once the edits settle. */
export function scheduleSync() {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => syncPush().catch((e) => console.warn('Push sync failed', e)), 2500);
}
