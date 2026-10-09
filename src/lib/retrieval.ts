/** Chunking + BM25 retrieval so answers can cite exact passages. */

export interface RawPage {
  text: string;
  page?: number;
}

export interface ChunkDraft {
  idx: number;
  text: string;
  page?: number;
}

const TARGET = 1100;
const MAX = 1600;

export function chunkText(pages: RawPage[]): ChunkDraft[] {
  const out: ChunkDraft[] = [];
  let idx = 0;
  for (const p of pages) {
    const paras = p.text
      .replace(/\r/g, '')
      .split(/\n\s*\n|(?<=[.!?])\s{2,}/)
      .map((s) => s.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean);
    let buf = '';
    const flush = () => {
      if (buf.trim()) out.push({ idx: idx++, text: buf.trim(), page: p.page });
      buf = '';
    };
    for (const para of paras) {
      if (para.length > MAX) {
        flush();
        // Split very long paragraphs on sentence boundaries.
        const sentences = para.match(/[^.!?]+[.!?]+["')\]]*\s*|.+$/g) ?? [para];
        for (const s of sentences) {
          if (buf.length + s.length > TARGET && buf) flush();
          buf += s;
          while (buf.length > MAX) {
            out.push({ idx: idx++, text: buf.slice(0, MAX), page: p.page });
            buf = buf.slice(MAX);
          }
        }
        continue;
      }
      if (buf.length + para.length > TARGET && buf) flush();
      buf += (buf ? '\n\n' : '') + para;
    }
    flush();
  }
  return out;
}

const STOP = new Set(
  'a an and are as at be but by for from has have he her his i if in into is it its me my of on or our she so than that the their them then there these they this to was we were what when where which who why will with you your do does did not no can could should would about how also just more most such only any each other some'.split(' '),
);

export function tokenize(s: string): string[] {
  return (s.toLowerCase().normalize('NFKD').match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  return w;
}

export interface Searchable {
  id: string;
  text: string;
}

export function bm25<T extends Searchable>(docs: T[], query: string, k = 20): { doc: T; score: number }[] {
  const q = Array.from(new Set(tokenize(query)));
  if (!q.length || !docs.length) return [];
  const toks = docs.map((d) => tokenize(d.text));
  const avg = toks.reduce((a, t) => a + t.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length;
  const k1 = 1.4;
  const b = 0.75;
  const scored = docs.map((doc, i) => {
    const tf = new Map<string, number>();
    for (const w of toks[i]) tf.set(w, (tf.get(w) ?? 0) + 1);
    let score = 0;
    for (const w of q) {
      const f = tf.get(w);
      if (!f) continue;
      const n = df.get(w) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * toks[i].length) / avg));
    }
    return { doc, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}

/**
 * Picks passages for the prompt. Small notebooks are sent whole (best answers);
 * large ones fall back to BM25 top-k plus each source's opening chunk.
 */
export function selectChunks<T extends Searchable & { sourceId: string; idx: number }>(
  chunks: T[],
  query: string,
  budgetChars = 120_000,
  k = 28,
): T[] {
  const total = chunks.reduce((a, c) => a + c.text.length, 0);
  if (total <= budgetChars) return chunks;
  const hits = bm25(chunks, query, k).map((h) => h.doc);
  const picked = new Map<string, T>();
  for (const h of hits) picked.set(h.id, h);
  // Neighbours give the model surrounding context for the best hits.
  const byKey = new Map(chunks.map((c) => [`${c.sourceId}:${c.idx}`, c]));
  for (const h of hits.slice(0, 6)) {
    const next = byKey.get(`${h.sourceId}:${h.idx + 1}`);
    if (next) picked.set(next.id, next);
  }
  for (const c of chunks) if (c.idx === 0 && !picked.has(c.id)) picked.set(c.id, c);
  let used = 0;
  const out: T[] = [];
  for (const c of picked.values()) {
    if (used + c.text.length > budgetChars) break;
    used += c.text.length;
    out.push(c);
  }
  return out;
}

/** Evenly samples chunks across sources to fit a budget (for summaries). */
export function sampleChunks<T extends { text: string }>(chunks: T[], budgetChars = 400_000): T[] {
  const total = chunks.reduce((a, c) => a + c.text.length, 0);
  if (total <= budgetChars) return chunks;
  const ratio = budgetChars / total;
  const out: T[] = [];
  let acc = 0;
  for (const c of chunks) {
    acc += ratio;
    if (acc >= 1) {
      out.push(c);
      acc -= 1;
    }
  }
  return out;
}

/** Splits "text [1, 3] more [2]" into citation numbers referenced. */
export function citedNumbers(text: string): number[] {
  const nums = new Set<number>();
  for (const m of text.matchAll(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g)) {
    for (const part of m[1].split(',')) {
      const range = part.split(/[–-]/).map((x) => parseInt(x.trim(), 10));
      if (range.length === 2 && range[1] - range[0] < 20) {
        for (let n = range[0]; n <= range[1]; n++) nums.add(n);
      } else if (!Number.isNaN(range[0])) nums.add(range[0]);
    }
  }
  return [...nums];
}
