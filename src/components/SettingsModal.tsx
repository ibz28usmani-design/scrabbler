import { useEffect, useState } from 'react';
import { closeModal } from '../lib/nav';
import { GEMINI_VOICES, updateSettings, useSettings } from '../lib/settings';
import { listModels as listBytezModels } from '../lib/bytez';
import { listModels, type ModelInfo } from '../lib/gemini';
import { download, eraseEverything, exportBackup, importBackup } from '../lib/backup';
import { toast, toastError } from '../lib/events';
import { confirmDialog, Modal, Segmented, Spinner } from './ui';
import { ICheck, IDownload, IUpload } from './Icons';

function pickDefault(models: ModelInfo[], kind: 'flash' | 'pro' | 'tts'): string | undefined {
  const names = models.map((m) => m.name);
  const rx = kind === 'tts' ? /^gemini-([\d.]+)-flash(-preview)?-tts$/ : kind === 'pro' ? /^gemini-([\d.]+)-pro$/ : /^gemini-([\d.]+)-flash$/;
  const matches = names.filter((n) => rx.test(n)).sort((a, b) => parseFloat(b.match(rx)![1]) - parseFloat(a.match(rx)![1]));
  return matches[0];
}

export function SettingsModal() {
  const s = useSettings();
  const [key, setKey] = useState(s.apiKey);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [usage, setUsage] = useState<string>('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [bytezKey, setBytezKey] = useState(s.bytezKey);
  const [bytezModels, setBytezModels] = useState<string[] | null>(null);
  const [bytezBusy, setBytezBusy] = useState(false);

  const verifyBytez = async () => {
    setBytezBusy(true);
    try {
      const list = await listBytezModels(bytezKey.trim());
      setBytezModels(list.map((m) => m.id));
      updateSettings({ bytezKey: bytezKey.trim() });
      toast(`Bytez key works ✓ (${list.length} models)`, 'success');
    } catch (e) {
      toastError(e);
    } finally {
      setBytezBusy(false);
    }
  };

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(`${((e.usage ?? 0) / 1048576).toFixed(1)} MB used`));
    navigator.storage?.persisted?.().then(setPersisted);
    if (s.apiKey) listModels(s.apiKey).then(setModels).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async () => {
    setChecking(true);
    try {
      const list = await listModels(key.trim());
      setModels(list);
      const patch: Partial<typeof s> = { apiKey: key.trim() };
      const flash = pickDefault(list, 'flash');
      const pro = pickDefault(list, 'pro');
      const ttsM = pickDefault(list, 'tts');
      if (flash && !list.some((m) => m.name === s.textModel)) patch.textModel = flash;
      if (pro && !list.some((m) => m.name === s.proModel)) patch.proModel = pro;
      if (ttsM && !list.some((m) => m.name === s.ttsModel)) patch.ttsModel = ttsM;
      updateSettings(patch);
      toast('Gemini key works ✓', 'success');
    } catch (e) {
      toastError(e);
    } finally {
      setChecking(false);
    }
  };

  const textModels = (models ?? []).filter((m) => m.methods.includes('generateContent') && /gemini/.test(m.name) && !/tts|image|embedding|live|audio/.test(m.name));
  const ttsModels = (models ?? []).filter((m) => /tts/.test(m.name));

  return (
    <Modal title="Settings" onClose={closeModal} wide className="settings">
      <section className="set-section">
        <h3>Text engine</h3>
        <p className="muted">
          Which model writes your chat answers, study documents, flashcards and lecture notes. Everything else — transcription, PDF and
          handwriting reading, YouTube, websites, web research and Audio Overview voices — always runs on Gemini.
        </p>
        <Segmented
          value={s.textProvider}
          onChange={(textProvider) => updateSettings({ textProvider })}
          options={[
            { value: 'gemini', label: 'Gemini' },
            { value: 'bytez', label: 'Bytez' },
          ]}
        />
        {s.textProvider === 'bytez' && (
          <>
            <p className="muted small">
              Bytez serves open-source models (Qwen, Llama, DeepSeek…). Get a key at{' '}
              <a href="https://bytez.com/api" target="_blank" rel="noreferrer">
                bytez.com/api
              </a>
              . Billing is per second of inference, not free, and open models have shorter context — very large notebooks may need Gemini.
            </p>
            <div className="key-row">
              <input className="input mono" type="password" autoComplete="off" placeholder="Bytez API key" value={bytezKey} onChange={(e) => setBytezKey(e.target.value)} />
              <button className="btn primary" onClick={verifyBytez} disabled={!bytezKey.trim() || bytezBusy}>
                {bytezBusy ? <Spinner size={14} /> : s.bytezKey && s.bytezKey === bytezKey.trim() ? <ICheck size={16} /> : null}{' '}
                {s.bytezKey === bytezKey.trim() && s.bytezKey ? 'Saved' : 'Save & test'}
              </button>
            </div>
            <label className="field">
              <span>Model</span>
              {bytezModels?.length ? (
                <select className="input" value={s.bytezModel} onChange={(e) => updateSettings({ bytezModel: e.target.value })}>
                  {!bytezModels.includes(s.bytezModel) && <option value={s.bytezModel}>{s.bytezModel}</option>}
                  {bytezModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="input mono" value={s.bytezModel} onChange={(e) => updateSettings({ bytezModel: e.target.value })} placeholder="Qwen/Qwen3-4B" />
              )}
            </label>
          </>
        )}
      </section>

      <section className="set-section">
        <h3>Gemini key</h3>
        <p className="muted">
          Scrabbler uses Google Gemini’s free tier with your own key — it’s stored only on this device. Get one in a minute at{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            aistudio.google.com/apikey
          </a>
          .
        </p>
        <div className="key-row">
          <input className="input mono" type="password" autoComplete="off" placeholder="AIza…" value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="btn primary" onClick={verify} disabled={!key.trim() || checking}>
            {checking ? <Spinner size={14} /> : s.apiKey && s.apiKey === key.trim() ? <ICheck size={16} /> : null} {s.apiKey === key.trim() && s.apiKey ? 'Saved' : 'Save & test'}
          </button>
        </div>
        <p className="muted small">Free-tier note: Google may use free-tier prompts to improve its products, and there are per-minute and daily limits. Scrabbler retries automatically when you hit them.</p>
        <div className="grid2">
          <label className="field">
            <span>Main model</span>
            <select className="input" value={s.textModel} onChange={(e) => updateSettings({ textModel: e.target.value })}>
              {!textModels.some((m) => m.name === s.textModel) && <option value={s.textModel}>{s.textModel}</option>}
              {textModels.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.displayName || m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Voice model (Audio Overviews)</span>
            <select className="input" value={s.ttsModel} onChange={(e) => updateSettings({ ttsModel: e.target.value })}>
              {!ttsModels.some((m) => m.name === s.ttsModel) && <option value={s.ttsModel}>{s.ttsModel}</option>}
              {ttsModels.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.displayName || m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid2">
          <label className="field">
            <span>Host 1</span>
            <div className="row">
              <input className="input" value={s.hostA} onChange={(e) => updateSettings({ hostA: e.target.value || 'Alex' })} />
              <select className="input" value={s.voiceA} onChange={(e) => updateSettings({ voiceA: e.target.value })}>
                {GEMINI_VOICES.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </div>
          </label>
          <label className="field">
            <span>Host 2</span>
            <div className="row">
              <input className="input" value={s.hostB} onChange={(e) => updateSettings({ hostB: e.target.value || 'Sam' })} />
              <select className="input" value={s.voiceB} onChange={(e) => updateSettings({ voiceB: e.target.value })}>
                {GEMINI_VOICES.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </div>
          </label>
        </div>
        <label className="field">
          <span>Transcription language</span>
          <select className="input" value={s.transcribeLanguage} onChange={(e) => updateSettings({ transcribeLanguage: e.target.value })}>
            {['auto', 'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Arabic', 'Urdu', 'Hindi', 'Bengali', 'Chinese', 'Japanese', 'Korean', 'Russian', 'Turkish', 'Dutch', 'Polish'].map((l) => (
              <option key={l} value={l}>
                {l === 'auto' ? 'Auto-detect' : l}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="set-section">
        <h3>Appearance & Pencil</h3>
        <div className="field">
          <span>Theme</span>
          <Segmented
            value={s.theme}
            onChange={(theme) => updateSettings({ theme })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={s.fingerDrawing} onChange={(e) => updateSettings({ fingerDrawing: e.target.checked })} />
          Draw with finger (off = only Apple Pencil draws; fingers scroll — best palm rejection)
        </label>
      </section>

      <section className="set-section">
        <h3>Study</h3>
        <div className="grid2">
          <label className="field">
            <span>Daily goal (cards)</span>
            <input className="input" type="number" min={5} max={500} value={s.dailyGoal} onChange={(e) => updateSettings({ dailyGoal: Math.max(1, Number(e.target.value) || 20) })} />
          </label>
          <label className="field">
            <span>New cards per day</span>
            <input className="input" type="number" min={0} max={500} value={s.newPerDay} onChange={(e) => updateSettings({ newPerDay: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        </div>
      </section>

      <section className="set-section">
        <h3>Your data</h3>
        <p className="muted">
          Everything lives on this device ({usage || 'calculating…'}
          {persisted === false ? ', not yet protected from eviction' : persisted ? ', protected storage' : ''}). Add Scrabbler to your Home Screen and export backups regularly.
        </p>
        <div className="row wrap">
          {persisted === false && (
            <button
              className="btn"
              onClick={async () => {
                const ok = await navigator.storage.persist();
                setPersisted(ok);
                toast(ok ? 'Storage protected' : 'The browser declined — installing to the Home Screen helps.', ok ? 'success' : 'info');
              }}
            >
              Protect storage
            </button>
          )}
          <button
            className="btn"
            onClick={async () => {
              try {
                download(await exportBackup(), `scrabbler-backup-${new Date().toISOString().slice(0, 10)}.json`);
              } catch (e) {
                toastError(e);
              }
            }}
          >
            <IDownload size={16} /> Export backup
          </button>
          <label className="btn">
            <IUpload size={16} /> Import backup
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  await importBackup(f);
                  toast('Backup restored', 'success');
                } catch (err) {
                  toastError(err);
                }
              }}
            />
          </label>
          <button
            className="btn danger"
            onClick={async () => {
              if (await confirmDialog('Erase ALL notes, sources, decks and settings on this device? Export a backup first.', 'Erase everything')) eraseEverything();
            }}
          >
            Erase all data
          </button>
        </div>
      </section>
      <p className="muted small center">Scrabbler · notes + sources + lectures + flashcards</p>
    </Modal>
  );
}
