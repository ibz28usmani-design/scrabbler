import { useEffect, useRef, useState } from 'react';
import { putBlob } from '../db';
import { startRecording, geminiMime, type RecorderHandle } from '../lib/audio';
import { startLiveCaptions, speechSupported, type LiveCaptions } from '../lib/speech';
import { createNote } from '../lib/notes';
import { processLecture } from '../lib/lecture';
import { closeModal } from '../lib/nav';
import { fmtClock } from '../lib/dates';
import { toastError } from '../lib/events';
import { useSettings, updateSettings } from '../lib/settings';
import { hasKey } from '../lib/gemini';
import { Modal, confirmDialog } from './ui';
import { IMic, IPause, IPlay, IStop, IUpload } from './Icons';

export function Recorder({ folderId }: { folderId: string }) {
  const [phase, setPhase] = useState<'setup' | 'recording' | 'saving'>('setup');
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [levels, setLevels] = useState<number[]>(() => Array(48).fill(0));
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [caption, setCaption] = useState({ final: '', interim: '' });
  const rec = useRef<RecorderHandle | null>(null);
  const live = useRef<LiveCaptions | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { liveCaptions } = useSettings();
  const captionBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => setElapsed(rec.current?.elapsed ?? 0), 250);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    captionBox.current?.scrollTo({ top: captionBox.current.scrollHeight });
  }, [caption]);

  useEffect(
    () => () => {
      live.current?.stop();
      rec.current?.stop().catch(() => {});
    },
    [],
  );

  const start = async () => {
    try {
      let last = 0;
      rec.current = await startRecording((lvl) => {
        const now = performance.now();
        if (now - last < 60) return;
        last = now;
        setLevels((l) => [...l.slice(1), lvl]);
      });
      if (liveCaptions && speechSupported()) live.current = startLiveCaptions((final, interim) => setCaption({ final, interim }));
      setPhase('recording');
    } catch (e) {
      toastError(new Error(`Microphone unavailable: ${(e as Error).message}. Allow microphone access in Settings › Safari.`));
    }
  };

  const finish = async () => {
    if (!rec.current) return;
    setPhase('saving');
    live.current?.stop();
    const duration = rec.current.elapsed;
    const blob = await rec.current.stop();
    rec.current = null;
    const name = title.trim() || `Lecture ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    const blobId = await putBlob(blob, `${name}.mp3`);
    const note = await createNote(folderId, {
      kind: 'lecture',
      title: name,
      snippet: `Recording · ${fmtClock(duration)}`,
      audioBlobId: blobId,
      status: 'transcribing',
      content: `<h1>${name.replace(/</g, '&lt;')}</h1><p></p>`,
    });
    closeModal();
    processLecture(note.id, { context: context.trim() || undefined, liveText: caption.final });
  };

  const upload = async (file: File) => {
    setPhase('saving');
    const name = title.trim() || file.name.replace(/\.[^.]+$/, '');
    const typed = new File([file], file.name, { type: geminiMime(file) });
    const blobId = await putBlob(typed, file.name);
    const note = await createNote(folderId, { kind: 'lecture', title: name, snippet: 'Uploaded recording', audioBlobId: blobId, status: 'transcribing', content: `<h1>${name.replace(/</g, '&lt;')}</h1><p></p>` });
    closeModal();
    processLecture(note.id, { context: context.trim() || undefined });
  };

  const close = async () => {
    if (phase === 'recording' && !(await confirmDialog('Discard this recording?', 'Discard'))) return;
    closeModal();
  };

  return (
    <Modal title={phase === 'recording' ? 'Recording lecture' : 'Record a lecture'} onClose={close} className="recorder">
      {phase === 'setup' && (
        <div className="rec-setup">
          <label className="field">
            <span>Title</span>
            <input className="input" placeholder="e.g. Biology 101 — Cell respiration" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>Topic & key terms (optional — boosts transcription accuracy)</span>
            <input className="input" placeholder="e.g. glycolysis, Krebs cycle, ATP synthase, Prof. Nakamura" value={context} onChange={(e) => setContext(e.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={liveCaptions} onChange={(e) => updateSettings({ liveCaptions: e.target.checked })} disabled={!speechSupported()} />
            Live captions while recording (on-device{speechSupported() ? '' : ' — not supported in this browser'})
          </label>
          {!hasKey() && <p className="warn">No Gemini key yet — the recording will be saved and you can transcribe it once you add one in Settings.</p>}
          <div className="rec-actions">
            <button className="rec-big" onClick={start} aria-label="Start recording">
              <IMic size={34} />
            </button>
            <div className="muted">Tap to start · keep Scrabbler open while recording</div>
            <button className="btn" onClick={() => fileInput.current?.click()}>
              <IUpload size={17} /> Upload audio or video instead
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.ogg,.flac,.mp4,.mov,.webm"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
          </div>
        </div>
      )}
      {phase === 'recording' && (
        <div className="rec-live">
          <div className={`rec-timer ${paused ? 'paused' : ''}`}>
            <span className="rec-dot" /> {fmtClock(elapsed)}
          </div>
          <div className="rec-wave" aria-hidden="true">
            {levels.map((l, i) => (
              <span key={i} style={{ height: `${6 + l * 74}%` }} />
            ))}
          </div>
          {liveCaptions && speechSupported() && (
            <div className="rec-captions" ref={captionBox}>
              {caption.final || caption.interim ? (
                <>
                  {caption.final} <span className="interim">{caption.interim}</span>
                </>
              ) : (
                <span className="muted">Live captions will appear here…</span>
              )}
            </div>
          )}
          <div className="rec-controls">
            <button
              className="btn round"
              onClick={() => {
                if (!rec.current) return;
                if (paused) rec.current.resume();
                else rec.current.pause();
                setPaused(!paused);
              }}
              aria-label={paused ? 'Resume' : 'Pause'}
            >
              {paused ? <IPlay size={22} /> : <IPause size={22} />}
            </button>
            <button className="rec-stop" onClick={finish} aria-label="Stop and save">
              <IStop size={26} />
            </button>
          </div>
          <div className="muted center">Stop to save. Scrabbler will transcribe it with speaker labels and write structured notes.</div>
        </div>
      )}
      {phase === 'saving' && <div className="center pad">Saving…</div>}
    </Modal>
  );
}
