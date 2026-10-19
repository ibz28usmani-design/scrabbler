import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db, type Note } from '../db';
import { lineDiff, REASON_LABEL, restoreVersion, versionsOf } from '../lib/versions';
import { toast, toastError } from '../lib/events';
import { Empty, Modal } from './ui';
import { IClock } from './Icons';

const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Every kept copy of a note, what each changes against now, and a way back to it. */
export function VersionHistory({ note, onClose }: { note: Note; onClose: () => void }) {
  const versions = useLiveQuery(() => versionsOf(note.id), [note.id]);
  const [picked, setPicked] = useState<string | null>(null);
  const [diff, setDiff] = useState(true);
  const v = versions?.find((x) => x.id === picked) ?? versions?.[0];
  const lines = useMemo(() => (v ? (diff ? lineDiff(note.text ?? '', v.text) : v.text.split('\n').map((text) => ({ kind: 'same' as const, text }))) : []), [v, note.text, diff]);
  const changed = lines.filter((l) => l.kind !== 'same').length;

  const restore = async () => {
    if (!v) return;
    try {
      await restoreVersion(v.id);
      toast('Restored. What it said before is in the history too.', 'success');
      onClose();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Modal
      title="Version history"
      onClose={onClose}
      wide
      className="versions-modal"
      footer={
        v && (
          <>
            <label className="check-row">
              <input type="checkbox" checked={diff} onChange={(e) => setDiff(e.target.checked)} /> Show changes against now
            </label>
            <span className="spacer" />
            <button className="btn primary" onClick={restore}>
              Restore this version
            </button>
          </>
        )
      }
    >
      {!versions ? null : !versions.length ? (
        <Empty icon={<IClock size={30} />} title="No earlier versions yet">
          A copy is kept before each stretch of writing, before every AI rewrite and before a restore.
        </Empty>
      ) : (
        <div className="versions">
          <ul className="version-list" role="listbox" aria-label="Versions">
            {versions.map((x) => (
              <li key={x.id}>
                <button className={`version-row ${x.id === v?.id ? 'on' : ''}`} role="option" aria-selected={x.id === v?.id} onClick={() => setPicked(x.id)}>
                  <span className="version-when">{when(x.at)}</span>
                  <span className="version-why">{x.label ? `${REASON_LABEL[x.reason]}: ${x.label}` : REASON_LABEL[x.reason]}</span>
                  <span className="version-title">{x.title || 'Untitled'}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="version-preview" aria-live="polite">
            {diff && <div className="version-summary">{changed ? `${changed} line${changed === 1 ? '' : 's'} differ from now` : 'Same text as now'}</div>}
            <div className="version-lines">
              {lines.map((l, i) => (
                <div key={i} className={`vline ${l.kind}`}>
                  <span className="vmark" aria-hidden="true">
                    {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}
                  </span>
                  {l.kind === 'add' && <span className="sr-only">Only in this version: </span>}
                  {l.kind === 'del' && <span className="sr-only">Only in the note now: </span>}
                  {l.text || ' '}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** How many copies a note has, for its menu. */
export function useVersionCount(noteId: string) {
  return useLiveQuery(() => db.versions.where('noteId').equals(noteId).count(), [noteId]) ?? 0;
}
