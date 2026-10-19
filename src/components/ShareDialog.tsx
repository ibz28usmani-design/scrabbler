import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, type Share } from '../db';
import { publish, shareAsFile, unpublish } from '../lib/share';
import { useSettings } from '../lib/settings';
import { toast, toastError } from '../lib/events';
import { confirmDialog, Modal, Spinner } from './ui';
import { ICopy, IShare } from './Icons';

/**
 * Sharing a note or deck read-only: as a web page file through the share
 * sheet, or as a link on your own server that can be updated or taken down.
 */
export function ShareDialog({ kind, refId, title, onClose }: { kind: Share['kind']; refId: string; title: string; onClose: () => void }) {
  const s = useSettings();
  const share = useLiveQuery(() => db.shares.where('refId').equals(refId).first(), [refId]);
  const [busy, setBusy] = useState<null | 'file' | 'link' | 'down'>(null);
  const hasServer = !!s.pushUrl.trim() && !!s.pushPassword;
  const run = async (which: NonNullable<typeof busy>, fn: () => Promise<unknown>) => {
    setBusy(which);
    try {
      await fn();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal title={`Share “${title || 'Untitled'}”`} onClose={onClose}>
      <p className="muted">Whoever you send it to sees a read-only page{kind === 'deck' ? ' of the cards, each turning over when tapped' : ''}. They don’t need Scrabbler.</p>
      <div className="share-options">
        <section>
          <h4>As a file</h4>
          <p className="muted small">A web page sent through the share sheet: Messages, Mail, AirDrop. Nothing is uploaded.</p>
          <button className="btn" disabled={!!busy} onClick={() => run('file', () => shareAsFile(kind, refId))}>
            {busy === 'file' ? <Spinner size={14} /> : <IShare size={15} />} Share a copy
          </button>
        </section>
        <section>
          <h4>As a link</h4>
          {!hasServer ? (
            <p className="muted small">Publishing a link uses your push server with a D1 database (Settings → Notifications, then Sync).</p>
          ) : share ? (
            <>
              <p className="muted small">
                Anyone with this link can read the page as it was when last published ({new Date(share.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}).
              </p>
              <input className="input share-url" readOnly value={share.url} onFocus={(e) => e.currentTarget.select()} aria-label="Shared link" />
              <div className="row wrap">
                <button
                  className="btn"
                  onClick={async () => {
                    await navigator.clipboard.writeText(share.url);
                    toast('Link copied', 'success');
                  }}
                >
                  <ICopy size={15} /> Copy link
                </button>
                <button className="btn" disabled={!!busy} onClick={() => run('link', async () => (await publish(kind, refId), toast('Shared page updated', 'success')))}>
                  {busy === 'link' ? <Spinner size={14} /> : null} Update to now
                </button>
                <button
                  className="btn danger"
                  disabled={!!busy}
                  onClick={async () => {
                    if (!(await confirmDialog('Take this page down? The link stops working for everyone.', 'Take down'))) return;
                    run('down', async () => (await unpublish(share.id), toast('Taken down', 'success')));
                  }}
                >
                  Take down
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted small">Publishes the page on your server at a long, unguessable address. Anyone with the link can read it until you take it down.</p>
              <button className="btn primary" disabled={!!busy} onClick={() => run('link', async () => (await publish(kind, refId), toast('Published', 'success')))}>
                {busy === 'link' ? <Spinner size={14} /> : null} Publish a link
              </button>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
