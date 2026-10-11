import { afterEach, describe, expect, it, vi } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
// @ts-expect-error — no types for the reference implementation
import ece from 'http_ece';
import { b64url, encryptPayload, fromB64url, generateVapidKeys, vapidAuthorization } from '../../push-server/src/webpush';
import worker from '../../push-server/src/worker';
import { dueInMinute, type Device, type KV } from '../../push-server/src/alerts';
import { SEED_CALENDAR, SEED_LESSONS, SEED_SUBJECTS } from '../lib/symonds';
import { zonedTime } from '../lib/timetable';

/** A browser's side of a subscription: its key pair and auth secret. */
function browser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const subscription = { endpoint: 'https://web.push.apple.com/QGhello', keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) } };
  const decrypt = (body: Uint8Array) => ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString('utf8');
  return { subscription, decrypt };
}

function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, put: async (k, v) => void data.set(k, v), delete: async (k) => void data.delete(k) };
}

describe('web push encryption', () => {
  it('produces aes128gcm a standard decoder can open', async () => {
    const b = browser();
    const body = await encryptPayload(b.subscription, new TextEncoder().encode('{"title":"Law in 10 min"}'));
    expect(b.decrypt(body)).toBe('{"title":"Law in 10 min"}');
    // salt(16) + rs(4) + idlen(1) + key(65) + payload + delimiter + tag(16)
    expect(body.length).toBe(16 + 4 + 1 + 65 + 25 + 1 + 16);
  });

  it('signs a VAPID token the public key verifies', async () => {
    const keys = await generateVapidKeys();
    const header = await vapidAuthorization('https://web.push.apple.com/abc', keys, 'https://x.workers.dev', Date.UTC(2026, 9, 11));
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(m[2])));
    expect(claims).toEqual({ aud: 'https://web.push.apple.com', exp: Date.UTC(2026, 9, 11) / 1000 + 43200, sub: 'https://x.workers.dev' });
    const pub = await crypto.subtle.importKey('raw', fromB64url(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64url(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });
});

describe('push server', () => {
  afterEach(() => vi.unstubAllGlobals());

  const env = () => ({ SCRABBLER: memoryKV(), PASSWORD: 'correct horse' });
  const req = (path: string, body?: unknown, password = 'correct horse') =>
    new Request(`https://scrabbler-push.example.workers.dev${path}`, body === undefined ? undefined : { method: 'POST', headers: { Authorization: `Bearer ${password}` }, body: JSON.stringify(body) });

  it('says what is missing before it is set up', async () => {
    const res = await worker.fetch(req('/'), {});
    expect(await res.text()).toContain('KV namespace bound as SCRABBLER: NO');
    expect((await worker.fetch(req('/vapid'), { SCRABBLER: memoryKV() })).status).toBe(500);
  });

  it('registers a device behind the password, then sends its class alert on the minute', async () => {
    const e = env();
    const b = browser();
    const { publicKey } = await (await worker.fetch(req('/vapid'), e)).json();
    expect(fromB64url(publicKey)).toHaveLength(65);

    const device = { id: 'ipad-1234abcd', subscription: b.subscription, subjects: SEED_SUBJECTS, lessons: SEED_LESSONS, calendar: SEED_CALENDAR, classAlerts: true, leadMinutes: 10, alerts: [] };
    expect((await worker.fetch(req('/sync', device, 'wrong'), e)).status).toBe(401);
    expect((await worker.fetch(req('/sync', { ...device, id: 'x' }), e)).status).toBe(400);
    expect((await worker.fetch(req('/sync', device), e)).status).toBe(200);
    expect(JSON.parse(e.SCRABBLER.data.get('devices')!)).toEqual(['ipad-1234abcd']);

    const sent: { url: string; headers: Headers; body: Uint8Array }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      sent.push({ url, headers: new Headers(init.headers), body: init.body as Uint8Array });
      return new Response(null, { status: 201 });
    });
    const waits: Promise<unknown>[] = [];
    await worker.scheduled({ scheduledTime: zonedTime('2026-10-15', '08:50') + 7000 }, e, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(b.subscription.endpoint);
    expect(sent[0].headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(Number(sent[0].headers.get('TTL'))).toBe(600);
    expect(JSON.parse(b.decrypt(sent[0].body))).toEqual({ title: 'Law in 10 min', body: '09:00–10:50 · John Shields JS203 · Immie Phelps', tag: 'class-thu-1-2026-10-15', url: './?open=calendar' });

    // Nothing in half term.
    sent.length = 0;
    await worker.scheduled({ scheduledTime: zonedTime('2026-10-29', '08:50') }, e, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    expect(sent).toHaveLength(0);
  });

  it('forgets a device whose subscription the browser dropped', async () => {
    const e = env();
    const b = browser();
    await worker.fetch(req('/vapid'), e);
    const at = zonedTime('2026-10-13', '16:00');
    const device = { id: 'iphone-5678efgh', subscription: b.subscription, subjects: [], lessons: [], calendar: { terms: [], closures: [] }, classAlerts: false, leadMinutes: 0, alerts: [{ at, title: 'Law essay', body: 'Due today' }] };
    vi.stubGlobal('fetch', async () => new Response(null, { status: 410 }));
    // Alerts already in the past are dropped at sync; this one is in the future.
    vi.useFakeTimers({ now: at - 3600000, toFake: ['Date'] });
    await worker.fetch(req('/sync', device), e);
    vi.useRealTimers();
    const waits: Promise<unknown>[] = [];
    await worker.scheduled({ scheduledTime: at }, e, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    expect(e.SCRABBLER.data.has('device:iphone-5678efgh')).toBe(false);
    expect(JSON.parse(e.SCRABBLER.data.get('devices')!)).toEqual([]);
  });

  it('keeps sending when one push service is unreachable', async () => {
    const e = env();
    await worker.fetch(req('/vapid'), e);
    const at = zonedTime('2026-10-13', '16:00');
    vi.useFakeTimers({ now: at - 3600000, toFake: ['Date'] });
    for (const id of ['first-device-aaaa', 'second-device-bbb']) {
      await worker.fetch(req('/sync', { id, subscription: { ...browser().subscription, endpoint: `https://push.example/${id}` }, subjects: [], lessons: [], calendar: { terms: [], closures: [] }, classAlerts: false, leadMinutes: 0, alerts: [{ at, title: 'Essay', body: '' }] }), e);
    }
    vi.useRealTimers();
    const hits: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      hits.push(url);
      if (url.includes('first')) throw new Error('Network connection lost.');
      return new Response(null, { status: 201 });
    });
    const waits: Promise<unknown>[] = [];
    await worker.scheduled({ scheduledTime: at }, e, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    expect(hits).toEqual(['https://push.example/first-device-aaaa', 'https://push.example/second-device-bbb']);
    const res = await worker.fetch(req('/test', { id: 'first-device-aaaa' }), e);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, status: 0 });
  });

  it('picks only what falls in the minute', () => {
    const d: Device = { id: 'x', subscription: browser().subscription, subjects: SEED_SUBJECTS, lessons: SEED_LESSONS, calendar: SEED_CALENDAR, classAlerts: false, leadMinutes: 10, updatedAt: 0, alerts: [{ at: 120_000, title: 'a', body: '' }, { at: 185_000, title: 'b', body: '' }] };
    expect(dueInMinute(d, 120_000).map((x) => x.msg.title)).toEqual(['a']);
    expect(dueInMinute(d, 180_000).map((x) => x.msg.title)).toEqual(['b']);
    expect(dueInMinute(d, zonedTime('2026-10-15', '08:50'))).toEqual([]);
  });
});
