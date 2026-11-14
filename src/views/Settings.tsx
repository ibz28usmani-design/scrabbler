import { useRef } from 'react';
import { exportAll, importAll } from '../lib/db';
import { Head, useS, setS, guard, toast, download, ymd } from '../lib/ui';

export default function Settings() {
  const s = useS(), file = useRef<HTMLInputElement>(null);
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
          <div className="label">Alerts</div>
          <p className="muted small">Reminders with a time, classes (5 minutes before) and the Pomodoro timer alert you while Scrabbler is open.</p>
          <button className="btn" onClick={async () => toast(typeof Notification === 'undefined' ? 'This browser does not offer notifications; alerts show inside the app.' : (await Notification.requestPermission()) === 'granted' ? 'Notifications are on.' : 'Notifications are blocked; alerts show inside the app.')}>Allow notifications</button>
        </section>
        <section className="card">
          <div className="label">Back up</div>
          <p className="muted small">Everything lives on this device. Save a backup file regularly. Podcast audio and uploaded source files are not included.</p>
          <div className="row">
            <button className="btn primary" onClick={async () => download(`scrabbler-${ymd(new Date())}.json`, await exportAll(), 'application/json')}>Back up now</button>
            <button className="btn" onClick={() => file.current?.click()}>Restore from a backup…</button>
            <input ref={file} type="file" accept=".json" hidden onChange={e => { const f = e.target.files?.[0]; if (f && confirm('Restoring replaces everything on this device with the backup. Continue?')) guard(async () => { await importAll(await f.text()); toast('Backup restored.'); }); e.target.value = ''; }} />
          </div>
        </section>
      </div>
    </div>
  );
}
