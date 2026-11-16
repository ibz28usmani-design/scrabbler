import { useRef, useState } from 'react';
import { exportAll, importAll } from '../lib/db';
import { exportVault, importVault } from '../lib/vault';
import { importLegacy } from '../lib/legacy';
import { Head, useS, setS, guard, toast, download, ymd } from '../lib/ui';

export default function Settings() {
  const s = useS(), file = useRef<HTMLInputElement>(null), vault = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const run = (name: string, fn: () => Promise<unknown>) => guard(async () => { setBusy(name); try { await fn(); } finally { setBusy(''); } });
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
            <input ref={file} type="file" accept=".json" hidden onChange={e => { const f = e.target.files?.[0]; if (f && confirm('Restoring replaces everything on this device with the backup. Continue?')) guard(async () => { await importAll(await f.text()); toast('Backup restored.'); }); e.target.value = ''; }} />
          </div>
        </section>
      </div>
    </div>
  );
}
