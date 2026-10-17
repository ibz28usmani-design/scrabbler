/** The push server's workings, kept apart from worker.ts, whose only export is the worker. */
import { classAlertsInMinute, classAlertText, type Lesson, type Subject, type TermCalendar } from '../../src/lib/timetable';
import { generateVapidKeys, sendPush, type PushMessage, type PushSubscriptionJSON, type VapidKeys } from './webpush';

export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  SCRABBLER?: KV;
  PASSWORD?: string;
}

/** One alert at a fixed time — a reminder. */
export interface TimedAlert extends PushMessage {
  at: number;
}

export interface Device {
  id: string;
  subscription: PushSubscriptionJSON;
  subjects: Subject[];
  lessons: Lesson[];
  calendar: TermCalendar;
  classAlerts: boolean;
  leadMinutes: number;
  /** Heads-up before the first class of each day, in minutes (0 = off). */
  firstLeadMinutes?: number;
  alerts: TimedAlert[];
  updatedAt: number;
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Max-Age': '86400',
};

export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
export const fail = (error: string, status: number) => json({ error }, status);

export const MAX_BODY = 256 * 1024;

export async function vapidKeys(kv: KV): Promise<VapidKeys> {
  const stored = await kv.get('vapid');
  if (stored) return JSON.parse(stored);
  const keys = await generateVapidKeys();
  await kv.put('vapid', JSON.stringify(keys));
  return keys;
}

export async function deviceIds(kv: KV): Promise<string[]> {
  return JSON.parse((await kv.get('devices')) ?? '[]');
}

/** Same-length comparison, so the password can't be guessed a character at a time. */
function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function authorised(req: Request, env: Env) {
  const given = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  return !!env.PASSWORD && sameSecret(given, env.PASSWORD);
}

export function validDevice(d: any): d is Omit<Device, 'updatedAt'> {
  return (
    d &&
    typeof d.id === 'string' &&
    /^[\w-]{8,64}$/.test(d.id) &&
    typeof d.subscription?.endpoint === 'string' &&
    /^https:\/\//.test(d.subscription.endpoint) &&
    typeof d.subscription?.keys?.p256dh === 'string' &&
    typeof d.subscription?.keys?.auth === 'string' &&
    Array.isArray(d.lessons) &&
    Array.isArray(d.subjects) &&
    Array.isArray(d.alerts) &&
    Array.isArray(d.calendar?.terms) &&
    Array.isArray(d.calendar?.closures)
  );
}

/** Forgets a device the browser has dropped. */
export async function forget(kv: KV, id: string) {
  await kv.delete(`device:${id}`);
  await kv.put('devices', JSON.stringify((await deviceIds(kv)).filter((d) => d !== id)));
}

/**
 * Sends one alert; returns the push service's status, or 0 if it couldn't be
 * reached. Never throws. Pass the keys when sending many, to load them once.
 */
export async function send(kv: KV, device: Device, msg: PushMessage, ttl: number, origin: string, keys?: VapidKeys) {
  try {
    const status = await sendPush(device.subscription, msg, keys ?? (await vapidKeys(kv)), { subject: origin, ttl });
    // The browser dropped the subscription: forget the device.
    if (status === 404 || status === 410) await forget(kv, device.id);
    return status;
  } catch (e) {
    // One unreachable push service mustn't stop the other alerts due this minute.
    console.log(`push to ${device.id} failed:`, e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Everything one device should hear about in a given minute. */
export function dueInMinute(device: Device, minute: number): { msg: PushMessage; ttl: number }[] {
  const out: { msg: PushMessage; ttl: number }[] = [];
  if (device.classAlerts) {
    for (const c of classAlertsInMinute(device.lessons, device.calendar, minute, device.leadMinutes)) {
      out.push({
        msg: { ...classAlertText(c, device.subjects, device.leadMinutes), tag: `class-${c.lesson.id}-${c.date}`, url: './?open=calendar' },
        // Useless once class has started.
        ttl: Math.max(60, (c.start - minute) / 1000),
      });
    }
    const first = device.firstLeadMinutes ?? 0;
    // The same lead as every class would only repeat that alert.
    if (first > 0 && first !== device.leadMinutes) {
      for (const c of classAlertsInMinute(device.lessons, device.calendar, minute, first, undefined, true)) {
        out.push({
          msg: { ...classAlertText(c, device.subjects, first, true), tag: `first-${c.lesson.id}-${c.date}`, url: './?open=calendar' },
          ttl: Math.max(60, (c.start - minute) / 1000),
        });
      }
    }
  }
  for (const a of device.alerts) {
    if (a.at >= minute && a.at < minute + 60000) out.push({ msg: { title: a.title, body: a.body, tag: a.tag, url: a.url }, ttl: 86400 });
  }
  return out;
}

export async function runMinute(env: Env, scheduledTime: number, origin: string) {
  const kv = env.SCRABBLER;
  if (!kv) return 0;
  const minute = Math.floor(scheduledTime / 60000) * 60000;
  const keys = await vapidKeys(kv);
  let sent = 0;
  for (const id of await deviceIds(kv)) {
    try {
      const raw = await kv.get(`device:${id}`);
      if (!raw) continue;
      const device: Device = JSON.parse(raw);
      for (const { msg, ttl } of dueInMinute(device, minute)) {
        const status = await send(kv, device, msg, ttl, origin, keys);
        sent++;
        // Gone: the rest of its alerts would only hit the dead endpoint again.
        if (status === 404 || status === 410) break;
      }
    } catch (e) {
      // One device's bad data mustn't silence everyone after it in the list.
      console.log(`alerts for ${id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

/** The worker's own address, for VAPID's contact field (cron runs have no request). */
export async function knownOrigin(kv: KV, req?: Request) {
  if (req) {
    const origin = new URL(req.url).origin;
    if ((await kv.get('origin')) !== origin) await kv.put('origin', origin);
    return origin;
  }
  return (await kv.get('origin')) ?? 'https://scrabbler.invalid';
}

