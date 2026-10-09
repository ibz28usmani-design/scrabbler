import { useRef, useState } from 'react';
import { db, type Note } from '../db';
import { transcribeHandwriting, type TranscribeStyle } from '../lib/ai';
import { renderInkPages } from '../lib/inkRender';
import { hasGeminiKey } from '../lib/llm';
import { escapeHtml, mdToEditorHtml, mdToHtml } from '../lib/markdown';
import { createNote } from '../lib/notes';
import { openModal } from '../lib/nav';
import { toast, toastError } from '../lib/events';
import { Modal, Segmented, Spinner } from './ui';
import { ICopy, ICompose, ISparkle } from './Icons';

/** Markdown to readable plain text (for search, snippets and notebook sources). */
function mdPlain(md: string): string {
  return md
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/(\*\*|__|\*|_|`)(.+?)\1/g, '$2')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Turns a handwritten note into text — as plain words or with its structure kept. */
export function TranscribeDialog({ note, onClose }: { note: Note; onClose: () => void }) {
  const [style, setStyle] = useState<TranscribeStyle>('formatted');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = async () => {
    const fresh = await db.notes.get(note.id);
    const ink = fresh?.ink;
    if (!ink?.strokes.length) return toast('There is no handwriting on this page yet.', 'info');
    setBusy(true);
    setResult(null);
    abort.current = new AbortController();
    try {
      // Cornell guides help the model place text in the right section; other
      // templates only add noise, so they are left off the images.
      const pages = await renderInkPages(ink, { scale: 1.5, template: ink.paper === 'cornell' });
      const text = await transcribeHandwriting(pages, style, ink.paper, abort.current.signal);
      setResult(text.trim());
      // Make the handwriting searchable and usable as a notebook source.
      await db.notes.update(note.id, { text: mdPlain(text).replace(/\s+/g, ' ').trim() });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const toTypedNote = async () => {
    if (!result) return;
    const title = `${note.title || 'Handwritten note'} — typed`;
    const plain = mdPlain(result);
    // Keep the writer's own title when the transcription starts with one.
    const ownTitle = style === 'formatted' && /^#\s/.test(result);
    const html =
      style === 'formatted'
        ? mdToEditorHtml(result)
        : result
            .split(/\n{2,}/)
            .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
            .join('');
    await createNote(note.folderId, {
      title: ownTitle ? plain.split('\n')[0] : title,
      content: ownTitle ? html : `<h1>${escapeHtml(title)}</h1>${html}`,
      text: plain,
      snippet: plain.split('\n').slice(ownTitle ? 1 : 0).join(' ').replace(/\s+/g, ' ').trim().slice(0, 140),
    });
    toast('Created a typed copy ✦', 'success');
    onClose();
  };

  return (
    <Modal
      title={
        <>
          <ISparkle size={18} /> Transcribe handwriting
        </>
      }
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
      wide={!!result}
      footer={
        result ? (
          <>
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard.writeText(result);
                toast('Copied', 'success');
              }}
            >
              <ICopy size={16} /> Copy
            </button>
            <span className="spacer" />
            <button className="btn" onClick={run} disabled={busy}>
              Again
            </button>
            <button className="btn primary" onClick={toTypedNote}>
              <ICompose size={16} /> Create typed note
            </button>
          </>
        ) : undefined
      }
    >
      {!hasGeminiKey() ? (
        <div className="warn">
          Reading handwriting needs a Gemini key (it is an image task).{' '}
          <button className="link-btn" onClick={() => openModal({ type: 'settings' })}>
            Open Settings
          </button>
        </div>
      ) : result === null ? (
        <>
          <div className="field">
            <span>Output</span>
            <Segmented
              value={style}
              onChange={setStyle}
              options={[
                { value: 'formatted', label: 'Keep formatting' },
                { value: 'plain', label: 'Plain text' },
              ]}
            />
          </div>
          <p className="muted small">
            {style === 'formatted'
              ? 'Headings, lists, checkboxes, tables and emphasis are kept. Cornell notes come back as Cues, Notes and Summary sections.'
              : 'Just the words, in reading order, with paragraph breaks.'}
          </p>
          <div className="confirm-actions">
            <button className="btn primary" onClick={run} disabled={busy}>
              {busy ? (
                <>
                  <Spinner size={14} /> Reading your handwriting…
                </>
              ) : (
                <>
                  <ISparkle size={16} /> Transcribe
                </>
              )}
            </button>
          </div>
        </>
      ) : style === 'formatted' ? (
        <div className="prose md transcript-preview" dangerouslySetInnerHTML={{ __html: mdToHtml(result) }} />
      ) : (
        <pre className="transcript-preview plain">{result}</pre>
      )}
    </Modal>
  );
}
