/**
 * Real past papers. The paper and its mark scheme come in as PDFs; the paper
 * is split into its questions, each paired with its part of the scheme, and
 * an answer is marked against what the board actually wrote rather than
 * against the model's memory of the board.
 */
import { db, putBlob, uid, type PaperPart, type PastPaper } from '../db';
import { blobPart, hasKey, S } from './gemini';
import { generate, generateJSON } from './llm';
import type { Ctx, ExamMark } from './tutor';

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);
const num = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

/** A PDF's text: read locally, or, for a scan, by Gemini. */
export async function readPdfText(file: Blob, name: string): Promise<string> {
  const { extractPdf } = await import('./pdf');
  const { pages } = await extractPdf(file);
  const text = pages.map((p) => p.text).join('\n\n');
  if (text.trim().length >= 80 * Math.max(1, Math.min(pages.length, 5))) return text;
  if (!hasKey()) throw new Error(`${name} looks scanned. Add a Gemini key in Settings to read scanned papers.`);
  return generate({
    parts: [await blobPart(file, 'application/pdf', name)],
    prompt: 'Transcribe all text in this exam document faithfully as Markdown, keeping question numbers, mark allocations and any extracts or data. Describe figures briefly in [brackets].',
    temperature: 0,
    maxOutputTokens: 65536,
  });
}

/**
 * The paper as its questions, each with the marks printed against it and the
 * matching part of the mark scheme copied over word for word.
 */
export async function splitPaper(questions: string, markScheme: string): Promise<PaperPart[]> {
  const r = await generateJSON<{ parts?: unknown[] }>({
    system: 'You index exam papers. You copy text exactly as printed; you never write, paraphrase or invent questions, marks or mark scheme content.',
    prompt: `Split this exam paper into its questions as numbered on the paper (use sub-parts like 1(a), 1(b) when each carries its own marks). For each, give the number as printed, the full question text (with any extract, data or scenario it relies on), the marks printed for it, and the matching mark scheme text copied exactly from the mark scheme below (empty if there is no mark scheme or no matching entry).\n\nPAPER:\n"""\n${questions.slice(0, 120_000)}\n"""\n\nMARK SCHEME:\n"""\n${markScheme.slice(0, 120_000) || '(none)'}\n"""`,
    schema: S.obj({ parts: S.arr(S.obj({ num: S.str(), question: S.str(), marks: S.int(), scheme: S.str() })) }),
    temperature: 0,
    maxOutputTokens: 65536,
  });
  return (Array.isArray(r.parts) ? r.parts : [])
    .map((p: any) => ({ num: str(p?.num).trim(), question: str(p?.question).trim(), marks: num(p?.marks, 100), scheme: str(p?.scheme).trim() }))
    .filter((p) => p.question);
}

/** Adds a past paper: keeps both PDFs, reads them, and splits the paper into questions. */
export async function addPastPaper(
  o: { title: string; subjectId?: string; minutes: number; paper: File; scheme?: File | null },
  onProgress: (s: string) => void = () => {},
): Promise<PastPaper> {
  onProgress('Reading the paper…');
  const questions = await readPdfText(o.paper, o.paper.name);
  onProgress('Reading the mark scheme…');
  const markScheme = o.scheme ? await readPdfText(o.scheme, o.scheme.name) : '';
  onProgress('Finding the questions…');
  let parts: PaperPart[] = [];
  try {
    parts = await splitPaper(questions, markScheme);
  } catch {
    // Without a split the paper is sat whole: one answer, one mark against the whole scheme.
  }
  const paper: PastPaper = {
    id: uid(),
    title: o.title.trim() || o.paper.name.replace(/\.pdf$/i, ''),
    ...(o.subjectId ? { subjectId: o.subjectId } : {}),
    questions,
    markScheme,
    minutes: o.minutes,
    ...(parts.length ? { parts } : {}),
    paperBlobId: await putBlob(o.paper, o.paper.name),
    ...(o.scheme ? { schemeBlobId: await putBlob(o.scheme, o.scheme.name) } : {}),
    createdAt: Date.now(),
  };
  await db.papers.add(paper);
  return paper;
}

export async function deletePastPaper(id: string) {
  const p = await db.papers.get(id);
  await db.transaction('rw', db.papers, db.blobs, async () => {
    await db.blobs.bulkDelete([p?.paperBlobId, p?.schemeBlobId].filter((x): x is string => !!x));
    await db.papers.delete(id);
  });
}

/** The questions to sit: the split, or the whole paper as one when it couldn't be split. */
export function partsOf(p: PastPaper): PaperPart[] {
  return p.parts?.length ? p.parts : [{ num: '', question: p.questions, marks: 0, scheme: p.markScheme }];
}

/** Marks one answer against the board's own mark scheme for that question. */
export async function markAgainstScheme(c: Pick<Ctx, 'board' | 'subject'>, part: PaperPart, answer: string): Promise<ExamMark> {
  const outOf = part.marks || 0;
  const scheme = part.scheme
    ? `The board's mark scheme for this question — mark to it exactly, crediting only what it credits and using its levels and indicative content:\n"""\n${part.scheme}\n"""`
    : `There is no mark scheme for this question: mark to ${c.board}'s published conventions for questions like it.`;
  const r = await generateJSON<Record<string, unknown>>({
    system: 'You are a senior examiner marking a real past paper. Apply the mark scheme given exactly as a standardised examiner would: no inflation, no credit for content the scheme does not credit, levels placed by the scheme\'s descriptors.',
    prompt: `${c.board} — ${c.subject}\n\nQuestion ${part.num}${outOf ? ` (${outOf} marks)` : ''}:\n"""\n${part.question}\n"""\n\n${scheme}\n\nThe student's answer:\n"""\n${answer}\n"""\n\nGive the mark${outOf ? ` out of ${outOf}` : ' and what it is out of'}, the level (if levels-based), a comment per assessment objective the scheme uses, the strengths, the most valuable improvements (quote the scheme's points the answer missed), one model paragraph showing what full marks needs, and the knowledge the answer was missing.`,
    schema: S.obj({
      mark: S.int(),
      outOf: S.int(),
      level: S.str(),
      objectives: S.arr(S.obj({ ao: S.str(), comment: S.str() })),
      strengths: S.arr(S.str()),
      improvements: S.arr(S.str()),
      model: S.str(),
      gaps: S.arr(S.str()),
    }),
    temperature: 0.1,
  });
  const max = outOf || num(r.outOf, 300);
  const objectives = Array.isArray(r.objectives) ? (r.objectives as { ao?: unknown; comment?: unknown }[]).map((o) => ({ ao: str(o?.ao), comment: str(o?.comment) })).filter((o) => o.ao && o.comment) : [];
  return { mark: num(r.mark, max), outOf: max, level: str(r.level), objectives, strengths: strs(r.strengths), improvements: strs(r.improvements), model: str(r.model), gaps: strs(r.gaps) };
}
