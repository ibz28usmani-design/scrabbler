import { useState } from 'react';
import { ago, backupNow, dismissPersist, isStandalone, persistDismissed, snoozeBackup, useBackupState, usePersisted } from '../lib/safety';
import { useSyncStatus } from '../lib/syncState';
import { toast } from '../lib/events';
import { IDownload, IX } from './Icons';
import { Spinner } from './ui';

/**
 * One line, above everything, when work could be lost: the browser may clear
 * this site's storage, or there has been no backup in a while. It says which,
 * and offers the fix.
 */
export function SafetyBanner() {
  const sync = useSyncStatus();
  const backup = useBackupState(sync.enabled && sync.lastOkAt !== null && Date.now() - sync.lastOkAt < 3 * 86400000);
  const [persisted, ask] = usePersisted();
  const [hidePersist, setHidePersist] = useState(persistDismissed);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  if (persisted === false && !hidePersist) {
    const installed = isStandalone();
    return (
      <div className="safety-banner warn" role="region" aria-label="Storage warning">
        <span className="safety-text">
          {installed ? (
            <>This browser hasn’t promised to keep your notes. Back up regularly, or turn on sync in Settings.</>
          ) : (
            <>
              <b>Safari can delete notes</b> from sites you haven’t opened for a while. Add Scrabbler to your Home Screen (Share → Add to Home Screen) to keep them.
            </>
          )}
        </span>
        <button
          className="btn small"
          onClick={async () => {
            const ok = await ask();
            if (!ok) toast(installed ? 'The browser still declined. Keep backing up.' : 'Safari only promises this to Home Screen apps.', 'info');
          }}
        >
          Protect storage
        </button>
        <button
          className="icon-btn small"
          aria-label="Dismiss for now"
          onClick={() => {
            dismissPersist();
            setHidePersist(true);
          }}
        >
          <IX size={16} />
        </button>
      </div>
    );
  }

  if (!backup?.overdue || backup.snoozed) return null;
  return (
    <div className="safety-banner" role="region" aria-label="Backup reminder">
      <span className="safety-text">
        {backup.lastAt ? <>Last backup {ago(backup.lastAt)}.</> : <>You haven’t backed up yet.</>} Everything lives only on this device.
      </span>
      <button
        className="btn small primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await backupNow();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner size={14} /> : <IDownload size={15} />} Back up now
      </button>
      <button
        className="btn small"
        onClick={() => {
          snoozeBackup();
          setHidden(true);
        }}
      >
        Later
      </button>
    </div>
  );
}
