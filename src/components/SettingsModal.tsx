import { useEffect, useState } from 'react';
import { closeModal } from '../lib/nav';
import { GEMINI_VOICES, updateSettings, useSettings } from '../lib/settings';
import { listModels as listCompatModels, looksMultimodal, pickModel, PRESETS, presetById, isProxyBase } from '../lib/openaiCompat';
import { listModels, modelUpgrades, probeModel, type ModelInfo } from '../lib/gemini';
import { download, eraseEverything, importBackup } from '../lib/backup';
import { ago, backupNow, useBackupState } from '../lib/safety';
import { toast, toastError } from '../lib/events';
import { confirmDialog, DraftInput, Modal, Segmented, Spinner } from './ui';
import { ICheck, IDownload, IUpload } from './Icons';
import { NotificationSettings } from './NotificationSettings';
import { exportVault, importVault } from '../lib/vault';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

export function SettingsModal() {
  const s = useSettings();
  const [key, setKey] = useState(s.apiKey);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [usage, setUsage] = useState<string>('');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [compatKey, setCompatKey] = useState(s.compatKey);
  const [compatModels, setCompatModels] = useState<string[] | null>(null);
  const [compatBusy, setCompatBusy] = useState(false);
  const preset = presetById(s.compatPreset);
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  const proxied = isProxyBase(s.compatBaseUrl);
  const backup = useBackupState();
  const [backingUp, setBackingUp] = useState(false);

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(`${((e.usage ?? 0) / 1048576).toFixed(1)} MB used`));
    navigator.storage?.persisted?.().then(setPersisted);
    if (s.apiKey)
      listModels(s.apiKey)
        .then((list) => {
          setModels(list);
          updateSettings(modelUpgrades(list.map((m) => m.name), s));
        })
        .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The capability belongs to the model, so a new model re-guesses it.
  const chooseModel = (compatModel: string) => updateSettings({ compatModel, compatVision: looksMultimodal(compatModel) });

  const choosePreset = (id: string) => {
    const p = presetById(id);
    setCompatModels(null);
    setCompatKey('');
    updateSettings({ compatPreset: id, compatBaseUrl: p.baseUrl, compatKey: '', compatModel: p.model, compatVision: looksMultimodal(p.model) });
  };

  const verifyCompat = async () => {
    setCompatBusy(true);
    try {
      const list = await listCompatModels({ baseUrl: s.compatBaseUrl, key: compatKey.trim() });
      setCompatModels(list);
      const model = pickModel(list, s.compatModel || preset.model);
      updateSettings({ compatKey: compatKey.trim(), compatModel: model, compatVision: looksMultimodal(model) });
      toast(`Connected ✓ — ${list.length} models, using ${model}`, 'success');
    } catch (e) {
      toastError(e);
    } finally {
      setCompatBusy(false);
    }
  };

  const verify = async () => {
    setChecking(true);
    try {
      const list = await listModels(key.trim());
      setModels(list);
      const upgrades = modelUpgrades(list.map((m) => m.name), s);
      updateSettings({ apiKey: key.trim(), ...upgrades });
      const textModel = upgrades.textModel ?? s.textModel;
      await probeModel(textModel, key.trim());
      toast(`Gemini key works ✓ — using ${textModel}`, 'success');
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
          Which model writes your chat answers, study documents, flashcards and lecture notes — and, if it reads images, your handwriting too.
          Audio transcription, PDFs, YouTube, websites, web research and Audio Overview voices always run on Gemini.
        </p>
        <Segmented
          value={s.textProvider}
          onChange={(textProvider) => updateSettings({ textProvider })}
          options={[
            { value: 'gemini', label: 'Gemini' },
            { value: 'compat', label: 'Another provider' },
          ]}
        />
        {s.textProvider === 'compat' && (
          <>
            <label className="field">
              <span>Provider</span>
              <select className="input" value={s.compatPreset} onChange={(e) => choosePreset(e.target.value)}>
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {preset.note && <p className="muted small">{preset.note}</p>}
            <label className="field">
              <span>API base URL</span>
              <input
                className="input mono"
                value={s.compatBaseUrl}
                onChange={(e) => updateSettings({ compatBaseUrl: e.target.value, compatPreset: 'custom' })}
                placeholder="https://integrate.api.nvidia.com/v1"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            {!proxied && (
              <>
                {preset.keyUrl && (
                  <p className="muted small">
                    Get a key at{' '}
                    <a href={preset.keyUrl} target="_blank" rel="noreferrer">
                      {preset.keyUrl.replace(/^https:\/\//, '')}
                    </a>
                    . It is stored only on this device.
                  </p>
                )}
                <div className="key-row">
                  <input
                    className="input mono"
                    type="password"
                    autoComplete="off"
                    placeholder={preset.keyHint}
                    value={compatKey}
                    onChange={(e) => setCompatKey(e.target.value)}
                  />
                  <button className="btn primary" onClick={verifyCompat} disabled={compatBusy || !compatKey.trim()}>
                    {compatBusy ? <Spinner size={14} /> : s.compatKey && s.compatKey === compatKey.trim() ? <ICheck size={16} /> : null}{' '}
                    {s.compatKey === compatKey.trim() && s.compatKey ? 'Saved' : 'Save & test'}
                  </button>
                </div>
              </>
            )}
            {proxied && (
              <button className="btn" onClick={verifyCompat} disabled={compatBusy}>
                {compatBusy ? <Spinner size={14} /> : null} Test connection
              </button>
            )}
            <label className="field">
              <span>Model</span>
              {compatModels?.length ? (
                <select className="input" value={s.compatModel} onChange={(e) => chooseModel(e.target.value)}>
                  {!compatModels.includes(s.compatModel) && s.compatModel && <option value={s.compatModel}>{s.compatModel}</option>}
                  {compatModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input mono"
                  value={s.compatModel}
                  onChange={(e) => chooseModel(e.target.value)}
                  placeholder={preset.model || 'model name'}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </label>
            <p className="muted small">Test the connection to load the provider’s real model list.</p>
            <label className="check">
              <input type="checkbox" checked={s.compatVision} onChange={(e) => updateSettings({ compatVision: e.target.checked })} />
              This model can read images — use it to transcribe handwriting
            </label>
            <p className="muted small">
              Ticked automatically when the model’s name suggests it, which is only a guess. If transcribing fails with an error about images, untick
              it and Gemini takes over. Audio, PDFs and web research always stay on Gemini.
            </p>
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
          <input className="input mono" type="password" autoComplete="off" placeholder="AQ.… or AIza…" value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="btn primary" onClick={verify} disabled={!key.trim() || checking}>
            {checking ? <Spinner size={14} /> : s.apiKey && s.apiKey === key.trim() ? <ICheck size={16} /> : null} {s.apiKey === key.trim() && s.apiKey ? 'Saved' : 'Save & test'}
          </button>
        </div>
        <p className="muted small">
          Newer AI Studio keys start with <code>AQ.</code>; older ones start with <code>AIza</code>. Both work here.
        </p>
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
              <DraftInput className="input" value={s.hostA} onValue={(v) => v.trim() && updateSettings({ hostA: v.trim() })} />
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
              <DraftInput className="input" value={s.hostB} onValue={(v) => v.trim() && updateSettings({ hostB: v.trim() })} />
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
        <label className="check">
          <input type="checkbox" checked={s.autoOcr} onChange={(e) => updateSettings({ autoOcr: e.target.checked })} />
          Read handwriting as you go, so it’s searchable and its [[links]] and #tags count (one AI request per sketch you change)
        </label>
      </section>

      <section className="set-section">
        <h3>Study</h3>
        <div className="grid2">
          <label className="field">
            <span>Daily goal (cards)</span>
            <DraftInput className="input" type="number" min={1} max={500} value={String(s.dailyGoal)} onValue={(v) => Number(v) >= 1 && updateSettings({ dailyGoal: Math.min(500, Math.round(Number(v))) })} />
          </label>
          <label className="field">
            <span>New cards per day</span>
            <DraftInput className="input" type="number" min={0} max={500} value={String(s.newPerDay)} onValue={(v) => v.trim() !== '' && Number(v) >= 0 && updateSettings({ newPerDay: Math.min(500, Math.round(Number(v))) })} />
          </label>
        </div>
      </section>

      <section className="set-section">
        <h3>Revision</h3>
        <div className="field">
          <span>Subjects with a weekly target and streak (up to three get their own chart colour)</span>
          <div className="row wrap">
            {subjects.map((x) => (
              <label key={x.id} className="check">
                <input
                  type="checkbox"
                  checked={s.revisionSubjects.includes(x.id)}
                  onChange={(e) => updateSettings({ revisionSubjects: e.target.checked ? [...s.revisionSubjects, x.id] : s.revisionSubjects.filter((id) => id !== x.id) })}
                />
                {x.name}
              </label>
            ))}
          </div>
        </div>
        <div className="grid2">
          <label className="field">
            <span>Hours a week per subject</span>
            <DraftInput className="input" type="number" min={1} max={40} value={String(s.weeklyTargetHours)} onValue={(v) => Number(v) >= 0.5 && updateSettings({ weeklyTargetHours: Math.min(40, Number(v)) })} />
          </label>
          <label className="field">
            <span>Minutes a day to keep a streak</span>
            <DraftInput className="input" type="number" min={1} max={240} value={String(s.streakMinMinutes)} onValue={(v) => Number(v) >= 1 && updateSettings({ streakMinMinutes: Math.min(240, Math.round(Number(v))) })} />
          </label>
          <label className="field">
            <span>Stop counting after idle (minutes)</span>
            <DraftInput className="input" type="number" min={1} max={15} value={String(s.idleMinutes)} onValue={(v) => Number(v) >= 1 && updateSettings({ idleMinutes: Math.min(15, Math.round(Number(v))) })} />
          </label>
        </div>
      </section>

      <NotificationSettings />

      <section className="set-section">
        <h3>Your data</h3>
        <p className="muted">
          Everything lives on this device ({usage || 'calculating…'}
          {persisted === false ? ', not yet protected from eviction' : persisted ? ', protected storage' : ''}). Add Scrabbler to your Home Screen and back up regularly: on an iPad, Back up now opens the share sheet, where Save to Files puts the backup in iCloud Drive.
        </p>
        <p className="muted">
          {backup?.lastAt ? `Last backup ${ago(backup.lastAt)} (${new Date(backup.lastAt).toLocaleDateString()}).` : 'No backup made on this device yet.'}
          {backup?.changedSince ? ' You have changes since.' : ''}
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
            className="btn primary"
            disabled={backingUp}
            onClick={async () => {
              setBackingUp(true);
              try {
                await backupNow();
              } finally {
                setBackingUp(false);
              }
            }}
          >
            {backingUp ? <Spinner size={14} /> : <IDownload size={16} />} Back up now
          </button>
          <label className="btn">
            <IUpload size={16} /> Import backup
            <input
              type="file"
              accept="application/zip,.zip,application/json,.json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                if (!(await confirmDialog('Restore this backup? Notes, cards and reminders in it replace the versions on this device, even if those are newer.', 'Restore'))) return;
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
            className="btn"
            onClick={async () => {
              try {
                download(await exportVault(), `Scrabbler vault ${new Date().toISOString().slice(0, 10)}.zip`);
              } catch (e) {
                toastError(e);
              }
            }}
            title="Markdown files in your folders, with [[links]], tags and sketches — unzip into Obsidian"
          >
            <IDownload size={16} /> Export Obsidian vault
          </button>
          <label className="btn" title="A zipped Obsidian vault comes in as a folder of its own">
            <IUpload size={16} /> Import Obsidian vault
            <input
              type="file"
              accept="application/zip,.zip"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  const r = await importVault(f);
                  toast(`Imported ${r.notes} notes into ${r.folders} folders`, 'success');
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
