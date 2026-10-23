//#region src/lib/timetable.ts
/**
* The weekly timetable and the college's term dates, and the class times that
* follow from them. Pure functions with no browser APIs: the push server bundles
* this same file to work out when to send class alerts.
*
* All wall-clock times are in the college's time zone (Europe/London), so a
* 9:00 class stays at 9:00 across the clocks changing.
*/
var COLLEGE_TZ = "Europe/London";
/** "YYYY-MM-DD" for a calendar date (no time zone involved). */
function ymd(y, m, d) {
	return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}
function addDays(key, n) {
	const [y, m, d] = key.split("-").map(Number);
	return ymd(y, m, d + n);
}
/** ISO weekday of a "YYYY-MM-DD": 1 = Monday … 7 = Sunday. */
function weekday(key) {
	const [y, m, d] = key.split("-").map(Number);
	const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return w === 0 ? 7 : w;
}
var formatters = /* @__PURE__ */ new Map();
var formatter = (tz) => {
	let f = formatters.get(tz);
	if (!f) formatters.set(tz, f = new Intl.DateTimeFormat("en-GB", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23"
	}));
	return f;
};
var parts = (ms, tz) => {
	const f = formatter(tz);
	const o = {};
	for (const p of f.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
	return o;
};
/** The date ("YYYY-MM-DD") it is at an instant, in a time zone. */
function dateIn(ms, tz = COLLEGE_TZ) {
	const p = parts(ms, tz);
	return ymd(p.year, p.month, p.day);
}
/** The instant a wall-clock time happens on a date in a time zone. */
function zonedTime(key, hhmm, tz = COLLEGE_TZ) {
	const [y, mo, d] = key.split("-").map(Number);
	const [h, mi] = hhmm.split(":").map(Number);
	const wall = Date.UTC(y, mo - 1, d, h, mi || 0);
	let t = wall;
	for (let i = 0; i < 2; i++) {
		const p = parts(t, tz);
		const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
		t += wall - shown;
	}
	return t;
}
var within = (key, s) => key >= s.start && key <= s.end;
function termOn(key, cal) {
	return cal.terms.find((t) => within(key, t));
}
function closureOn(key, cal) {
	return cal.closures.find((c) => within(key, c));
}
/** A weekday inside a term and not closed: a day with classes. */
function isTeachingDay(key, cal) {
	return weekday(key) <= 5 && !!termOn(key, cal) && !closureOn(key, cal);
}
/** Every class between two instants, in order, skipping weekends, holidays and closures. */
function classesBetween(lessons, cal, from, to, tz = COLLEGE_TZ) {
	const out = [];
	let key = dateIn(from, tz);
	const last = dateIn(to, tz);
	for (let guard = 0; key <= last && guard < 800; guard++, key = addDays(key, 1)) {
		if (!isTeachingDay(key, cal)) continue;
		const wd = weekday(key);
		for (const lesson of lessons) {
			if (lesson.day !== wd) continue;
			const start = zonedTime(key, lesson.start, tz);
			const end = zonedTime(key, lesson.end, tz);
			if (end > from && start < to) out.push({
				lesson,
				date: key,
				start,
				end
			});
		}
	}
	return out.sort((a, b) => a.start - b.start);
}
/** Is this the first class of its day? (The day's earliest lesson in the timetable.) */
function isFirstOfDay(c, lessons) {
	return !lessons.some((l) => l.day === c.lesson.day && l.id !== c.lesson.id && (l.start < c.lesson.start || l.start === c.lesson.start && l.id < c.lesson.id));
}
/**
* Classes whose alert (start minus lead) falls in a given minute — what the
* push server sends. `firstOnly` keeps just the first class of each day.
*/
function classAlertsInMinute(lessons, cal, minuteStart, leadMinutes, tz = COLLEGE_TZ, firstOnly = false) {
	const lead = leadMinutes * 6e4;
	return classesBetween(lessons, cal, minuteStart + lead - 6e4, minuteStart + lead + 12e4, tz).filter((c) => {
		if (firstOnly && !isFirstOfDay(c, lessons)) return false;
		const alertAt = c.start - lead;
		return alertAt >= minuteStart && alertAt < minuteStart + 6e4;
	});
}
function timeRange(l) {
	return `${l.start}–${l.end}`;
}
/** "10 min", "1 hour", "1 h 30 min". */
function leadText(minutes) {
	if (minutes < 60) return `${minutes} min`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return m ? `${h} h ${m} min` : `${h} hour${h === 1 ? "" : "s"}`;
}
/** The words of a class alert; `first` for the heads-up before the day's first class. */
function classAlertText(c, subjects, leadMinutes, first = false) {
	const name = subjects.find((s) => s.id === c.lesson.subjectId)?.name ?? "Class";
	const where = [c.lesson.room, c.lesson.teacher].filter(Boolean).join(" · ");
	return {
		title: first ? `First class in ${leadText(leadMinutes)}: ${name}` : leadMinutes > 0 ? `${name} in ${leadText(leadMinutes)}` : `${name} now`,
		body: [timeRange(c.lesson), where].filter(Boolean).join(" · ")
	};
}
//#endregion
//#region push-server/src/webpush.ts
var subtle = () => globalThis.crypto.subtle;
var enc = new TextEncoder();
function b64url(bytes) {
	const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let s = "";
	for (const x of b) s += String.fromCharCode(x);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
	const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
	const bin = atob(pad);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
function concat(...parts) {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}
async function hmac(key, data) {
	const k = await subtle().importKey("raw", key, {
		name: "HMAC",
		hash: "SHA-256"
	}, false, ["sign"]);
	return new Uint8Array(await subtle().sign("HMAC", k, data));
}
async function generateVapidKeys() {
	const pair = await subtle().generateKey({
		name: "ECDSA",
		namedCurve: "P-256"
	}, true, ["sign", "verify"]);
	return {
		publicKey: b64url(await subtle().exportKey("raw", pair.publicKey)),
		privateJwk: await subtle().exportKey("jwk", pair.privateKey)
	};
}
/** The Authorization header value for one push service (its origin is the JWT audience). */
async function vapidAuthorization(endpoint, keys, subject, now = Date.now()) {
	const header = b64url(enc.encode(JSON.stringify({
		typ: "JWT",
		alg: "ES256"
	})));
	const claims = b64url(enc.encode(JSON.stringify({
		aud: new URL(endpoint).origin,
		exp: Math.floor(now / 1e3) + 43200,
		sub: subject
	})));
	const key = await subtle().importKey("jwk", keys.privateJwk, {
		name: "ECDSA",
		namedCurve: "P-256"
	}, false, ["sign"]);
	return `vapid t=${header}.${claims}.${b64url(await subtle().sign({
		name: "ECDSA",
		hash: "SHA-256"
	}, key, enc.encode(`${header}.${claims}`)))}, k=${keys.publicKey}`;
}
/** Encrypts a payload for one subscription: the aes128gcm body, single record. */
async function encryptPayload(sub, payload, salt = crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(16))) {
	const uaPublic = fromB64url(sub.keys.p256dh);
	const authSecret = fromB64url(sub.keys.auth);
	const uaKey = await subtle().importKey("raw", uaPublic, {
		name: "ECDH",
		namedCurve: "P-256"
	}, false, []);
	const local = await subtle().generateKey({
		name: "ECDH",
		namedCurve: "P-256"
	}, true, ["deriveBits"]);
	const asPublic = new Uint8Array(await subtle().exportKey("raw", local.publicKey));
	const prk = await hmac(salt, (await hmac(await hmac(authSecret, new Uint8Array(await subtle().deriveBits({
		name: "ECDH",
		public: uaKey
	}, local.privateKey, 256))), concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])))).slice(0, 32));
	const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
	const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
	const key = await subtle().importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
	const sealed = new Uint8Array(await subtle().encrypt({
		name: "AES-GCM",
		iv: nonce
	}, key, concat(payload, new Uint8Array([2]))));
	const rs = 4096;
	const header = /* @__PURE__ */ new Uint8Array(21);
	header.set(salt, 0);
	new DataView(header.buffer).setUint32(16, rs);
	header[20] = asPublic.length;
	return concat(header, asPublic, sealed);
}
/** Sends one notification. Returns the push service's HTTP status (201 = accepted). */
async function sendPush(sub, msg, keys, opts) {
	const body = await encryptPayload(sub, enc.encode(JSON.stringify(msg)));
	return (await fetch(sub.endpoint, {
		method: "POST",
		headers: {
			Authorization: await vapidAuthorization(sub.endpoint, keys, opts.subject),
			"Content-Encoding": "aes128gcm",
			"Content-Type": "application/octet-stream",
			TTL: String(Math.max(0, Math.round(opts.ttl ?? 3600))),
			Urgency: opts.urgency ?? "high"
		},
		body
	})).status;
}
//#endregion
//#region push-server/src/alerts.ts
/** The push server's workings, kept apart from worker.ts, whose only export is the worker. */
var CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "authorization, content-type",
	"Access-Control-Max-Age": "86400"
};
var json = (data, status = 200) => new Response(JSON.stringify(data), {
	status,
	headers: {
		"Content-Type": "application/json",
		...CORS
	}
});
var fail = (error, status) => json({ error }, status);
async function vapidKeys(kv) {
	const stored = await kv.get("vapid");
	if (stored) return JSON.parse(stored);
	const keys = await generateVapidKeys();
	await kv.put("vapid", JSON.stringify(keys));
	return keys;
}
async function deviceIds(kv) {
	return JSON.parse(await kv.get("devices") ?? "[]");
}
/** Same-length comparison, so the password can't be guessed a character at a time. */
function sameSecret(a, b) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
function authorised(req, env) {
	const given = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
	return !!env.PASSWORD && sameSecret(given, env.PASSWORD);
}
function validDevice(d) {
	return d && typeof d.id === "string" && /^[\w-]{8,64}$/.test(d.id) && typeof d.subscription?.endpoint === "string" && /^https:\/\//.test(d.subscription.endpoint) && typeof d.subscription?.keys?.p256dh === "string" && typeof d.subscription?.keys?.auth === "string" && Array.isArray(d.lessons) && Array.isArray(d.subjects) && Array.isArray(d.alerts) && Array.isArray(d.calendar?.terms) && Array.isArray(d.calendar?.closures);
}
/** The push service's way of saying the subscription no longer exists. */
var isGone = (status) => status === 404 || status === 410;
/** Forgets a device the browser has dropped. */
async function forget(kv, id) {
	await kv.delete(`device:${id}`);
	await kv.put("devices", JSON.stringify((await deviceIds(kv)).filter((d) => d !== id)));
}
/**
* Sends one alert; returns the push service's status, or 0 if it couldn't be
* reached. Never throws. Pass the keys when sending many, to load them once.
*/
async function send(kv, device, msg, ttl, origin, keys) {
	try {
		const status = await sendPush(device.subscription, msg, keys ?? await vapidKeys(kv), {
			subject: origin,
			ttl
		});
		if (isGone(status)) await forget(kv, device.id);
		return status;
	} catch (e) {
		console.log(`push to ${device.id} failed:`, e instanceof Error ? e.message : e);
		return 0;
	}
}
/** Everything one device should hear about in a given minute. */
function dueInMinute(device, minute) {
	const out = [];
	if (device.classAlerts) {
		for (const c of classAlertsInMinute(device.lessons, device.calendar, minute, device.leadMinutes)) out.push({
			msg: {
				...classAlertText(c, device.subjects, device.leadMinutes),
				tag: `class-${c.lesson.id}-${c.date}`,
				url: "./?open=calendar"
			},
			ttl: Math.max(60, (c.start - minute) / 1e3)
		});
		const first = device.firstLeadMinutes ?? 0;
		if (first > 0 && first !== device.leadMinutes) for (const c of classAlertsInMinute(device.lessons, device.calendar, minute, first, void 0, true)) out.push({
			msg: {
				...classAlertText(c, device.subjects, first, true),
				tag: `first-${c.lesson.id}-${c.date}`,
				url: "./?open=calendar"
			},
			ttl: Math.max(60, (c.start - minute) / 1e3)
		});
	}
	for (const a of device.alerts) if (a.at >= minute && a.at < minute + 6e4) out.push({
		msg: {
			title: a.title,
			body: a.body,
			tag: a.tag,
			url: a.url
		},
		ttl: 86400
	});
	return out;
}
async function runMinute(env, scheduledTime, origin) {
	const kv = env.SCRABBLER;
	if (!kv) return 0;
	const minute = Math.floor(scheduledTime / 6e4) * 6e4;
	let keys;
	let sent = 0;
	for (const id of await deviceIds(kv)) try {
		const raw = await kv.get(`device:${id}`);
		if (!raw) continue;
		const device = JSON.parse(raw);
		for (const { msg, ttl } of dueInMinute(device, minute)) {
			keys ??= await vapidKeys(kv);
			const status = await send(kv, device, msg, ttl, origin, keys);
			sent++;
			if (isGone(status)) break;
		}
	} catch (e) {
		console.log(`alerts for ${id} failed:`, e instanceof Error ? e.message : e);
	}
	return sent;
}
/** The worker's own address, for VAPID's contact field (cron runs have no request). */
async function knownOrigin(kv, req) {
	if (req) {
		const origin = new URL(req.url).origin;
		if (await kv.get("origin") !== origin) await kv.put("origin", origin);
		return origin;
	}
	return await kv.get("origin") ?? "https://scrabbler.invalid";
}
var SCHEMA = [
	`CREATE TABLE IF NOT EXISTS rows (tbl TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, dev TEXT NOT NULL, seq INTEGER NOT NULL, del INTEGER NOT NULL DEFAULT 0, parts INTEGER NOT NULL DEFAULT 0, data TEXT, PRIMARY KEY (tbl, id))`,
	`CREATE INDEX IF NOT EXISTS rows_seq ON rows (seq)`,
	`CREATE TABLE IF NOT EXISTS parts (tbl TEXT NOT NULL, id TEXT NOT NULL, n INTEGER NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (tbl, id, n))`,
	`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, title TEXT NOT NULL, html TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL)`
];
var ready = null;
async function ensureSchema(db) {
	if (ready === db) return;
	await db.batch(SCHEMA.map((s) => db.prepare(s)));
	ready = db;
}
var okName = (s, max = 200) => typeof s === "string" && s.length > 0 && s.length <= max;
function validRow(r) {
	return !!r && okName(r.t, 40) && okName(r.k) && Number.isFinite(r.at) && (r.del === true || typeof r.data === "string" || Number.isInteger(r.parts) && r.parts > 0);
}
/**
* Stores rows, each only if it is newer than the copy here (ties go to the
* device id that sorts later, so every device settles on the same winner).
* Returns how many were taken.
*/
async function pushRows(db, dev, rows) {
	await ensureSchema(db);
	const before = await currentSeq(db);
	const stmts = rows.map((r) => db.prepare(`INSERT INTO rows (tbl, id, at, dev, seq, del, parts, data) VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(seq), 0) + 1 FROM rows), ?5, ?6, ?7)
         ON CONFLICT (tbl, id) DO UPDATE SET at = excluded.at, dev = excluded.dev, seq = excluded.seq, del = excluded.del, parts = excluded.parts, data = excluded.data
         WHERE excluded.at > rows.at OR (excluded.at = rows.at AND excluded.dev > rows.dev)`).bind(r.t, r.k, Math.round(r.at), dev, r.del ? 1 : 0, r.del ? 0 : r.parts ?? 0, r.del ? null : r.data ?? null));
	const tombs = rows.filter((r) => r.del).map((r) => db.prepare(`DELETE FROM parts WHERE tbl = ?1 AND id = ?2 AND at <= ?3`).bind(r.t, r.k, Math.round(r.at)));
	for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
	if (tombs.length) await db.batch(tombs);
	const seq = await currentSeq(db);
	return {
		taken: seq - before,
		seq
	};
}
async function currentSeq(db) {
	const r = await db.prepare(`SELECT COALESCE(MAX(seq), 0) AS s FROM rows`).first();
	return Number(r?.s ?? 0);
}
/** One part of a large row, stored before the row that points to it. */
async function putPart(db, t, k, n, at, data) {
	await ensureSchema(db);
	await db.prepare(`INSERT INTO parts (tbl, id, n, at, data) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (tbl, id, n) DO UPDATE SET at = excluded.at, data = excluded.data WHERE excluded.at >= parts.at`).bind(t, k, n, Math.round(at), data).run();
}
/** A part, with the change it belongs to: a part from a different change than its row is stale. */
async function getPart(db, t, k, n) {
	await ensureSchema(db);
	const r = await db.prepare(`SELECT data, at FROM parts WHERE tbl = ?1 AND id = ?2 AND n = ?3`).bind(t, k, n).first();
	return r ? {
		data: r.data,
		at: Number(r.at)
	} : null;
}
/** Everything changed after `since`, oldest first, in pages. */
async function pullRows(db, since, limit = 400) {
	await ensureSchema(db);
	const res = await db.prepare(`SELECT tbl, id, at, dev, seq, del, parts, data FROM rows WHERE seq > ?1 ORDER BY seq LIMIT ?2`).bind(Math.max(0, Math.floor(since)), limit + 1).all();
	const rows = [];
	let chars = 0;
	for (const r of res.results.slice(0, limit)) {
		if (rows.length && chars + (r.data?.length ?? 0) > 6e6) break;
		chars += r.data?.length ?? 0;
		rows.push({
			t: r.tbl,
			k: r.id,
			at: Number(r.at),
			dev: r.dev,
			seq: Number(r.seq),
			del: !!r.del,
			parts: Number(r.parts),
			data: r.data
		});
	}
	const seq = rows.length ? rows[rows.length - 1].seq : since;
	return {
		rows,
		more: res.results.length > rows.length,
		seq
	};
}
/** The salt the app's passphrase is stretched with: random, made once, the same for every device. */
async function syncSalt(db) {
	await ensureSchema(db);
	const got = await db.prepare(`SELECT v FROM meta WHERE k = 'salt'`).first();
	if (got) return got.v;
	const bytes = crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(16));
	const salt = btoa(String.fromCharCode(...bytes));
	await db.prepare(`INSERT OR IGNORE INTO meta (k, v) VALUES ('salt', ?1)`).bind(salt).run();
	return (await db.prepare(`SELECT v FROM meta WHERE k = 'salt'`).first()).v;
}
async function syncStats(db) {
	await ensureSchema(db);
	const r = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(seq), 0) AS s FROM rows WHERE del = 0`).first();
	return {
		rows: Number(r?.n ?? 0),
		seq: Number(r?.s ?? 0)
	};
}
async function putShare(db, id, title, html) {
	await ensureSchema(db);
	const now = Date.now();
	await db.prepare(`INSERT INTO shares (id, title, html, created, updated) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT (id) DO UPDATE SET title = excluded.title, html = excluded.html, updated = excluded.updated`).bind(id, title.slice(0, 200), html, now).run();
}
async function deleteShare(db, id) {
	await ensureSchema(db);
	await db.prepare(`DELETE FROM shares WHERE id = ?1`).bind(id).run();
}
/**
* A shared page, served so it can do nothing but be read: no scripts, no
* requests anywhere, no framing.
*/
async function serveShare(db, id) {
	await ensureSchema(db);
	const row = /^[A-Za-z0-9_-]{8,64}$/.test(id) ? await db.prepare(`SELECT html FROM shares WHERE id = ?1`).bind(id).first() : null;
	const headers = {
		"Content-Type": "text/html; charset=utf-8",
		"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "no-referrer",
		"Cache-Control": "no-store",
		"X-Robots-Tag": "noindex"
	};
	if (!row) return new Response("<!doctype html><meta charset=\"utf-8\"><title>Not found</title><p>This shared page has been taken down, or the link is wrong.</p>", {
		status: 404,
		headers
	});
	return new Response(row.html, { headers });
}
//#endregion
//#region push-server/src/worker.ts
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
var worker_default = {
	async fetch(req, env) {
		const url = new URL(req.url);
		if (req.method === "OPTIONS") return new Response(null, {
			status: 204,
			headers: CORS
		});
		const kv = env.SCRABBLER;
		if (req.method === "GET" && url.pathname.startsWith("/s/")) {
			if (!env.SYNC) return new Response("Sharing isn’t set up on this server.", { status: 404 });
			return serveShare(env.SYNC, url.pathname.slice(3));
		}
		if (req.method === "GET" && url.pathname === "/") {
			const lines = [
				!!kv && !!env.PASSWORD ? "Scrabbler push server is ready." : "Scrabbler push server needs setting up:",
				`KV namespace bound as SCRABBLER: ${kv ? "yes" : "NO"}`,
				`PASSWORD secret set: ${env.PASSWORD ? "yes" : "NO"}`,
				kv ? `Devices registered: ${(await deviceIds(kv)).length}` : "",
				"Also add a Cron Trigger \"* * * * *\" under Settings → Triggers.",
				`D1 database bound as SYNC (for sync and sharing, optional): ${env.SYNC ? "yes" : "no"}`
			];
			return new Response(lines.filter(Boolean).join("\n"), { headers: {
				"Content-Type": "text/plain; charset=utf-8",
				...CORS
			} });
		}
		if (!kv) return fail("Bind a KV namespace as SCRABBLER in the worker’s settings.", 500);
		if (!env.PASSWORD) return fail("Add a secret named PASSWORD in the worker’s settings.", 500);
		if (req.method === "GET" && url.pathname === "/vapid") {
			await knownOrigin(kv, req);
			return json({ publicKey: (await vapidKeys(kv)).publicKey });
		}
		if (req.method !== "POST") return fail("Not found", 404);
		if (!authorised(req, env)) return fail("Wrong password.", 401);
		const text = await req.text();
		const syncing = url.pathname.startsWith("/sync/") || url.pathname.startsWith("/share/");
		if (text.length > (syncing ? 8388608 : 262144)) return fail("Too much data.", 413);
		let body;
		try {
			body = JSON.parse(text);
		} catch {
			return fail("Bad JSON.", 400);
		}
		if (syncing) {
			const db = env.SYNC;
			if (!db) return fail("Sync needs a D1 database bound as SYNC in the worker’s settings (push-server/README.md, “Sync and sharing”).", 501);
			switch (url.pathname) {
				case "/sync/salt": return json({
					salt: await syncSalt(db),
					...await syncStats(db)
				});
				case "/sync/push":
					if (typeof body.dev !== "string" || !Array.isArray(body.rows) || body.rows.length > 2e3) return fail("Bad sync data.", 400);
					if (!body.rows.every(validRow)) return fail("A row was incomplete.", 400);
					return json(await pushRows(db, body.dev, body.rows));
				case "/sync/pull": return json(await pullRows(db, Number(body.since) || 0));
				case "/sync/part/put":
					if (typeof body.t !== "string" || typeof body.k !== "string" || !Number.isInteger(body.n) || typeof body.data !== "string" || body.data.length > 15e5) return fail("Bad part.", 400);
					await putPart(db, body.t, body.k, body.n, Number(body.at) || 0, body.data);
					return json({ ok: true });
				case "/sync/part/get": {
					const part = await getPart(db, String(body.t), String(body.k), Number(body.n) || 0);
					return part ? json(part) : fail("That part is missing.", 404);
				}
				case "/share/put":
					if (typeof body.id !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(body.id) || typeof body.html !== "string" || body.html.length > 2097152) return fail("Bad page.", 400);
					await putShare(db, body.id, String(body.title ?? ""), body.html);
					return json({
						ok: true,
						url: new URL(`/s/${body.id}`, req.url).href
					});
				case "/share/delete":
					if (typeof body.id !== "string") return fail("Which page?", 400);
					await deleteShare(db, body.id);
					return json({ ok: true });
			}
			return fail("Not found", 404);
		}
		const origin = await knownOrigin(kv, req);
		if (url.pathname === "/sync") {
			if (!validDevice(body)) return fail("That device data is incomplete.", 400);
			const device = {
				id: body.id,
				subscription: {
					endpoint: body.subscription.endpoint,
					keys: {
						p256dh: body.subscription.keys.p256dh,
						auth: body.subscription.keys.auth
					}
				},
				subjects: body.subjects,
				lessons: body.lessons,
				calendar: body.calendar,
				classAlerts: body.classAlerts !== false,
				leadMinutes: Math.max(0, Math.min(120, Number(body.leadMinutes) || 0)),
				firstLeadMinutes: Math.max(0, Math.min(240, Number(body.firstLeadMinutes) || 0)),
				alerts: body.alerts.filter((a) => typeof a?.at === "number" && a.at > Date.now() - 6e4 && typeof a.title === "string").slice(0, 500),
				updatedAt: Date.now()
			};
			await kv.put(`device:${device.id}`, JSON.stringify(device));
			const ids = await deviceIds(kv);
			if (!ids.includes(device.id)) await kv.put("devices", JSON.stringify([...ids, device.id]));
			return json({
				ok: true,
				alerts: device.alerts.length
			});
		}
		if (url.pathname === "/test") {
			const raw = typeof body.id === "string" ? await kv.get(`device:${body.id}`) : null;
			if (!raw) return fail("This device isn’t registered yet — turn notifications on first.", 404);
			const status = await send(kv, JSON.parse(raw), {
				title: "Scrabbler",
				body: "Notifications are working. You’ll hear about your next class here.",
				tag: "test",
				url: "./?open=calendar"
			}, 300, origin);
			return json({
				ok: status >= 200 && status < 300,
				status,
				...status ? {} : { error: "The push service couldn’t be reached." }
			});
		}
		if (url.pathname === "/unsubscribe") {
			if (typeof body.id !== "string") return fail("Which device?", 400);
			await forget(kv, body.id);
			return json({ ok: true });
		}
		return fail("Not found", 404);
	},
	async scheduled(event, env, ctx) {
		const kv = env.SCRABBLER;
		if (!kv) return;
		ctx.waitUntil(knownOrigin(kv).then((origin) => runMinute(env, event.scheduledTime, origin)));
	}
};
//#endregion
export { worker_default as default };
