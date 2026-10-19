import { beforeEach, describe, expect, it } from 'vitest';
import { fakeD1 } from './helpers/d1';
import { getPart, pullRows, pushRows, putPart, putShare, serveShare, syncSalt, deleteShare, type D1 } from '../../push-server/src/sync';

let db: D1;

describe('the sync server', () => {
  beforeEach(async () => {
    db = await fakeD1();
  });

  it('hands each device what it missed, in order', async () => {
    await pushRows(db, 'ipad', [
      { t: 'notes', k: 'a', at: 100, data: 'A1' },
      { t: 'notes', k: 'b', at: 100, data: 'B1' },
    ]);
    const first = await pullRows(db, 0);
    expect(first.rows.map((r) => [r.k, r.data, r.seq])).toEqual([
      ['a', 'A1', 1],
      ['b', 'B1', 2],
    ]);
    await pushRows(db, 'phone', [{ t: 'notes', k: 'a', at: 200, data: 'A2' }]);
    const next = await pullRows(db, first.seq);
    expect(next.rows.map((r) => [r.k, r.data, r.dev])).toEqual([['a', 'A2', 'phone']]);
    expect(next.more).toBe(false);
  });

  it('keeps the newest change and ignores an older one that arrives late', async () => {
    await pushRows(db, 'ipad', [{ t: 'notes', k: 'a', at: 300, data: 'new' }]);
    const r = await pushRows(db, 'phone', [{ t: 'notes', k: 'a', at: 200, data: 'old' }]);
    expect(r.taken).toBe(0);
    expect((await pullRows(db, 0)).rows[0].data).toBe('new');
  });

  it('settles a tie the same way whichever arrives first', async () => {
    await pushRows(db, 'b-device', [{ t: 'notes', k: 'x', at: 5, data: 'from b' }]);
    await pushRows(db, 'a-device', [{ t: 'notes', k: 'x', at: 5, data: 'from a' }]);
    expect((await pullRows(db, 0)).rows[0].data).toBe('from b');
  });

  it('passes deletions on as tombstones and drops their parts', async () => {
    await putPart(db, 'blobs', 'f', 0, 10, 'part0');
    await pushRows(db, 'ipad', [{ t: 'blobs', k: 'f', at: 10, parts: 1 }]);
    expect(await getPart(db, 'blobs', 'f', 0)).toEqual({ data: 'part0', at: 10 });
    await pushRows(db, 'ipad', [{ t: 'blobs', k: 'f', at: 20, del: true }]);
    const rows = (await pullRows(db, 0)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ k: 'f', del: true, data: null, parts: 0 });
    expect(await getPart(db, 'blobs', 'f', 0)).toBeNull();
  });

  it('pages a big catch-up', async () => {
    await pushRows(db, 'ipad', Array.from({ length: 450 }, (_, i) => ({ t: 'cards', k: `c${i}`, at: 1, data: 'x' })));
    const a = await pullRows(db, 0);
    expect(a.rows).toHaveLength(400);
    expect(a.more).toBe(true);
    const b = await pullRows(db, a.seq);
    expect(b.rows).toHaveLength(50);
    expect(b.more).toBe(false);
  });

  it('makes one salt and keeps it', async () => {
    const s1 = await syncSalt(db);
    expect(s1).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(await syncSalt(db)).toBe(s1);
  });

  it('serves a shared page read-only and takes it down', async () => {
    await putShare(db, 'abcdefgh1234', 'Offer', '<!doctype html><h1>Offer</h1>');
    const res = await serveShare(db, 'abcdefgh1234');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<h1>Offer</h1>');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(res.headers.get('Content-Security-Policy')).not.toContain('script-src');
    await deleteShare(db, 'abcdefgh1234');
    expect((await serveShare(db, 'abcdefgh1234')).status).toBe(404);
    expect((await serveShare(db, '../etc')).status).toBe(404);
  });
});
