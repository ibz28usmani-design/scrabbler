/**
 * Sync and shared pages, kept in a D1 database bound as SYNC.
 *
 * Sync: each row the app stores is one row here — its table, its id, when it
 * last changed and on which device, and its contents, which the app
 * encrypted with a passphrase this server never sees. A newer change replaces
 * an older one (last writer wins, per row), and every change takes the next
 * number in one sequence, so a device asks for "everything after N" and gets
 * exactly what it missed. Anything too big for one D1 row is stored in parts.
 *
 * Shared pages: a note or deck the app published read-only, served at /s/<id>
 * to anyone with the link, and nothing else.
 */

export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1 {
  prepare(sql: string): D1Stmt;
  batch(statements: D1Stmt[]): Promise<unknown[]>;
}

/** D1 keeps a row under 2 MB; parts stay well inside that. */
export const PART_CHARS = 1_500_000;
/** Rows handed out per pull. */
export const PULL_LIMIT = 400;
/** Characters of row data per pull, so a response stays a sensible size. */
export const PULL_CHARS = 6_000_000;
export const SYNC_MAX_BODY = 8 * 1024 * 1024;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS rows (tbl TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, dev TEXT NOT NULL, seq INTEGER NOT NULL, del INTEGER NOT NULL DEFAULT 0, parts INTEGER NOT NULL DEFAULT 0, data TEXT, PRIMARY KEY (tbl, id))`,
  `CREATE INDEX IF NOT EXISTS rows_seq ON rows (seq)`,
  `CREATE TABLE IF NOT EXISTS parts (tbl TEXT NOT NULL, id TEXT NOT NULL, n INTEGER NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (tbl, id, n))`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, title TEXT NOT NULL, html TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL)`,
];

let ready: D1 | null = null;

export async function ensureSchema(db: D1) {
  if (ready === db) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready = db;
}

export interface PushRow {
  /** The app's table. */
  t: string;
  /** The row's id there. */
  k: string;
  /** When it changed, on the device that changed it (ms). */
  at: number;
  /** Deleted: a tombstone, so other devices delete it too. */
  del?: boolean;
  /** The encrypted contents; absent for a tombstone, or when sent in parts. */
  data?: string;
  /** How many parts it was sent in beforehand (sync/part). */
  parts?: number;
}

const okName = (s: unknown, max = 200): s is string => typeof s === 'string' && s.length > 0 && s.length <= max;

export function validRow(r: any): r is PushRow {
  return !!r && okName(r.t, 40) && okName(r.k) && Number.isFinite(r.at) && (r.del === true || typeof r.data === 'string' || (Number.isInteger(r.parts) && r.parts > 0));
}

/**
 * Stores rows, each only if it is newer than the copy here (ties go to the
 * device id that sorts later, so every device settles on the same winner).
 * Returns how many were taken.
 */
export async function pushRows(db: D1, dev: string, rows: PushRow[]): Promise<{ taken: number; seq: number }> {
  await ensureSchema(db);
  const before = await currentSeq(db);
  const stmts = rows.map((r) =>
    db
      .prepare(
        `INSERT INTO rows (tbl, id, at, dev, seq, del, parts, data) VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(seq), 0) + 1 FROM rows), ?5, ?6, ?7)
         ON CONFLICT (tbl, id) DO UPDATE SET at = excluded.at, dev = excluded.dev, seq = excluded.seq, del = excluded.del, parts = excluded.parts, data = excluded.data
         WHERE excluded.at > rows.at OR (excluded.at = rows.at AND excluded.dev > rows.dev)`,
      )
      .bind(r.t, r.k, Math.round(r.at), dev, r.del ? 1 : 0, r.del ? 0 : (r.parts ?? 0), r.del ? null : (r.data ?? null)),
  );
  // A deleted row's parts go with it.
  const tombs = rows.filter((r) => r.del).map((r) => db.prepare(`DELETE FROM parts WHERE tbl = ?1 AND id = ?2 AND at <= ?3`).bind(r.t, r.k, Math.round(r.at)));
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  if (tombs.length) await db.batch(tombs);
  const seq = await currentSeq(db);
  return { taken: seq - before, seq };
}

async function currentSeq(db: D1): Promise<number> {
  const r = await db.prepare(`SELECT COALESCE(MAX(seq), 0) AS s FROM rows`).first<{ s: number }>();
  return Number(r?.s ?? 0);
}

/** One part of a large row, stored before the row that points to it. */
export async function putPart(db: D1, t: string, k: string, n: number, at: number, data: string) {
  await ensureSchema(db);
  await db.prepare(`INSERT INTO parts (tbl, id, n, at, data) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (tbl, id, n) DO UPDATE SET at = excluded.at, data = excluded.data WHERE excluded.at >= parts.at`).bind(t, k, n, Math.round(at), data).run();
}

/** A part, with the change it belongs to: a part from a different change than its row is stale. */
export async function getPart(db: D1, t: string, k: string, n: number): Promise<{ data: string; at: number } | null> {
  await ensureSchema(db);
  const r = await db.prepare(`SELECT data, at FROM parts WHERE tbl = ?1 AND id = ?2 AND n = ?3`).bind(t, k, n).first<{ data: string; at: number }>();
  return r ? { data: r.data, at: Number(r.at) } : null;
}

export interface PulledRow {
  t: string;
  k: string;
  at: number;
  dev: string;
  seq: number;
  del: boolean;
  parts: number;
  data: string | null;
}

/** Everything changed after `since`, oldest first, in pages. */
export async function pullRows(db: D1, since: number, limit = PULL_LIMIT): Promise<{ rows: PulledRow[]; more: boolean; seq: number }> {
  await ensureSchema(db);
  const res = await db
    .prepare(`SELECT tbl, id, at, dev, seq, del, parts, data FROM rows WHERE seq > ?1 ORDER BY seq LIMIT ?2`)
    .bind(Math.max(0, Math.floor(since)), limit + 1)
    .all<{ tbl: string; id: string; at: number; dev: string; seq: number; del: number; parts: number; data: string | null }>();
  const rows: PulledRow[] = [];
  let chars = 0;
  for (const r of res.results.slice(0, limit)) {
    // Always at least one row, so a single huge row still gets through.
    if (rows.length && chars + (r.data?.length ?? 0) > PULL_CHARS) break;
    chars += r.data?.length ?? 0;
    rows.push({ t: r.tbl, k: r.id, at: Number(r.at), dev: r.dev, seq: Number(r.seq), del: !!r.del, parts: Number(r.parts), data: r.data });
  }
  const seq = rows.length ? rows[rows.length - 1].seq : since;
  return { rows, more: res.results.length > rows.length, seq };
}

/** The salt the app's passphrase is stretched with: random, made once, the same for every device. */
export async function syncSalt(db: D1): Promise<string> {
  await ensureSchema(db);
  const got = await db.prepare(`SELECT v FROM meta WHERE k = 'salt'`).first<{ v: string }>();
  if (got) return got.v;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = btoa(String.fromCharCode(...bytes));
  // Two devices racing: whichever wrote first wins, and both read that back.
  await db.prepare(`INSERT OR IGNORE INTO meta (k, v) VALUES ('salt', ?1)`).bind(salt).run();
  return (await db.prepare(`SELECT v FROM meta WHERE k = 'salt'`).first<{ v: string }>())!.v;
}

export async function syncStats(db: D1): Promise<{ rows: number; seq: number }> {
  await ensureSchema(db);
  const r = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(MAX(seq), 0) AS s FROM rows WHERE del = 0`).first<{ n: number; s: number }>();
  return { rows: Number(r?.n ?? 0), seq: Number(r?.s ?? 0) };
}

// ---------------------------------------------------------------- shared pages

export const SHARE_MAX = 2 * 1024 * 1024;

export async function putShare(db: D1, id: string, title: string, html: string) {
  await ensureSchema(db);
  const now = Date.now();
  await db
    .prepare(`INSERT INTO shares (id, title, html, created, updated) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT (id) DO UPDATE SET title = excluded.title, html = excluded.html, updated = excluded.updated`)
    .bind(id, title.slice(0, 200), html, now)
    .run();
}

export async function deleteShare(db: D1, id: string) {
  await ensureSchema(db);
  await db.prepare(`DELETE FROM shares WHERE id = ?1`).bind(id).run();
}

/**
 * A shared page, served so it can do nothing but be read: no scripts, no
 * requests anywhere, no framing.
 */
export async function serveShare(db: D1, id: string): Promise<Response> {
  await ensureSchema(db);
  const row = /^[A-Za-z0-9_-]{8,64}$/.test(id) ? await db.prepare(`SELECT html FROM shares WHERE id = ?1`).bind(id).first<{ html: string }>() : null;
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex',
  };
  if (!row) return new Response('<!doctype html><meta charset="utf-8"><title>Not found</title><p>This shared page has been taken down, or the link is wrong.</p>', { status: 404, headers });
  return new Response(row.html, { headers });
}
