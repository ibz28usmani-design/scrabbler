import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { anyJobsRunning, db, deleteNotesForever, failInterrupted, holdJob, putBlob, runningJobs, uid, type Note } from '../db';
import { exportBackup, importBackup } from '../lib/backup';
import { chunkText } from '../lib/retrieval';
import { thinkFilter } from '../lib/openaiCompat';
import { stripHtml } from '../lib/importers';

const note = (content: unknown, extra: Partial<Note> = {}): Note =>
  ({ id: uid(), folderId: 'f', title: 'n', content, snippet: '', pinned: false, createdAt: 0, updatedAt: 0, ...extra }) as Note;
const withFile = (blobId: string) => ({ type: 'doc', content: [{ type: 'attachment', attrs: { blobId, name: 'a.pdf', mime: 'application/pdf', size: 3 } }] });

describe('stored data', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('keeps a file another note still shows when one note is deleted for good', async () => {
    const shared = await putBlob(new Blob(['pdf']), 'a.pdf', 'attachment');
    const own = await putBlob(new Blob(['own']), 'b.pdf', 'attachment');
    const a = note({ type: 'doc', content: [...withFile(shared).content, ...withFile(own).content] });
    const b = note(withFile(shared));
    await db.notes.bulkAdd([a, b]);
    await deleteNotesForever([a.id]);
    expect(await db.blobs.get(shared)).toBeDefined();
    expect(await db.blobs.get(own)).toBeUndefined();
  });

  it('backs up to a zip and restores it, files included', async () => {
    const id = await putBlob(new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'audio/mpeg' }), 'lecture.mp3');
    const n = note(withFile(id), { audioBlobId: id });
    await db.notes.add(n);
    const zip = await exportBackup();
    await Promise.all(db.tables.map((t) => t.clear()));
    await importBackup(zip);
    expect((await db.notes.get(n.id))?.title).toBe('n');
    const back = await db.blobs.get(id);
    expect(back?.name).toBe('lecture.mp3');
    expect([...new Uint8Array(await back!.blob.arrayBuffer())]).toEqual([1, 2, 3, 250]);
  });

  it('still restores a version 1 backup, files inside as base64', async () => {
    const old = { app: 'scrabbler', version: 1, notes: [note('', { id: 'old-note' })], blobs: [{ id: 'b1', name: 'x.bin', mime: 'application/octet-stream', createdAt: 1, data: btoa('\x00\x01hi') }] };
    await importBackup(new Blob([JSON.stringify(old)], { type: 'application/json' }));
    expect(await db.notes.get('old-note')).toBeDefined();
    expect(new Uint8Array(await (await db.blobs.get('b1'))!.blob.arrayBuffer())).toEqual(new Uint8Array([0, 1, 104, 105]));
  });
});

describe('interrupted work', () => {
  it('fails jobs nobody holds, and leaves claimed ones running', async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    const held = new Set<string>();
    vi.stubGlobal('navigator', {
      locks: {
        query: async () => ({ held: [...held].map((name) => ({ name })) }),
        request: (name: string, fn: () => Promise<void>) => (held.add(name), fn().finally(() => held.delete(name))),
      },
    });
    try {
      await db.notes.bulkAdd([note('', { id: 'orphan', status: 'transcribing' }), note('', { id: 'live', status: 'writing' })]);
      const end = holdJob('live');
      expect(runningJobs()).toBe(1);
      expect(await anyJobsRunning()).toBe(true);
      await failInterrupted();
      expect((await db.notes.get('orphan'))?.status).toBe('error');
      expect((await db.notes.get('live'))?.status).toBe('writing');
      end();
      expect(runningJobs()).toBe(0);
      await new Promise((r) => setTimeout(r)); // the lock is let go asynchronously
      expect(await anyJobsRunning()).toBe(false);
      // Another tab's claim counts too.
      held.add('scrabbler-job:elsewhere');
      expect(await anyJobsRunning()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('chunking', () => {
  it('keeps every line of a long unpunctuated paragraph', () => {
    const para = 'row one col\n'.repeat(200).trim();
    const text = chunkText([{ text: para }]).map((c) => c.text).join('');
    expect(text.replace(/\s/g, '')).toBe(para.replace(/\s/g, ''));
    const mixed = `${'Sentence one. '.repeat(120)}trailing a\ntrailing b\ntrailing c`;
    const out = chunkText([{ text: mixed }]).map((c) => c.text).join(' ');
    expect(out).toContain('trailing a');
    expect(out).toContain('trailing b');
  });
});

describe('streamed reasoning', () => {
  const run = (deltas: string[]) => {
    const f = thinkFilter();
    return deltas.map((d) => f.push(d)).join('') + f.flush();
  };
  it('keeps the answer around the tags and catches split tags', () => {
    expect(run(['<think>hmm</think>The answer is 42'])).toBe('The answer is 42');
    expect(run(['Intro <thi', 'nk>secret</th', 'ink> done'])).toBe('Intro  done');
    expect(run(['a < b', ' and <t', 'able>'])).toBe('a < b and <table>');
    expect(run(['<think>never closed'])).toBe('');
  });
});

describe('Anki text', () => {
  it('decodes an escaped entity once only', () => {
    expect(stripHtml('&amp;lt;tag&amp;gt; &lt;b&gt;')).toBe('&lt;tag&gt; <b>');
  });
});
