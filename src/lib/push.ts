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

/**
 * Turns notifications on. Call straight from a tap: iPadOS only shows the
 * permission prompt inside one, so nothing slow happens before it.
 */
export async function enablePush(): Promise<void> {
  const blocker = pushBlocker();
  if (blocker) throw new Error(blocker);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are off for Scrabbler. Turn them on in Settings → Notifications → Scrabbler.');
  const key = getSettings().pushPublicKey || (await connectServer());
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
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
