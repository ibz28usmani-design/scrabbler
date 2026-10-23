import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, type Note } from '../db';
import { updateSettings } from '../lib/settings';
import { connectSync, installSyncHooks, pendingChanges, reloadSyncState as resetSyncStateKeepingPlace, resetSyncState, syncNow, type Transport } from '../lib/sync';
import { installVersionHooks, versionsOf } from '../lib/versions';
import { getPart, pullRows, pushRows, putPart, syncSalt, type D1 } from '../../push-server/src/sync';
import { fakeD1 } from './helpers/d1';

// localStorage for the sync bookkeeping, as a browser has.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

/** The server functions behind a transport, with a counter of what crossed the wire. */
function serverTransport(d1: D1, seen: { pushed: string[] } = { pushed: [] }): Transport {
  return {
    salt: async () => ({ salt: await syncSalt(d1), rows: 0, seq: 0 }),
    push: async (dev, rows) => {
      seen.pushed.push(...rows.map((r) => r.data ?? ''));
      return pushRows(d1, dev, rows);
    },
    pull: async (since) => (await pullRows(d1, since)) as any,
    putPart: async (t, k, n, at, data) => putPart(d1, t, k, n, at, data),
    getPart: async (t, k, n) => (await getPart(d1, t, k, n))!,
  };
}

const note = (id: string, text: string, at = Date.now()): Note =>
  ({ id, folderId: 'f', title: text, snippet: '', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, text, pinned: false, createdAt: at, updatedAt: at, kind: 'note' }) as Note;

/** Switch to being another device: a new device id and an empty database. */
async function becomeDevice(id: string) {
  store.set('scrabbler.syncDevice', id);
  resetSyncState();
  updateSettings({ syncEnabled: false });
  await Promise.all(db.tables.map((t) => t.clear()));
}

let d1: D1;

/** A whole device put aside — its database and its sync bookkeeping — to come back to. */
async function putAside() {
  const tables = Object.fromEntries(await Promise.all(db.tables.map(async (t) => [t.name, await t.toArray()] as const)));
  return { tables, store: new Map(store) };
}
async function comeBack(device: Awaited<ReturnType<typeof putAside>>) {
  updateSettings({ syncEnabled: false });
  await Promise.all(db.tables.map((t) => t.clear()));
  for (const [name, rows] of Object.entries(device.tables)) await db.table(name).bulkPut(rows as any[]);
  store.clear();
  for (const [k, v] of device.store) store.set(k, v);
  resetSyncStateKeepingPlace();
  updateSettings({ syncEnabled: true });
}

describe('sync', () => {
  beforeAll(() => {
    installSyncHooks();
    installVersionHooks();
  });
  beforeEach(async () => {
    d1 = await fakeD1();
    updateSettings({ syncPassphrase: 'correct horse battery', syncEnabled: false });
    await becomeDevice('ipad');
  });

  it('carries notes, deletions and files from one device to another, encrypted', async () => {
    const seen = { pushed: [] as string[] };
    const t = serverTransport(d1, seen);
    await db.folders.add({ id: 'f', name: 'Law', createdAt: 1, order: 0, notesAsSources: true });
    await db.notes.bulkAdd([note('a', 'Offer and acceptance'), note('b', 'Consideration')]);
    await db.blobs.add({ id: 'rec', blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mpeg' }), name: 'l.mp3', mime: 'audio/mpeg', createdAt: 1 });
    await connectSync('fresh', t);
    // Nothing readable left the device.
    expect(seen.pushed.join('')).not.toContain('Offer');
    const ipad = await putAside();

    await becomeDevice('phone');
    await connectSync('replace', t);
    expect((await db.notes.get('a'))?.text).toBe('Offer and acceptance');
    expect((await db.folders.get('f'))?.name).toBe('Law');
    const rec = await db.blobs.get('rec');
    expect([...new Uint8Array(await rec!.blob.arrayBuffer())]).toEqual([1, 2, 3, 4]);

    // The phone deletes one and edits the other.
    await db.notes.delete('b');
    await db.notes.update('a', { text: 'Offer, acceptance and revocation', updatedAt: Date.now() });
    expect(pendingChanges()).toBeGreaterThan(0);
    await syncNow(t);
    expect(pendingChanges()).toBe(0);

    // Back on the iPad: both arrive.
    await comeBack(ipad);
    const got = await syncNow(t);
    expect(got?.notes.sort()).toEqual(['a', 'b']);
    expect((await db.notes.get('a'))?.text).toBe('Offer, acceptance and revocation');
    expect(await db.notes.get('b')).toBeUndefined();
  });

  it('keeps the later edit of the same note, and the other in its history', async () => {
    const t = serverTransport(d1);
    await db.notes.add(note('n', 'first'));
    await connectSync('fresh', t);
    const seq = (await pullRows(d1, 0)).seq;

    // The phone edits it later...
    await pushRows(d1, 'phone', [{ t: 'notes', k: 'n', at: Date.now() + 60_000, data: await sealedNote(t, note('n', 'from the phone')) }]);
    // ...while the iPad edited it earlier, offline.
    await db.notes.update('n', { content: note('n', 'from the ipad').content, text: 'from the ipad' });
    await syncNow(t);
    expect((await db.notes.get('n'))?.text).toBe('from the phone');
    const kept = await versionsOf('n');
    expect(kept.some((v) => v.reason === 'sync' && v.text === 'from the ipad')).toBe(true);
    expect((await pullRows(d1, seq)).rows.some((r) => r.dev === 'phone')).toBe(true);
  });

  it('refuses data sealed with another passphrase rather than corrupting anything', async () => {
    const t = serverTransport(d1);
    await db.notes.add(note('x', 'secret'));
    await connectSync('fresh', t);
    await becomeDevice('laptop');
    updateSettings({ syncPassphrase: 'a different passphrase' });
    await expect(connectSync('merge', t)).rejects.toThrow(/passphrase/);
    expect(await db.notes.get('x')).toBeUndefined();
  });

  it('merges a device that already has notes, without sending them back twice', async () => {
    const t = serverTransport(d1);
    await db.notes.add(note('one', 'On the iPad'));
    await connectSync('fresh', t);
    await becomeDevice('phone');
    await db.notes.add(note('two', 'On the phone'));
    await connectSync('merge', t);
    expect((await db.notes.toArray()).map((n) => n.id).sort()).toEqual(['one', 'two']);
    const again = await syncNow(t);
    expect(again?.rows).toBe(0);
  });
});

/** A note as the phone would send it. */
async function sealedNote(t: Transport, n: Note) {
  const { deriveKey, sealJson } = await import('../lib/syncCrypto');
  const { salt } = await t.salt();
  return sealJson(await deriveKey('correct horse battery', salt), n);
}
