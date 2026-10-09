/** Turbo-style pipeline: recording → state-of-the-art transcript → structured notes. */
import { db, uid, type TranscriptSegment } from '../db';
import { lectureNotes, transcribe, transcriptToText } from './ai';
import { chunkText } from './retrieval';
import { hasKey } from './gemini';
import { mdToEditorHtml, escapeHtml } from './markdown';
import { getSettings } from './settings';
import { fmtClock } from './dates';
import { toast, toastError } from './events';

export async function processLecture(noteId: string, opts: { context?: string; liveText?: string } = {}) {
  const note = await db.notes.get(noteId);
  if (!note?.audioBlobId) return;
  const stored = await db.blobs.get(note.audioBlobId);
  if (!stored) return;
  if (!hasKey()) {
    // Offline/no-key fallback: keep the on-device live captions.
    const live = opts.liveText?.trim();
    const html = `<h1>${escapeHtml(note.title || 'Lecture')}</h1><p><em>Add a free Gemini key in Settings, then tap “Transcribe & write notes” for a full transcript with speakers and AI notes.</em></p>${live ? `<h2>Live captions</h2><p>${escapeHtml(live)}</p>` : ''}`;
    await db.notes.update(noteId, { status: 'error', error: 'No Gemini key — saved the recording and live captions only.', content: html, text: live ?? '', updatedAt: Date.now() });
    return;
  }
  try {
    let segs: TranscriptSegment[] | undefined = note.transcript?.length ? note.transcript : undefined;
    if (!segs) {
      await db.notes.update(noteId, { status: 'transcribing', error: undefined });
      const name = stored.name || 'lecture.mp3';
      const mime = stored.mime === 'audio/mpeg' ? 'audio/mp3' : stored.mime || 'audio/mp3';
      segs = await transcribe(stored.blob, mime, name, { context: opts.context, language: getSettings().transcribeLanguage });
      await db.notes.update(noteId, { transcript: segs });
    }
    await db.notes.update(noteId, { status: 'writing' });
    const text = transcriptToText(segs);
    const { title, markdown } = await lectureNotes(text, opts.context);
    const html = mdToEditorHtml(markdown);
    const plain = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
    await db.notes.update(noteId, {
      status: 'ready',
      title,
      snippet: plain.replace(/\s+/g, ' ').slice(title.length, title.length + 160).trim(),
      content: html,
      text: plain,
      updatedAt: Date.now(),
    });
    await addTranscriptSource(note.folderId, title, segs);
    toast('Lecture notes are ready ✦', 'success');
  } catch (e) {
    await db.notes.update(noteId, { status: 'error', error: e instanceof Error ? e.message : String(e) });
    toastError(e);
  }
}

async function addTranscriptSource(folderId: string, title: string, segs: TranscriptSegment[]) {
  const text = segs.map((s) => `[${fmtClock(s.start)}] ${s.speaker ? s.speaker + ': ' : ''}${s.text}`).join('\n\n');
  const id = uid();
  const chunks = chunkText([{ text }]).map((c) => ({ ...c, id: uid(), sourceId: id, folderId }));
  await db.transaction('rw', db.sources, db.chunks, async () => {
    await db.sources.add({ id, folderId, kind: 'audio', title: `${title} (transcript)`, text, status: 'ready', enabled: true, createdAt: Date.now() });
    await db.chunks.bulkAdd(chunks);
  });
}
