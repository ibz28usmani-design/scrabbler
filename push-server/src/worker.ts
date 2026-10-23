/**
 * Scrabbler's push server: a Cloudflare Worker that sends class and reminder
 * notifications to your devices while the app is closed.
 *
 * The app sends it your timetable, term dates and upcoming reminder times;
 * every minute a Cron Trigger checks what is due and pushes it. Class times are
 * worked out here from the timetable, so class alerts keep coming without the
 * app being opened. Needs (see push-server/README.md):
 *   - a KV namespace bound as SCRABBLER
 *   - a secret named PASSWORD (also typed into Scrabbler's Settings)
 *   - a Cron Trigger: * * * * *
 */
import { authorised, CORS, deviceIds, fail, forget, json, knownOrigin, MAX_BODY, runMinute, send, validDevice, vapidKeys, type Device, type Env } from './alerts';
import { deleteShare, getPart, PART_CHARS, pullRows, pushRows, putPart, putShare, serveShare, SHARE_MAX, SYNC_MAX_BODY, syncSalt, syncStats, validRow } from './sync';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const kv = env.SCRABBLER;

    // Shared pages are public: anyone with the link may read one, and only that.
    if (req.method === 'GET' && url.pathname.startsWith('/s/')) {
      if (!env.SYNC) return new Response('Sharing isn’t set up on this server.', { status: 404 });
      return serveShare(env.SYNC, url.pathname.slice(3));
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const ok = !!kv && !!env.PASSWORD;
      const lines = [
        ok ? 'Scrabbler push server is ready.' : 'Scrabbler push server needs setting up:',
        `KV namespace bound as SCRABBLER: ${kv ? 'yes' : 'NO'}`,
        `PASSWORD secret set: ${env.PASSWORD ? 'yes' : 'NO'}`,
        kv ? `Devices registered: ${(await deviceIds(kv)).length}` : '',
        'Also add a Cron Trigger "* * * * *" under Settings → Triggers.',
        `D1 database bound as SYNC (for sync and sharing, optional): ${env.SYNC ? 'yes' : 'no'}`,
      ];
      return new Response(lines.filter(Boolean).join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS } });
    }
    if (!kv) return fail('Bind a KV namespace as SCRABBLER in the worker’s settings.', 500);
    if (!env.PASSWORD) return fail('Add a secret named PASSWORD in the worker’s settings.', 500);

    if (req.method === 'GET' && url.pathname === '/vapid') {
      await knownOrigin(kv, req);
      return json({ publicKey: (await vapidKeys(kv)).publicKey });
    }

    if (req.method !== 'POST') return fail('Not found', 404);
    if (!authorised(req, env)) return fail('Wrong password.', 401);
    const text = await req.text();
    const syncing = url.pathname.startsWith('/sync/') || url.pathname.startsWith('/share/');
    if (text.length > (syncing ? SYNC_MAX_BODY : MAX_BODY)) return fail('Too much data.', 413);
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      return fail('Bad JSON.', 400);
    }
    if (syncing) {
      const db = env.SYNC;
      if (!db) return fail('Sync needs a D1 database bound as SYNC in the worker’s settings (push-server/README.md, “Sync and sharing”).', 501);
      switch (url.pathname) {
        case '/sync/salt':
          return json({ salt: await syncSalt(db), ...(await syncStats(db)) });
        case '/sync/push': {
          if (typeof body.dev !== 'string' || !Array.isArray(body.rows) || body.rows.length > 2000) return fail('Bad sync data.', 400);
          if (!body.rows.every(validRow)) return fail('A row was incomplete.', 400);
          return json(await pushRows(db, body.dev, body.rows));
        }
        case '/sync/pull':
          return json(await pullRows(db, Number(body.since) || 0));
        case '/sync/part/put': {
          if (typeof body.t !== 'string' || typeof body.k !== 'string' || !Number.isInteger(body.n) || typeof body.data !== 'string' || body.data.length > PART_CHARS) return fail('Bad part.', 400);
          await putPart(db, body.t, body.k, body.n, Number(body.at) || 0, body.data);
          return json({ ok: true });
        }
        case '/sync/part/get': {
          const part = await getPart(db, String(body.t), String(body.k), Number(body.n) || 0);
          return part ? json(part) : fail('That part is missing.', 404);
        }
        case '/share/put': {
          if (typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(body.id) || typeof body.html !== 'string' || body.html.length > SHARE_MAX) return fail('Bad page.', 400);
          await putShare(db, body.id, String(body.title ?? ''), body.html);
          return json({ ok: true, url: new URL(`/s/${body.id}`, req.url).href });
        }
        case '/share/delete':
          if (typeof body.id !== 'string') return fail('Which page?', 400);
          await deleteShare(db, body.id);
          return json({ ok: true });
      }
      return fail('Not found', 404);
    }

    const origin = await knownOrigin(kv, req);

    if (url.pathname === '/sync') {
      if (!validDevice(body)) return fail('That device data is incomplete.', 400);
      const device: Device = {
        id: body.id,
        subscription: { endpoint: body.subscription.endpoint, keys: { p256dh: body.subscription.keys.p256dh, auth: body.subscription.keys.auth } },
        subjects: body.subjects,
        lessons: body.lessons,
        calendar: body.calendar,
        classAlerts: body.classAlerts !== false,
        leadMinutes: Math.max(0, Math.min(120, Number(body.leadMinutes) || 0)),
        firstLeadMinutes: Math.max(0, Math.min(240, Number(body.firstLeadMinutes) || 0)),
        alerts: body.alerts.filter((a: any) => typeof a?.at === 'number' && a.at > Date.now() - 60000 && typeof a.title === 'string').slice(0, 500),
        updatedAt: Date.now(),
      };
      await kv.put(`device:${device.id}`, JSON.stringify(device));
      const ids = await deviceIds(kv);
      if (!ids.includes(device.id)) await kv.put('devices', JSON.stringify([...ids, device.id]));
      return json({ ok: true, alerts: device.alerts.length });
    }

    if (url.pathname === '/test') {
      const raw = typeof body.id === 'string' ? await kv.get(`device:${body.id}`) : null;
      if (!raw) return fail('This device isn’t registered yet — turn notifications on first.', 404);
      const status = await send(kv, JSON.parse(raw), { title: 'Scrabbler', body: 'Notifications are working. You’ll hear about your next class here.', tag: 'test', url: './?open=calendar' }, 300, origin);
      return json({ ok: status >= 200 && status < 300, status, ...(status ? {} : { error: 'The push service couldn’t be reached.' }) });
    }

    if (url.pathname === '/unsubscribe') {
      if (typeof body.id !== 'string') return fail('Which device?', 400);
      await forget(kv, body.id);
      return json({ ok: true });
    }

    return fail('Not found', 404);
  },

  async scheduled(event: { scheduledTime: number }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const kv = env.SCRABBLER;
    if (!kv) return;
    ctx.waitUntil(knownOrigin(kv).then((origin) => runMinute(env, event.scheduledTime, origin)));
  },
};
