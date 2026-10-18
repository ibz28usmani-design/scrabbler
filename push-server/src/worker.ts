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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const kv = env.SCRABBLER;

    if (req.method === 'GET' && url.pathname === '/') {
      const ok = !!kv && !!env.PASSWORD;
      const lines = [
        ok ? 'Scrabbler push server is ready.' : 'Scrabbler push server needs setting up:',
        `KV namespace bound as SCRABBLER: ${kv ? 'yes' : 'NO'}`,
        `PASSWORD secret set: ${env.PASSWORD ? 'yes' : 'NO'}`,
        kv ? `Devices registered: ${(await deviceIds(kv)).length}` : '',
        'Also add a Cron Trigger "* * * * *" under Settings → Triggers.',
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
    if (text.length > MAX_BODY) return fail('Too much data.', 413);
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      return fail('Bad JSON.', 400);
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
