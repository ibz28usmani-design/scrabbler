import { useEffect, useState } from 'react';
import { updateSettings, useSettings } from '../lib/settings';
import { connectServer, disablePush, enablePush, primePush, pushBlocker, pushDiagnostics, sendTest, syncPush } from '../lib/push';
import { toast, toastError } from '../lib/events';
import { Spinner } from './ui';

const GUIDE = 'https://github.com/ibz28usmani-design/scrabbler/blob/HEAD/push-server/README.md';

/** Settings → Notifications: connect the push server and choose what to hear about. */
export function NotificationSettings() {
  const s = useSettings();
  const [url, setUrl] = useState(s.pushUrl);
  const [password, setPassword] = useState(s.pushPassword);
  const [busy, setBusy] = useState<null | 'connect' | 'on' | 'test' | 'off'>(null);
  const [, refresh] = useState(0);
  // Have the service worker and server key ready before "Turn on" is tapped.
  useEffect(() => {
    primePush();
    const t = setTimeout(() => refresh((n) => n + 1), 1500);
    return () => clearTimeout(t);
  }, [s.pushUrl]);
  const blocker = pushBlocker();
  const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<unknown>, done?: string) => {
    setBusy(kind);
    try {
      await fn();
      if (done) toast(done, 'success');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    const changed = url.trim() !== s.pushUrl || password !== s.pushPassword;
    if (changed) updateSettings({ pushUrl: url.trim(), pushPassword: password, pushPublicKey: url.trim() !== s.pushUrl ? '' : s.pushPublicKey });
    return changed;
  };

  const status = blocker
    ? blocker
    : s.pushEnabled && permission === 'granted'
      ? 'On — this device gets class and reminder alerts, even with Scrabbler closed.'
      : permission === 'denied'
        ? 'Notifications are blocked for Scrabbler. Allow them in the iPad’s Settings → Notifications → Scrabbler.'
        : 'Off.';

  const copyCode = async () => {
    const code = await (await fetch('./scrabbler-push-worker.js')).text();
    await navigator.clipboard.writeText(code);
    toast('Server code copied — paste it into your Cloudflare worker.', 'success');
  };

  return (
    <section className="set-section">
      <h3>Notifications</h3>
      <p className="muted">
        Alerts before each class and when reminders are due come from a small free server you own on Cloudflare. Set it up once:{' '}
        <a href={GUIDE} target="_blank" rel="noopener">
          the 10-minute guide
        </a>
        .
      </p>
      <p className={`push-status ${s.pushEnabled && permission === 'granted' && !blocker ? 'on' : ''}`}>{status}</p>
      <p className="push-diag">{pushDiagnostics()}</p>
      <div className="grid2">
        <label className="field">
          <span>Server address</span>
          <input className="input" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="https://scrabbler-push.you.workers.dev" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={save} />
        </label>
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} onBlur={save} />
        </label>
      </div>
      <div className="row wrap">
        {!s.pushEnabled ? (
          <button
            className="btn primary"
            disabled={!!busy || !url.trim() || !password}
            // No awaits before enablePush: the permission prompt needs the tap.
            onClick={() => {
              save();
              void run('on', enablePush, 'Notifications are on. Tap “Send a test” to check.');
            }}
          >
            {busy === 'on' && <Spinner size={14} />} Turn on notifications
          </button>
        ) : (
          <>
            <button className="btn primary" disabled={!!busy} onClick={() => run('test', async () => (save() && (await connectServer()), await syncPush(true), await sendTest()), 'Test sent — it should arrive in a few seconds.')}>
              {busy === 'test' && <Spinner size={14} />} Send a test
            </button>
            <button className="btn" disabled={!!busy} onClick={() => run('off', disablePush, 'Notifications are off on this device.')}>
              Turn off
            </button>
          </>
        )}
        <button className="btn" disabled={!!busy || !url.trim()} onClick={() => run('connect', async () => (save(), await connectServer(), primePush(), refresh((n) => n + 1)), 'The server answered — it’s set up.')}>
          {busy === 'connect' && <Spinner size={14} />} Check server
        </button>
        <button className="btn" onClick={() => copyCode().catch(toastError)}>
          Copy server code
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={s.notifyClasses} onChange={(e) => updateSettings({ notifyClasses: e.target.checked })} />
        Before each class — teaching days only, never at weekends or in the holidays
      </label>
      <label className="field inline">
        <span>Alert me</span>
        <select className="input" value={s.classLeadMinutes} disabled={!s.notifyClasses} onChange={(e) => updateSettings({ classLeadMinutes: Number(e.target.value) })}>
          {[0, 5, 10, 15, 20, 30].map((m) => (
            <option key={m} value={m}>
              {m ? `${m} minutes before` : 'When it starts'}
            </option>
          ))}
        </select>
      </label>
      <label className="field inline">
        <span>First class of the day</span>
        <select className="input" value={s.firstClassLeadMinutes} disabled={!s.notifyClasses} onChange={(e) => updateSettings({ firstClassLeadMinutes: Number(e.target.value) })}>
          {[0, 30, 45, 60, 90, 120].map((m) => (
            <option key={m} value={m}>
              {m ? `Also ${m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`} before` : 'No extra alert'}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={s.notifyReminders} onChange={(e) => updateSettings({ notifyReminders: e.target.checked })} />
        When reminders are due (all-day ones at 9:00)
      </label>
    </section>
  );
}
