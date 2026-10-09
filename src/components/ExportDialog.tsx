import { useEffect, useState } from 'react';
import { db, type Note } from '../db';
import { exportNote, INK_FORMATS, printableHtml, TYPED_FORMATS, type ExportFormat, type ExportResult } from '../lib/export';
import { canShareFiles, downloadFiles, printHtml, shareFiles } from '../lib/export/save';
import { toast, toastError } from '../lib/events';
import { Modal, Spinner } from './ui';
import { IDownload, IPrint, IUpload } from './Icons';

const LAST_KEY = 'scrabbler.export';

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Two steps on purpose: the file is generated first, then a fresh tap shares it.
 * iOS only opens the share sheet ("Save to Files") inside a direct user gesture,
 * which an async PDF or Word build would otherwise use up.
 */
export function ExportDialog({ note, onClose }: { note: Note; onClose: () => void }) {
  const ink = note.kind === 'ink';
  const formats = ink ? INK_FORMATS : TYPED_FORMATS;
  const [format, setFormat] = useState<ExportFormat>(() => {
    try {
      const last = localStorage.getItem(`${LAST_KEY}.${ink ? 'ink' : 'typed'}`) as ExportFormat | null;
      return last && formats.some((f) => f.id === last) ? last : 'pdf';
    } catch {
      return 'pdf';
    }
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);

  // A different format invalidates the generated file.
  useEffect(() => setResult(null), [format]);

  const generate = async () => {
    setBusy(true);
    try {
      try {
        localStorage.setItem(`${LAST_KEY}.${ink ? 'ink' : 'typed'}`, format);
      } catch {
        /* private mode */
      }
      // Export what is saved right now, not the snapshot the dialog opened with.
      const fresh = (await db.notes.get(note.id)) ?? note;
      setResult(await exportNote(fresh, format));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!result) return;
    try {
      if ((await shareFiles(result.files, note.title)) === 'shared') onClose();
    } catch (e) {
      toastError(e);
    }
  };

  const save = () => {
    if (!result) return;
    downloadFiles(result.files);
    toast(result.files.length > 1 ? `Saved ${result.files.length} files` : `Saved ${result.files[0].name}`, 'success');
    onClose();
  };

  const print = async () => {
    try {
      const fresh = (await db.notes.get(note.id)) ?? note;
      printHtml(await printableHtml(fresh));
    } catch (e) {
      toastError(e);
    }
  };

  const shareable = result ? canShareFiles(result.files) : false;
  const total = result?.files.reduce((a, f) => a + f.blob.size, 0) ?? 0;

  return (
    <Modal
      title={
        <>
          <IDownload size={18} /> Save to device
        </>
      }
      onClose={onClose}
      className="export-modal"
      footer={
        <>
          {!ink && (
            <button className="btn" onClick={print} title="System print dialog — also Save as PDF">
              <IPrint size={16} /> Print
            </button>
          )}
          <span className="spacer" />
          {!result ? (
            <button className="btn primary" onClick={generate} disabled={busy} data-testid="export-generate">
              {busy ? (
                <>
                  <Spinner size={14} /> Preparing…
                </>
              ) : (
                <>Prepare {formats.find((f) => f.id === format)?.label}</>
              )}
            </button>
          ) : (
            <>
              <button className={`btn${shareable ? '' : ' primary'}`} onClick={save} data-testid="export-download">
                <IDownload size={16} /> Download
              </button>
              {shareable && (
                <button className="btn primary" onClick={share} data-testid="export-share">
                  <IUpload size={16} /> Save to Files…
                </button>
              )}
            </>
          )}
        </>
      }
    >
      <div className="format-grid" role="radiogroup" aria-label="File format">
        {formats.map((f) => (
          <button key={f.id} role="radio" aria-checked={f.id === format} className={`format${f.id === format ? ' on' : ''}`} onClick={() => setFormat(f.id)} data-testid={`format-${f.id}`}>
            <span className="format-ext">.{f.ext}</span>
            <span className="format-name">{f.label}</span>
            <span className="format-detail">{f.detail}</span>
          </button>
        ))}
      </div>
      {ink && <p className="muted small">Need Word, Markdown or plain text? Transcribe the handwriting first, then export the typed copy.</p>}
      {result && (
        <div className="export-ready" data-testid="export-ready">
          <strong>Ready.</strong> {result.files.map((f) => f.name).join(', ')} · {sizeLabel(total)}
          {result.warning && <div className="warn">{result.warning}</div>}
        </div>
      )}
    </Modal>
  );
}
