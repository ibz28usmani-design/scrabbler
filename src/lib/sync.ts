/**
 * Sync between your devices, through your own push server (a D1 database on
 * the same Cloudflare Worker), end-to-end encrypted with a passphrase.
 *
 * Every write to a synced table is noted as a change (table, id, when). A
 * sync sends the changed rows, encrypted, then fetches everything other
 * devices changed since the last sync and applies it. Per row, the later
 * change wins; a note it replaces is kept in the note's history first, so a
 * clash never loses words. Deletions travel as tombstones.
 */
import Dexie from 'dexie';
import { db, type ID, type Note, type StoredBlob } from '../db';
import { getSettings, updateSettings } from './settings';
import { getSyncStatus, setSyncStatus } from './syncState';
import { deriveKey, decryptBytes, encryptBytes, fromB64, openJson, sealJson, toB64, WrongPassphrase } from './syncCrypto';

/** Tables that travel. Note history stays on each device; it is its own undo. */
export const SYNC_TABLES = ['folders', 'notes', 'sources', 'chunks', 'chats', 'studio', 'decks', 'cards', 'reviews', 'subjects', 'lessons', 'reminderLists', 'reminders', 'studyTime', 'tutor', 'exams', 'papers', 'shares', 'blobs', 'meta'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/** Settings rows that are about your work rather than this device. */
export function syncsMeta(key: string): boolean {
  return key === 'termCalendar' || key === 'game' || key.startsWith('monthNotes:');
}

/** Encrypted text per server part (the server takes up to 1.5 MB). */
export const PART = 1_400_000;
/** Data per push request. */
const PUSH_BUDGET = 4_000_000;

// ---------------------------------------------------------------- the server

export interface PushRow {
  t: string;
  k: string;
  at: number;
  del?: boolean;
  data?: string;
  parts?: number;
}
export interface PulledRow extends PushRow {
  dev: string;
  seq: number;
  data?: string;
  parts?: number;
}

export interface Transport {
  salt(): Promise<{ salt: string; rows: number; seq: number }>;
  push(dev: string, rows: PushRow[]): Promise<{ taken: number; seq: number }>;
  pull(since: number): Promise<{ rows: PulledRow[]; more: boolean; seq: number }>;
  putPart(t: string, k: string, n: number, at: number, data: string): Promise<void>;
  getPart(t: string, k: string, n: number): Promise<{ data: string; at: number }>;
}

/** The push server, reached with the address and password in Settings → Notifications. */
export function httpTransport(url = getSettings().pushUrl, password = getSettings().pushPassword): Transport {
  const base = url.trim().replace(/\/+$/, '');
  const call = async <T>(path: string, body: unknown): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${password}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw new Error('Couldn’t reach your server. Check the connection.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Your server answered ${res.status}.`);
    return data as T;
  };
  return {
    salt: () => call('/sync/salt', {}),
    push: (dev, rows) => call('/sync/push', { dev, rows }),
    pull: (since) => call('/sync/pull', { since }),
    putPart: async (t, k, n, at, data) => void (await call('/sync/part/put', { t, k, n, at, data })),
    getPart: (t, k, n) => call('/sync/part/get', { t, k, n }),
  };
}

// ---------------------------------------------------------------- what changed

const DIRTY_KEY = 'scrabbler.syncDirty';
const CURSOR_KEY = 'scrabbler.syncCursor';
const DEVICE_KEY = 'scrabbler.syncDevice';

/** "table\u0001id" → when it changed. */
let dirty: Map<string, number> = loadDirty();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function loadDirty(): Map<string, number> {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(DIRTY_KEY) || '{}')) as [string, number][]);
  } catch {
    return new Map();
  }
}

function saveDirty() {
  flushTimer = null;
  try {
    localStorage.setItem(DIRTY_KEY, JSON.stringify(Object.fromEntries(dirty)));
  } catch {
    /* full or private: the next full sync covers it */
  }
  setSyncStatus({ pending: dirty.size });
}

const dkey = (t: string, k: string) => `${t}\u0001${k}`;

export function markDirty(t: SyncTable, k: string, at = Date.now()) {
  dirty.set(dkey(t, k), Math.max(at, dirty.get(dkey(t, k)) ?? 0));
  // Several writes in a row are saved together, a moment later.
  flushTimer ??= setTimeout(saveDirty, 50);
  onLocalChange?.();
}

export function pendingChanges() {
  return dirty.size;
}

let onLocalChange: (() => void) | null = null;

/** Marks a sync's own writes, so applying another device's change isn't sent back as a new one. */
const APPLYING = '__scrabblerSyncApply';

let hooked = false;

/** Notes every write to a synced table while sync is on. */
export function installSyncHooks() {
  if (hooked) return;
  hooked = true;
  for (const t of SYNC_TABLES) {
    const table = (db as any)[t] as Dexie.Table;
    const note = (key: unknown, tx: unknown) => {
      if (!getSettings().syncEnabled || (tx as Record<string, unknown>)?.[APPLYING]) return;
      const k = String(key);
      if (t === 'meta' && !syncsMeta(k)) return;
      markDirty(t, k);
    };
    table.hook('creating', function (key, obj, tx) {
      // A new row's key may only be known once it is stored.
      this.onsuccess = (k) => note(k ?? key ?? (obj as { id?: string }).id, tx);
    });
    table.hook('updating', function (_mods, key, _obj, tx) {
      this.onsuccess = () => note(key, tx);
    });
    table.hook('deleting', function (key, _obj, tx) {
      this.onsuccess = () => note(key, tx);
    });
  }
}

/** Every row of every synced table, as changed at `at` — for a first upload or a merge. */
export async function markAllDirty(at: (t: SyncTable, row: any) => number = () => Date.now()) {
  for (const t of SYNC_TABLES) {
    await ((db as any)[t] as Dexie.Table).each((row: any) => {
      const k = t === 'meta' ? row.key : row.id;
      if (t === 'meta' && !syncsMeta(k)) return;
      dirty.set(dkey(t, k), at(t, row));
    });
  }
  saveDirty();
}

export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'this-device';
  }
}

function cursor(): number {
  try {
    return Number(localStorage.getItem(CURSOR_KEY)) || 0;
  } catch {
    return 0;
  }
}

function setCursor(seq: number) {
  try {
    localStorage.setItem(CURSOR_KEY, String(seq));
  } catch {
    /* private mode */
  }
}

/** Reads the bookkeeping again from storage (after it was changed underneath, as in tests). */
export function reloadSyncState() {
  dirty = loadDirty();
  key = null;
}

/** Forgets this device's place, so the next sync reads everything again. */
export function resetSyncState() {
  dirty = new Map();
  saveDirty();
  setCursor(0);
  key = null;
}

// ---------------------------------------------------------------- the key

let key: { pass: string; salt: string; key: CryptoKey } | null = null;

async function keyFor(t: Transport): Promise<CryptoKey> {
  const pass = getSettings().syncPassphrase;
  if (pass.length < 8) throw new Error('Choose a sync passphrase of at least 8 characters in Settings.');
  if (key?.pass === pass) return key.key;
  const { salt } = await t.salt();
  key = { pass, salt, key: await deriveKey(pass, salt) };
  return key.key;
}

// ---------------------------------------------------------------- rows on the wire

/** A blob row: its details as JSON, its bytes as the parts. */
async function sealBlob(k: CryptoKey, b: StoredBlob): Promise<{ meta: string; bytes: string }> {
  const { blob, ...meta } = b;
  const bytes = toB64(await encryptBytes(k, new Uint8Array(await blob.arrayBuffer())));
  return { meta: await sealJson(k, meta), bytes };
}

function split(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += PART) out.push(s.slice(i, i + PART));
  return out.length ? out : [''];
}

async function rowFor(t: Transport, k: CryptoKey, table: SyncTable, id: string, at: number): Promise<PushRow> {
  const value = await ((db as any)[table] as Dexie.Table).get(id);
  if (!value) return { t: table, k: id, at, del: true };
  if (table === 'blobs') {
    const { meta, bytes } = await sealBlob(k, value as StoredBlob);
    const parts = split(bytes);
    for (let n = 0; n < parts.length; n++) await t.putPart(table, id, n, at, parts[n]);
    return { t: table, k: id, at, data: meta, parts: parts.length };
  }
  const sealed = await sealJson(k, value);
  if (sealed.length <= PART) return { t: table, k: id, at, data: sealed };
  const parts = split(sealed);
  for (let n = 0; n < parts.length; n++) await t.putPart(table, id, n, at, parts[n]);
  return { t: table, k: id, at, parts: parts.length };
}

/** Reassembles a row sent in parts; null when a part belongs to a newer change than this row. */
async function joinParts(t: Transport, r: PulledRow): Promise<string | null> {
  let s = '';
  for (let n = 0; n < (r.parts ?? 0); n++) {
    const p = await t.getPart(r.t, r.k, n);
    if (p.at !== r.at) return null;
    s += p.data;
  }
  return s;
}

// ---------------------------------------------------------------- push and pull

async function push(t: Transport, k: CryptoKey, dev: string) {
  const snapshot = [...dirty];
  let batch: PushRow[] = [];
  let size = 0;
  let sent: [string, number][] = [];
  const send = async () => {
    if (!batch.length) return;
    await t.push(dev, batch);
    // Clear what went, unless it changed again meanwhile.
    for (const [dk, at] of sent) if (dirty.get(dk) === at) dirty.delete(dk);
    saveDirty();
    batch = [];
    sent = [];
    size = 0;
  };
  for (const [dk, at] of snapshot) {
    const [table, id] = dk.split('\u0001') as [SyncTable, string];
    if (!(SYNC_TABLES as readonly string[]).includes(table)) {
      dirty.delete(dk);
      continue;
    }
    const row = await rowFor(t, k, table, id, at);
    batch.push(row);
    sent.push([dk, at]);
    size += row.data?.length ?? 0;
    if (size > PUSH_BUDGET || batch.length >= 500) await send();
  }
  await send();
}

export interface Applied {
  rows: number;
  notes: ID[];
}

async function pull(t: Transport, k: CryptoKey, dev: string): Promise<Applied> {
  const out: Applied = { rows: 0, notes: [] };
  let since = cursor();
  for (let page = 0; page < 10_000; page++) {
    const res = await t.pull(since);
    const mine = res.rows.filter((r) => r.dev !== dev);
    const decoded: { r: PulledRow; value: unknown }[] = [];
    for (const r of mine) {
      if (r.del) {
        decoded.push({ r, value: null });
        continue;
      }
      let data = r.data ?? '';
      if (r.t === 'blobs') {
        const bytes = await joinParts(t, r);
        if (bytes === null) continue; // a newer copy is on its way
        const meta = await openJson<Omit<StoredBlob, 'blob'>>(k, data);
        const raw = await decryptBytes(k, fromB64(bytes));
        decoded.push({ r, value: { ...meta, blob: new Blob([raw as BlobPart], { type: meta.mime }) } });
        continue;
      }
      if (r.parts) {
        const joined = await joinParts(t, r);
        if (joined === null) continue;
        data = joined;
      }
      decoded.push({ r, value: await openJson(k, data) });
    }
    if (decoded.length) {
      const changed = await apply(decoded);
      out.rows += decoded.length;
      out.notes.push(...changed);
    }
    since = res.seq;
    setCursor(since);
    if (!res.more) break;
  }
  return out;
}

/**
 * Applies other devices' changes, each unless this device changed the same
 * row later (then this device's copy is sent and wins). A note about to be
 * replaced is kept in its history first.
 */
async function apply(rows: { r: PulledRow; value: unknown }[]): Promise<ID[]> {
  const tables = [...new Set(rows.map(({ r }) => r.t))].filter((x) => (SYNC_TABLES as readonly string[]).includes(x));
  const notes: ID[] = [];
  const { snapshot, NOTE_REPLACED } = await import('./versions');
  // History first, outside the apply (it writes the versions table).
  for (const { r, value } of rows) {
    if (r.t !== 'notes') continue;
    const mineAt = dirty.get(dkey(r.t, r.k));
    if (mineAt !== undefined && mineAt > r.at) continue;
    const local = await db.notes.get(r.k);
    const incoming = value as Note | null;
    if (local && JSON.stringify(local.content ?? '') !== JSON.stringify(incoming?.content ?? '')) await snapshot(local, 'sync', 'From another device');
  }
  await db.transaction('rw', tables.map((x) => (db as any)[x]), async (tx) => {
    (tx as unknown as Record<string, unknown>)[APPLYING] = true;
    for (const { r, value } of rows) {
      const table = (db as any)[r.t] as Dexie.Table | undefined;
      if (!table) continue;
      const dk = dkey(r.t, r.k);
      const mineAt = dirty.get(dk);
      if (mineAt !== undefined && mineAt > r.at) continue;
      if (r.del || value === null) await table.delete(r.k);
      else await table.put(value);
      if (mineAt !== undefined) dirty.delete(dk);
      if (r.t === 'notes') notes.push(r.k);
    }
  });
  saveDirty();
  // An open note shows the new text rather than saving its old text over it.
  if (typeof window !== 'undefined')
    for (const id of notes) {
      const n = await db.notes.get(id);
      if (n) window.dispatchEvent(new CustomEvent(NOTE_REPLACED, { detail: { noteId: id, content: n.content } }));
    }
  return notes;
}

let running: Promise<Applied | null> | null = null;

/** One sync: send what changed here, then fetch what changed elsewhere. */
export async function syncNow(t: Transport = httpTransport()): Promise<Applied | null> {
  if (running) return running;
  running = (async () => {
    if (!getSettings().syncEnabled) return null;
    setSyncStatus({ running: true });
    try {
      const k = await keyFor(t);
      const dev = deviceId();
      await push(t, k, dev);
      const got = await pull(t, k, dev);
      setSyncStatus({ running: false, lastOkAt: Date.now(), error: null, pending: dirty.size });
      return got;
    } catch (e) {
      setSyncStatus({ running: false, error: e instanceof Error ? e.message : String(e) });
      if (e instanceof WrongPassphrase) key = null;
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * Turning sync on. With nothing on the server yet, everything here goes up.
 * When the server already holds another device's notes, `mode` says what to
 * do with this device's: 'replace' clears them and takes the synced ones,
 * 'merge' keeps both (where the same row exists on both, the synced copy
 * wins, since this device's copy is older than any edit made there).
 */
export async function connectSync(mode: 'fresh' | 'replace' | 'merge', t: Transport = httpTransport()): Promise<Applied | null> {
  resetSyncState();
  updateSettings({ syncEnabled: true });
  if (mode === 'replace') {
    await db.transaction('rw', SYNC_TABLES.map((x) => (db as any)[x]), async (tx) => {
      (tx as unknown as Record<string, unknown>)[APPLYING] = true;
      for (const x of SYNC_TABLES) {
        if (x === 'meta') await db.meta.filter((m) => syncsMeta(m.key)).delete();
        else await ((db as any)[x] as Dexie.Table).clear();
      }
    });
  } else {
    // Every row goes up; in a merge, as old as can be, so the synced copy of a shared row wins.
    await markAllDirty(mode === 'merge' ? () => 1 : () => Date.now());
  }
  const res = await syncNow(t);
  if (mode === 'replace') {
    const { initDb } = await import('../db');
    // Puts back anything the app needs that the synced data didn't include.
    await Dexie.ignoreTransaction(() => initDb());
  }
  return res;
}

/** What the server holds, before choosing how to join. */
export async function serverState(t: Transport = httpTransport()) {
  return t.salt();
}

export function disconnectSync() {
  updateSettings({ syncEnabled: false });
  resetSyncState();
  setSyncStatus({ lastOkAt: null, error: null, pending: 0 });
}

// ---------------------------------------------------------------- when to sync

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

function later(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow().catch(() => {}), ms);
}

/**
 * Syncs at start, every two minutes while the app is open, twenty seconds
 * after an edit, when the connection comes back, and when the app is put
 * away.
 */
export function startAutoSync() {
  if (started || typeof window === 'undefined') return;
  started = true;
  onLocalChange = () => getSettings().syncEnabled && later(20_000);
  const tick = () => getSettings().syncEnabled && document.visibilityState === 'visible' && void syncNow().catch(() => {});
  setInterval(tick, 120_000);
  window.addEventListener('online', tick);
  document.addEventListener('visibilitychange', () => {
    if (!getSettings().syncEnabled) return;
    if (document.visibilityState === 'hidden') {
      if (flushTimer) {
        clearTimeout(flushTimer);
        saveDirty();
      }
      if (dirty.size) void syncNow().catch(() => {});
    } else tick();
  });
  setTimeout(tick, 3000);
  setSyncStatus({ pending: dirty.size, enabled: getSyncStatus().enabled });
}
