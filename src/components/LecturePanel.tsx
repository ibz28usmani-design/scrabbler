import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db, type Note } from '../db';
import { processLecture } from '../lib/lecture';
import { fmtClock } from '../lib/dates';
import { Spinner, useObjectUrl } from './ui';
import { IChevD, IChevR, IRefresh, ISparkle, ICopy } from './Icons';
import { toast } from '../lib/events';

const STATUS: Record<string, string> = {
  recording: 'Recording…',
  transcribing: 'Transcribing with speaker labels…',
  writing: 'Writing structured notes…',
};

export function LecturePanel({ note }: { note: Note }) {
  const blob = useLiveQuery(() => (note.audioBlobId ? db.blobs.get(note.audioBlobId) : undefined), [note.audioBlobId]);
  const url = useObjectUrl(blob?.blob);
  const audio = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState('');
  const busy = note.status === 'transcribing' || note.status === 'writing';
  const segs = note.transcript ?? [];
  const current = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < segs.length; i++) if (segs[i].start <= time + 0.25) idx = i;
    return idx;
  }, [segs, time]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || current < 0) return;
    const el = listRef.current?.querySelector(`[data-i="${current}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [current, open]);

  return (
    <div className="lecture">
      <div className="lecture-row">
        {url ? <audio ref={audio} src={url} controls preload="metadata" onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} /> : <div className="muted">Audio unavailable</div>}
      </div>
      {busy && (
        <div className="lecture-status">
          <Spinner /> {STATUS[note.status!]}
          <span className="muted"> — you can keep using the app.</span>
        </div>
      )}
      {note.status === 'error' && (
        <div className="lecture-error">
          <div>{note.error}</div>
          <div className="lecture-retry">
            <input className="input" placeholder="Optional: course, topic or tricky terms (improves accuracy)" value={context} onChange={(e) => setContext(e.target.value)} />
            <button className="btn primary" onClick={() => processLecture(note.id, { context })}>
              <ISparkle size={16} /> Transcribe & write notes
            </button>
          </div>
        </div>
      )}
      {segs.length > 0 && (
        <div className="transcript">
          <div className="transcript-head">
            <button className="transcript-toggle" onClick={() => setOpen(!open)}>
              {open ? <IChevD size={16} /> : <IChevR size={16} />} Transcript · {segs.length} segments
            </button>
            <span className="spacer" />
            <button
              className="icon-btn small"
              title="Copy transcript"
              onClick={() => {
                navigator.clipboard.writeText(segs.map((s) => `[${fmtClock(s.start)}] ${s.speaker ? s.speaker + ': ' : ''}${s.text}`).join('\n'));
                toast('Transcript copied', 'success');
              }}
            >
              <ICopy size={16} />
            </button>
            {!busy && (
              <button className="icon-btn small" title="Rewrite notes from transcript" onClick={() => processLecture(note.id)}>
                <IRefresh size={16} />
              </button>
            )}
          </div>
          {open && (
            <div className="transcript-list" ref={listRef}>
              {segs.map((s, i) => (
                <button
                  key={i}
                  data-i={i}
                  className={`seg ${i === current ? 'now' : ''}`}
                  onClick={() => {
                    if (audio.current) {
                      audio.current.currentTime = s.start;
                      audio.current.play();
                    }
                  }}
                >
                  <span className="seg-time">{fmtClock(s.start)}</span>
                  <span className="seg-body">
                    {s.speaker && (i === 0 || segs[i - 1].speaker !== s.speaker) && <span className="seg-speaker">{s.speaker}</span>}
                    {s.text}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
