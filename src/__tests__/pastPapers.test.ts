import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateJSON = vi.fn();
vi.mock('../lib/llm', () => ({ generateJSON: (o: unknown) => generateJSON(o), generate: vi.fn() }));

const { db } = await import('../db');
const { markAgainstScheme, partsOf, splitPaper, deletePastPaper } = await import('../lib/pastPapers');

describe('past papers', () => {
  beforeEach(async () => {
    generateJSON.mockReset();
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('keeps the questions the model found, and drops empty ones', async () => {
    generateJSON.mockResolvedValue({
      parts: [
        { num: '1', question: 'Define offer.', marks: 2, scheme: 'An expression of willingness (1) to be bound (1).' },
        { num: '2', question: '', marks: 5, scheme: '' },
        { num: '3', question: 'Advise Ann.', marks: '30', scheme: 'Level 5 ...' },
      ],
    });
    const parts = await splitPaper('paper text', 'scheme text');
    expect(parts).toEqual([
      { num: '1', question: 'Define offer.', marks: 2, scheme: 'An expression of willingness (1) to be bound (1).' },
      { num: '3', question: 'Advise Ann.', marks: 30, scheme: 'Level 5 ...' },
    ]);
    const prompt = (generateJSON.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).toContain('paper text');
    expect(prompt).toContain('scheme text');
  });

  it('marks against the scheme it was given, never above the marks available', async () => {
    generateJSON.mockResolvedValue({ mark: 9, outOf: 9, level: '', objectives: [{ ao: 'AO1', comment: 'Accurate' }], strengths: ['Defined offer'], improvements: [], model: '', gaps: [] });
    const m = await markAgainstScheme({ board: 'AQA A-level Law', subject: 'Law' }, { num: '1', question: 'Define offer.', marks: 2, scheme: 'willingness (1) to be bound (1)' }, 'A promise.');
    expect(m.mark).toBe(2);
    expect(m.outOf).toBe(2);
    expect((generateJSON.mock.calls[0][0] as { prompt: string }).prompt).toContain('willingness (1) to be bound (1)');
  });

  it('sits an unsplit paper as one question against the whole scheme', () => {
    const p = { id: 'p', title: 'June', questions: 'All the questions', markScheme: 'All the scheme', minutes: 90, createdAt: 1 };
    expect(partsOf(p)).toEqual([{ num: '', question: 'All the questions', marks: 0, scheme: 'All the scheme' }]);
  });

  it('deletes a paper with its PDFs', async () => {
    await db.blobs.bulkAdd([
      { id: 'a', blob: new Blob(['%PDF']), name: 'p.pdf', mime: 'application/pdf', createdAt: 1 },
      { id: 'b', blob: new Blob(['%PDF']), name: 'ms.pdf', mime: 'application/pdf', createdAt: 1 },
    ]);
    await db.papers.add({ id: 'p', title: 'June', questions: '', markScheme: '', minutes: 90, createdAt: 1, paperBlobId: 'a', schemeBlobId: 'b' });
    await deletePastPaper('p');
    expect(await db.papers.count()).toBe(0);
    expect(await db.blobs.count()).toBe(0);
  });
});
