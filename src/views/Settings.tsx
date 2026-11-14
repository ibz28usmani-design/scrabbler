import { useRef, useState } from 'react';
import { exportAll, importAll } from '../lib/db';
import { enablePush, disablePush, testPush, enableSync, syncNow, markAllDirty } from '../lib/cloud';
import { exportVault, importVault } from '../lib/vault';
import { importLegacy } from '../lib/legacy';
import { Head, useS, setS, guard, toast, download, ymd } from '../lib/ui';

export default function Settings() {
  const s = useS(), file = useRef<HTMLInputElement>(null), vault = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const run = (name: string, fn: () => Promise<unknown>) => guard(async () => { setBusy(name); try { await fn(); } finally { setBusy(''); } });
  const copyServer = () => run('copy', async () => { await navigator.clipboard.writeText(await (await fetch('scrabbler-push-worker.js')).text()); toast('Server code copied. Paste it into your Cloudflare worker.'); });
  return (
    <div className="view scroller">
      <Head title="Settings" />
      <div className="settings">
        <section className="card">
          <div className="label">Appearance</div>
          <div className="seg">{(['auto', 'light', 'dark'] as const).map(t => <button key={t} className={s.theme === t ? 'on' : ''} onClick={() => setS({ theme: t })}>{t === 'auto' ? 'Match device' : t[0].toUpperCase() + t.slice(1)}</button>)}</div>
        </section>
        <section className="card">
          <div className="label">AI (Google Gemini, free tier)</div>
          <p className="muted small">Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a> and paste it here. It is stored only on this device and sent only to Google.</p>
          <input className="input" type="password" placeholder="Gemini API key" aria-label="Gemini API key" value={s.key} onChange={e => setS({ key: e.target.value.trim() })} />
          <div className="row wrap">
            <label className="col small grow">Text model<input className="input mono" value={s.textModel} onChange={e => setS({ textModel: e.target.value.trim() })} /></label>
            <label className="col small grow">Voice model (podcast studio audio)<input className="input mono" value={s.ttsModel} onChange={e => setS({ ttsModel: e.target.value.trim() })} /></label>
          </div>
        </section>
        <section className="card">
          <div className="label">Your server (for sync and notifications)</div>
          <p className="muted small">A free Cloudflare Worker that you own. The setup guide is in the repository under <span className="mono">push-server/README.md</span>. If you set one up for the previous Scrabbler, the same address and password work.</p>
          <div className="row wrap">
            <input className="input grow" placeholder="https://scrabbler-push.your-name.workers.dev" aria-label="Server address" value={s.server} onChange={e => setS({ server: e.target.value.trim() })} />
            <input className="input" type="password" placeholder="Server password" aria-label="Server password" value={s.password} onChange={e => setS({ password: e.target.value })} />
          </div>
          <button className="btn small" disabled={!!busy} onClick={copyServer}>Copy server code</button>
        </section>
        <section className="card">
          <div className="label">Notifications {s.pushOn ? '· on' : '· off'}</div>
          <p className="muted small">With your server, classes and reminders alert you even when Scrabbler is closed, on teaching days only. Without it, alerts show only while the app is open. On iPad and iPhone, add Scrabbler to the Home Screen first.</p>
          <div className="row wrap">
            <label className="col small">Minutes before a class<input className="input num" type="number" min={0} max={120} value={s.lead} onChange={e => setS({ lead: +e.target.value || 0 })} /></label>
            <label className="col small">Before the first class of the day<input className="input num" type="number" min={0} max={240} value={s.firstLead} onChange={e => setS({ firstLead: +e.target.value || 0 })} /></label>
          </div>
          <div className="row wrap">
            {s.pushOn ? <><button className="btn" disabled={!!busy} onClick={() => run('push', async () => { const r = await testPush(); toast(r.ok ? 'Test sent. It should arrive in a few seconds.' : r.error || 'The test could not be sent.'); })}>Send a test</button>
              <button className="btn" disabled={!!busy} onClick={() => run('push', async () => { await disablePush(); toast('Notifications are off on this device.'); })}>Turn off</button></>
              : <button className="btn primary" disabled={!!busy} onClick={() => run('push', async () => { await enablePush(); toast('Notifications are on.'); })}>{busy === 'push' ? 'Connecting…' : 'Turn on notifications'}</button>}
          </div>
        </section>
        <section className="card">
          <div className="label">Sync between devices {s.syncOn ? '· on' : '· off'}</div>
          <p className="muted small">Keeps notes, slides, flashcards, reminders and your timetable the same on every device, encrypted with a passphrase the server never sees. Use the same passphrase on each device. If two devices edit the same note before syncing, the later edit wins. Recordings, podcast audio and uploaded source files stay on the device that made them.</p>
          <input className="input" type="password" placeholder="Sync passphrase" aria-label="Sync passphrase" value={s.syncPass} disabled={s.syncOn} onChange={e => setS({ syncPass: e.target.value })} />
          <div className="row wrap">
            {s.syncOn ? <><button className="btn primary" disabled={!!busy} onClick={() => run('sync', async () => { const r = await syncNow(); toast(`Synced: ${r.pulled} received, ${r.pushed} sent.`); })}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
              <button className="btn" onClick={() => setS({ syncOn: false })}>Turn off</button>
              <span className="muted small">{s.syncAt ? `Last synced ${new Date(s.syncAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Not synced yet'}</span></>
              : <button className="btn primary" disabled={!!busy} onClick={() => run('sync', async () => { const r = await enableSync(); toast(`Sync is on: ${r.pulled} received, ${r.pushed} sent.`); })}>{busy === 'sync' ? 'Syncing…' : 'Turn on sync'}</button>}
          </div>
        </section>
        <section className="card">
          <div className="label">Alerts while the app is open</div>
          <button className="btn" onClick={async () => toast(typeof Notification === 'undefined' ? 'This browser does not offer notifications; alerts show inside the app.' : (await Notification.requestPermission()) === 'granted' ? 'Notifications are on.' : 'Notifications are blocked; alerts show inside the app.')}>Allow notifications</button>
        </section>
        <section className="card">
          <div className="label">Obsidian vault</div>
          <p className="muted small">Export every note as Markdown in its folder (handwriting as SVG), or import a zipped vault of Markdown files.</p>
          <div className="row">
            <button className="btn" disabled={!!busy} onClick={() => run('vault', async () => download(`scrabbler-vault-${ymd(new Date())}.zip`, await exportVault()))}>Export vault</button>
            <button className="btn" disabled={!!busy} onClick={() => vault.current?.click()}>Import a vault (.zip)…</button>
            <input ref={vault} type="file" accept=".zip" hidden onChange={e => { const f = e.target.files?.[0]; if (f) run('vault', async () => toast(`Imported ${await importVault(f)} notes.`)); e.target.value = ''; }} />
          </div>
        </section>
        <section className="card">
          <div className="label">Back up</div>
          <p className="muted small">Save a backup file regularly. Podcast audio, recordings and uploaded source files are not included.</p>
          <div className="row wrap">
            <button className="btn primary" onClick={async () => download(`scrabbler-${ymd(new Date())}.json`, await exportAll(), 'application/json')}>Back up now</button>
            <button className="btn" onClick={() => file.current?.click()}>Restore from a backup…</button>
            <button className="btn" disabled={!!busy} onClick={() => run('legacy', async () => { const n = await importLegacy(); toast(n ? `Brought across ${n} notes from the previous Scrabbler.` : 'No notes from the previous Scrabbler were found on this device.'); })}>Import notes from the previous Scrabbler</button>
            <input ref={file} type="file" accept=".json" hidden onChange={e => { const f = e.target.files?.[0]; if (f && confirm('Restoring replaces everything on this device with the backup. Continue?')) guard(async () => { await importAll(await f.text()); if (s.syncOn) await markAllDirty(); toast('Backup restored.'); }); e.target.value = ''; }} />
          </div>
        </section>
      </div>
    </div>
  );
}
