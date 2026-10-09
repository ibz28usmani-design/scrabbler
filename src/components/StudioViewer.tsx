import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db, type MindNode, type StudioItem } from '../db';
import { mdToEditorHtml, mdToHtml, escapeHtml } from '../lib/markdown';
import { createNote } from '../lib/notes';
import { renderPodcastVoices } from '../lib/studio';
import { deviceVoices, speakLine } from '../lib/speech';
import { useSettings } from '../lib/settings';
import { toast } from '../lib/events';
import { download } from '../lib/backup';
import { Modal, useObjectUrl } from './ui';
import { ICopy, IDownload, IPause, IPlay, IRefresh, ICompose } from './Icons';

export function StudioViewer({ item, onClose }: { item: StudioItem; onClose: () => void }) {
  const saveAsNote = async () => {
    let html = '';
    if (item.markdown) html = mdToEditorHtml(item.markdown);
    else if (item.mind) html = `<h1>${escapeHtml(item.title)}</h1>${mindToHtml(item.mind)}`;
    else if (item.script) html = `<h1>${escapeHtml(item.title)}</h1>` + item.script.map((l) => `<p><strong>${escapeHtml(l.speaker)}:</strong> ${escapeHtml(l.text)}</p>`).join('');
    if (!/^<h1/.test(html)) html = `<h1>${escapeHtml(item.title)}</h1>${html}`;
    await createNote(item.folderId, { title: item.title, content: html, snippet: '' });
    toast('Saved as a note', 'success');
    onClose();
  };
  return (
    <Modal
      title={item.title}
      onClose={onClose}
      wide
      className={`studio-viewer ${item.kind}`}
      footer={
        <>
          {item.markdown && (
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard.writeText(item.markdown!);
                toast('Copied', 'success');
              }}
            >
              <ICopy size={16} /> Copy
            </button>
          )}
          <span className="spacer" />
          <button className="btn primary" onClick={saveAsNote}>
            <ICompose size={16} /> Save as note
          </button>
        </>
      }
    >
      {item.markdown && <div className="prose md" dangerouslySetInnerHTML={{ __html: mdToHtml(item.markdown) }} />}
      {item.mind && <MindMap root={item.mind} />}
      {item.script && <Podcast item={item} />}
    </Modal>
  );
}

function mindToHtml(n: MindNode): string {
  return `<ul>${(n.children ?? []).map((c) => `<li><p>${escapeHtml(c.label)}</p>${c.children?.length ? mindToHtml(c) : ''}</li>`).join('')}</ul>`;
}

const BRANCH_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

function MindMap({ root }: { root: MindNode }) {
  return (
    <div className="mindmap">
      <div className="mm-root">{root.label}</div>
      <div className="mm-branches">
        {(root.children ?? []).map((c, i) => (
          <MindBranch key={i} node={c} color={BRANCH_COLORS[i % BRANCH_COLORS.length]} depth={1} />
        ))}
      </div>
    </div>
  );
}

function MindBranch({ node, color, depth }: { node: MindNode; color: string; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const kids = node.children ?? [];
  return (
    <div className={`mm-node d${depth}`} style={{ ['--c' as any]: color }}>
      <button className="mm-label" onClick={() => kids.length && setOpen(!open)}>
        {node.label}
        {kids.length > 0 && <span className="mm-count">{open ? '−' : kids.length}</span>}
      </button>
      {open && kids.length > 0 && (
        <div className="mm-kids">
          {kids.map((k, i) => (
            <MindBranch key={i} node={k} color={color} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function Podcast({ item }: { item: StudioItem }) {
  const blob = useLiveQuery(() => (item.audioBlobId ? db.blobs.get(item.audioBlobId) : undefined), [item.audioBlobId]);
  const url = useObjectUrl(blob?.blob);
  const audio = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [deviceIdx, setDeviceIdx] = useState<number | null>(null);
  const stopRef = useRef(false);
  const { hostA } = useSettings();
  const lines = item.script ?? [];
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Approximate which line is playing from character offsets.
  const offsets = useMemo(() => {
    const total = lines.reduce((a, l) => a + l.text.length + 30, 0);
    let acc = 0;
    return lines.map((l) => {
      const start = acc / total;
      acc += l.text.length + 30;
      return start;
    });
  }, [lines]);
  const audioIdx = duration ? offsets.findLastIndex((o) => o * duration <= time) : -1;
  const active = deviceIdx ?? audioIdx;

  useEffect(() => {
    lineRefs.current[active]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  useEffect(
    () => () => {
      stopRef.current = true;
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    },
    [],
  );

  const playDevice = async (from = 0) => {
    audio.current?.pause();
    stopRef.current = false;
    const voices = deviceVoices();
    const vA = voices[0];
    const vB = voices.find((v) => v.name !== vA?.name && v.name.split(' ')[0] !== vA?.name.split(' ')[0]) ?? voices[1] ?? vA;
    for (let i = from; i < lines.length; i++) {
      if (stopRef.current) break;
      setDeviceIdx(i);
      const isA = lines[i].speaker === hostA;
      await speakLine(lines[i].text, isA ? vA : vB, 1.03, isA ? 1 : 1.08);
    }
    setDeviceIdx(null);
  };

  const stopDevice = () => {
    stopRef.current = true;
    speechSynthesis.cancel();
    setDeviceIdx(null);
  };

  return (
    <div className="podcast">
      <div className="podcast-player">
        <div className="podcast-art">
          <span className="wave">
            {Array.from({ length: 18 }).map((_, i) => (
              <i key={i} style={{ animationDelay: `${(i * 97) % 900}ms` }} className={(audio.current && !audio.current.paused) || deviceIdx !== null ? 'live' : ''} />
            ))}
          </span>
        </div>
        {url ? (
          <audio ref={audio} src={url} controls onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} onPlay={stopDevice} />
        ) : (
          item.error && <p className="muted small">{item.error}</p>
        )}
        <div className="podcast-actions">
          {deviceIdx === null ? (
            <button className="btn" onClick={() => playDevice(0)}>
              <IPlay size={15} /> {url ? 'Play with device voices' : 'Play'}
            </button>
          ) : (
            <button className="btn" onClick={stopDevice}>
              <IPause size={15} /> Stop
            </button>
          )}
          {!url && (
            <button className="btn" onClick={() => renderPodcastVoices(item.id)}>
              <IRefresh size={15} /> Try studio voices again
            </button>
          )}
          {blob && (
            <button className="btn" onClick={() => download(blob.blob, `${item.title}.wav`)}>
              <IDownload size={15} /> Download
            </button>
          )}
        </div>
      </div>
      <div className="podcast-lines">
        {lines.map((l, i) => (
          <div
            key={i}
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            className={`pline ${l.speaker === hostA ? 'a' : 'b'} ${i === active ? 'now' : ''}`}
            onClick={() => {
              if (deviceIdx !== null) {
                stopDevice();
                setTimeout(() => playDevice(i), 50);
              } else if (audio.current && duration) {
                audio.current.currentTime = offsets[i] * duration;
                audio.current.play();
              }
            }}
          >
            <span className="pspeaker">{l.speaker}</span>
            <span>{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
