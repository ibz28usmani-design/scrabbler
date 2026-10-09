/** Source ingestion: PDFs, text, websites, YouTube, audio and images. */
import { db, deleteSource, putBlob, uid, type Source, type SourceKind } from '../db';
import { blobPart, generate, generateGrounded, hasKey, MissingKeyError } from './gemini';
import { chunkText, type RawPage } from './retrieval';
import { geminiMime } from './audio';
import { transcribe } from './ai';
import { fmtClock } from './dates';
import { toast, toastError } from './events';

async function create(folderId: string, kind: SourceKind, title: string, extra: Partial<Source> = {}): Promise<Source> {
  const s: Source = { id: uid(), folderId, kind, title, text: '', status: 'processing', enabled: true, createdAt: Date.now(), ...extra };
  await db.sources.add(s);
  return s;
}

async function finish(s: Source, pages: RawPage[], title?: string) {
  const text = pages.map((p) => p.text).join('\n\n').trim();
  if (!text) throw new Error('No readable text was found in this source.');
  const chunks = chunkText(pages).map((c) => ({ ...c, id: uid(), sourceId: s.id, folderId: s.folderId }));
  await db.transaction('rw', db.sources, db.chunks, async () => {
    await db.chunks.where('sourceId').equals(s.id).delete();
    await db.chunks.bulkAdd(chunks);
    await db.sources.update(s.id, { text, status: 'ready', error: undefined, ...(title ? { title } : {}) });
  });
}

async function fail(s: Source, e: unknown) {
  await db.sources.update(s.id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
  toastError(e);
}

/** Parses Gemini's "--- Page N ---" markers back into pages. */
function splitPages(text: string): RawPage[] {
  const parts = text.split(/^-{2,}\s*Page\s+(\d+)\s*-{2,}\s*$/im);
  if (parts.length < 3) return [{ text }];
  const pages: RawPage[] = [];
  if (parts[0].trim()) pages.push({ text: parts[0] });
  for (let i = 1; i < parts.length; i += 2) pages.push({ page: Number(parts[i]), text: parts[i + 1] ?? '' });
  return pages;
}

export async function addPdf(folderId: string, file: File) {
  const blobId = await putBlob(file, file.name);
  const s = await create(folderId, 'pdf', file.name.replace(/\.pdf$/i, ''), { blobId });
  try {
    const { extractPdf } = await import('./pdf');
    const { pages, title } = await extractPdf(file);
    const chars = pages.reduce((a, p) => a + p.text.trim().length, 0);
    if (chars < 80 * Math.max(1, Math.min(pages.length, 5))) {
      // Likely a scan — use Gemini's vision OCR instead.
      if (!hasKey()) throw new Error('This PDF looks scanned. Add a Gemini key in Settings to read scanned PDFs.');
      toast('Scanned PDF detected — reading it with Gemini OCR…');
      const text = await generate({
        parts: [await blobPart(file, 'application/pdf', file.name)],
        prompt: 'Transcribe all text in this PDF faithfully as Markdown. Before each page write a line "--- Page N ---". Describe figures briefly in [brackets].',
        temperature: 0,
        maxOutputTokens: 65536,
      });
      await finish(s, splitPages(text), title);
    } else {
      await finish(s, pages, title && title.length > 3 ? title : undefined);
    }
  } catch (e) {
    await fail(s, e);
  }
}

export async function addText(folderId: string, title: string, text: string) {
  const s = await create(folderId, 'text', title || text.split('\n')[0].slice(0, 60) || 'Pasted text');
  try {
    await finish(s, [{ text }]);
  } catch (e) {
    await fail(s, e);
  }
}

export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

export async function addUrl(folderId: string, rawUrl: string) {
  const url = rawUrl.trim();
  const yt = youtubeId(url);
  const s = await create(folderId, yt ? 'youtube' : 'url', yt ? 'YouTube video' : new URL(url).hostname, { url });
  try {
    if (!hasKey()) throw new MissingKeyError();
    if (yt) {
      const text = await generate({
        parts: [{ fileData: { fileUri: `https://www.youtube.com/watch?v=${yt}` } }],
        prompt:
          'First line: "# " followed by the video title (or a descriptive title). Then produce a complete, faithful transcript of everything said, as paragraphs, each starting with a [mm:ss] timestamp. Include brief [visual: …] notes for important on-screen content (slides, diagrams, code).',
        temperature: 0,
        maxOutputTokens: 65536,
      });
      const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
      await finish(s, [{ text: text.replace(/^#\s+.+$/m, '').trim() }], title);
    } else {
      const text = await generate({
        prompt: `Fetch ${url} and return its complete main content as clean Markdown (all body text, headings, lists and tables — omit navigation, ads, footers). First line: "# " + the page title.`,
        tools: [{ urlContext: {} }],
        temperature: 0,
        maxOutputTokens: 65536,
      });
      const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
      await finish(s, [{ text }], title);
    }
  } catch (e) {
    await fail(s, e);
  }
}

/** NotebookLM-style "Discover": researches a topic on the live web and saves a cited brief as a source. */
export async function addDiscover(folderId: string, topic: string) {
  const s = await create(folderId, 'url', `Web research: ${topic.slice(0, 60)}`);
  try {
    if (!hasKey()) throw new MissingKeyError();
    const { text, sources } = await generateGrounded({
      prompt: `Research this topic using Google Search and write a thorough, factual study brief (800–1500 words) in Markdown with "## " sections, key facts, definitions, numbers and differing viewpoints. Topic: ${topic}`,
      temperature: 0.3,
    });
    const refs = sources.length ? `\n\n## Sources\n${sources.map((r, i) => `${i + 1}. ${r.title} — ${r.uri}`).join('\n')}` : '';
    await finish(s, [{ text: text + refs }]);
  } catch (e) {
    await fail(s, e);
  }
}

export async function addAudio(folderId: string, file: File, context?: string) {
  const blobId = await putBlob(file, file.name);
  const s = await create(folderId, 'audio', file.name.replace(/\.[^.]+$/, ''), { blobId });
  try {
    if (!hasKey()) throw new MissingKeyError();
    const segs = await transcribe(file, geminiMime(file), file.name, { context });
    const pages: RawPage[] = [{ text: segs.map((g) => `[${fmtClock(g.start)}] ${g.speaker ? g.speaker + ': ' : ''}${g.text}`).join('\n\n') }];
    await finish(s, pages);
  } catch (e) {
    await fail(s, e);
  }
}

export async function addImage(folderId: string, file: File) {
  const blobId = await putBlob(file, file.name);
  const s = await create(folderId, 'image', file.name.replace(/\.[^.]+$/, ''), { blobId });
  try {
    if (!hasKey()) throw new MissingKeyError();
    const text = await generate({
      parts: [await blobPart(file, file.type || 'image/png', file.name)],
      prompt: 'Transcribe all text in this image (including handwriting) as Markdown, then add a "## Description" section describing diagrams, charts or visual content in detail.',
      temperature: 0,
    });
    await finish(s, [{ text }]);
  } catch (e) {
    await fail(s, e);
  }
}

export async function addFile(folderId: string, file: File) {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return addPdf(folderId, file);
  if (file.type.startsWith('audio/') || file.type.startsWith('video/') || /\.(mp3|m4a|wav|aac|ogg|flac|mp4|mov|webm)$/.test(name)) return addAudio(folderId, file);
  if (file.type.startsWith('image/')) return addImage(folderId, file);
  const text = await file.text();
  return addText(folderId, file.name.replace(/\.[^.]+$/, ''), text);
}

export async function retrySource(s: Source) {
  const blob = s.blobId ? (await db.blobs.get(s.blobId))?.blob : undefined;
  await deleteSource(s.id);
  if (s.url) return addUrl(s.folderId, s.url);
  if (blob) return addFile(s.folderId, new File([blob], s.title + extFor(s.kind, blob.type), { type: blob.type }));
}

function extFor(kind: SourceKind, mime: string) {
  if (kind === 'pdf') return '.pdf';
  if (mime.includes('mpeg')) return '.mp3';
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('png')) return '.png';
  if (mime.includes('jpeg')) return '.jpg';
  return '';
}
