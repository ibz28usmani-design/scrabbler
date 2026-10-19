import { useState } from 'react';
import { updateSettings, useSettings } from '../lib/settings';
import { useSyncStatus } from '../lib/syncState';
import { ago, backupNow } from '../lib/safety';
import { toast, toastError } from '../lib/events';
import { DraftInput, Modal, Spinner } from './ui';

const GUIDE = 'https://github.com/ibz28usmani-design/scrabbler/blob/HEAD/push-server/README.md#sync-and-sharing';

/**
 * Settings → Sync: the same free server as notifications carries your notes
 * between devices, encrypted with a passphrase only your devices know.
 */
export function SyncSettings() {
  const s = useSettings();
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [choose, setChoose] = useState<null | { rows: number }>(null);
  const hasServer = !!s.pushUrl.trim() && !!s.pushPassword;
  const passOk = s.syncPassphrase.length >= 8;

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done, 'success');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const turnOn = () =>
    run(async () => {
      const { serverState, connectSync } = await import('../lib/sync');
      const state = await serverState();
      if (state.rows > 0) return setChoose({ rows: state.rows });
      await connectSync('fresh');
      toast('Sync is on. Everything on this device is on its way to your server.', 'success');
    });

  const join = (mode: 'replace' | 'merge') =>
    run(async () => {
      setChoose(null);
      const { connectSync } = await import('../lib/sync');
      await connectSync(mode);
      toast(mode === 'replace' ? 'Sync is on. This device now has your synced notes.' : 'Sync is on. This device’s notes were added to the synced ones.', 'success');
    });

  return (
    <section className="set-section">
      <h3>Sync between devices</h3>
      <p className="muted">
        Keeps your notes, cards, reminders, revision and files the same on your iPad, iPhone and Mac, through the free server you set up for notifications (with a D1 database added —{' '}
        <a href={GUIDE} target="_blank" rel="noreferrer">
          how
        </a>
        ). Everything is encrypted on this device with your passphrase before it leaves; the server only ever holds ciphertext.
      </p>
      {!hasServer ? (
        <p className="warn">Set up the server under Notifications first (its address and password), then come back here.</p>
      ) : (
        <>
          <label className="field">
            <span>Sync passphrase — the same on every device</span>
            <DraftInput
              className="input"
              type="password"
              autoComplete="new-password"
              value={s.syncPassphrase}
              placeholder="At least 8 characters"
              disabled={status.enabled}
              onLeave={(v) => updateSettings({ syncPassphrase: v })}
            />
          </label>
          <p className="muted small">It never leaves your devices. If you lose it, the synced copy can’t be read — each device still keeps its own notes, and backups still work.</p>
          {status.enabled ? (
            <>
              <p className={status.error ? 'warn' : 'muted'}>
                {status.running ? (
                  <>
                    <Spinner size={13} /> Syncing…
                  </>
                ) : status.error ? (
                  `Last sync failed: ${status.error}`
                ) : status.lastOkAt ? (
                  `Synced ${ago(status.lastOkAt)} (${new Date(status.lastOkAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}).`
                ) : (
                  'On, and about to sync.'
                )}
                {status.pending ? ` ${status.pending} change${status.pending === 1 ? '' : 's'} waiting to go.` : ''}
              </p>
              <div className="row wrap">
                <button className="btn primary" disabled={busy || status.running} onClick={() => run(async () => (await import('../lib/sync')).syncNow(), 'Synced ✓')}>
                  Sync now
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={async () => {
                    (await import('../lib/sync')).disconnectSync();
                    toast('Sync is off on this device. Its notes stay here.');
                  }}
                >
                  Turn off on this device
                </button>
              </div>
            </>
          ) : (
            <button className="btn primary" disabled={busy || !passOk} onClick={turnOn}>
              {busy ? <Spinner size={14} /> : null} Turn on sync
            </button>
          )}
        </>
      )}
      {choose && (
        <Modal title="Your server already has synced notes" onClose={() => setChoose(null)}>
          <p>
            It holds {choose.rows.toLocaleString()} items from another device. What should happen to the notes on <strong>this</strong> device?
          </p>
          <div className="join-choices">
            <button className="join-choice" disabled={busy} onClick={() => join('replace')}>
              <strong>Use the synced notes (recommended for a new device)</strong>
              <span>This device’s notes, cards and reminders are replaced by the synced ones.</span>
            </button>
            <button className="join-choice" disabled={busy} onClick={() => join('merge')}>
              <strong>Merge this device’s notes in</strong>
              <span>Both sets are kept. Where the same item is on both, the synced copy wins. Folders made on both may appear twice.</span>
            </button>
          </div>
          <p className="muted small">
            Not sure?{' '}
            <button className="link-btn" onClick={() => void backupNow()}>
              Back up this device first
            </button>
            .
          </p>
        </Modal>
      )}
    </section>
  );
}
