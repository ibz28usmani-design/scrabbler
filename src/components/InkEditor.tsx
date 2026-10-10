import { useEffect, useRef, useState } from 'react';
import { db, type Note } from '../db';
import { EndlessCanvas } from './EndlessCanvas';
import { TranscribeDialog } from './TranscribeDialog';
import { ExportDialog } from './ExportDialog';
import { HANDWRITING_TEMPLATES, PAGE_H, paperLabel, type Paper } from '../lib/paper';
import { contentBottom, type Stroke } from '../lib/ink';
import { nav, toggleSidebar, useNav } from '../lib/nav';
import { useDark } from '../lib/theme';
import { confirmDialog, Menu, useElementWidth, useMenu } from './ui';
import { FocusButton } from './FocusMode';
import { IBook, IChevL, IDownload, IFolder, IMore, IPin, ISidebar, ISparkle, ITrash } from './Icons';
import { toast } from '../lib/events';

/** Editor for handwritten notes: a title above an endless canvas. */
export function InkEditor({ note, narrow, wide }: { note: Note; narrow: boolean; wide: boolean }) {
  const dark = useDark();
  const { notebookOpen, focus } = useNav();
  const ink = note.ink ?? { paper: 'blank' as Paper, strokes: [], height: PAGE_H };
  const [paper, setPaper] = useState<Paper>(ink.paper);
  const [zoom, setZoom] = useState(1);
  const [title, setTitle] = useState(note.title);
  const [transcribe, setTranscribe] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [moreAnchor, openMore, closeMore] = useMenu();
  // Below this the row cannot hold every action without pushing some off-screen.
  const paneRef = useRef<HTMLDivElement>(null);
  // Shed the secondary actions first; only hide the primary ones when the pane
  // is genuinely too small, rather than emptying the row all at once.
  const paneW = useElementWidth(paneRef);
  const tight = paneW > 0 && paneW < 700;
  const tighter = paneW > 0 && paneW < 470;
  // Pinch-to-zoom covers the canvas, so the zoom stepper is the first thing to
  // go once the row is short of room.
  const hideZoom = tighter;
  const [moveAnchor, openMove, closeMove] = useMenu();
  const latest = useRef({ strokes: ink.strokes as Stroke[], height: ink.height, paper: ink.paper as Paper });
  const timer = useRef(0);

  const save = () => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    const { strokes, height, paper: p } = latest.current;
    const pages = Math.max(1, Math.ceil(contentBottom(strokes) / PAGE_H));
    db.notes.update(note.id, {
      ink: { paper: p, strokes, height },
      snippet: `Handwritten · ${paperLabel(p)}${strokes.length ? ` · ${pages} page${pages === 1 ? '' : 's'}` : ''}`,
      updatedAt: Date.now(),
    });
  };
  const scheduleSave = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, 350);
  };

  // Flush unsaved ink when leaving the note.
  useEffect(
    () => () => {
      if (timer.current) save();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const changePaper = (p: Paper) => {
    setPaper(p);
    latest.current.paper = p;
    scheduleSave();
  };

  const flush = () => {
    if (timer.current) save();
  };

  const deleteNote = async () => {
    if (!(await confirmDialog('Move this note to Recently Deleted?', 'Delete'))) return;
    await db.notes.update(note.id, { deletedAt: Date.now() });
    nav({ noteId: null, pane: 'list', focus: false });
  };

  return (
    <div className="editor-pane ink-pane" ref={paneRef}>
      <div className="toolbar">
        {narrow ? (
          <button className="icon-btn accent" onClick={() => nav({ pane: 'list' })} aria-label="Back">
            <IChevL /> <span className="back-label">Notes</span>
          </button>
        ) : (
          !wide &&
          !focus && (
            <button className="icon-btn" onClick={toggleSidebar} aria-label="Toggle sidebar">
              <ISidebar />
            </button>
          )
        )}
        <input
          className="ink-title"
          value={title}
          placeholder="Untitled handwritten note"
          aria-label="Note title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => db.notes.update(note.id, { title: title.trim(), updatedAt: Date.now() })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="spacer" />
        <select className="paper-select" value={paper} onChange={(e) => changePaper(e.target.value as Paper)} aria-label="Paper">
          {HANDWRITING_TEMPLATES.map((t) => (
            <option key={t.paper} value={t.paper}>
              {t.label}
            </option>
          ))}
          {paper === 'dots' && <option value="dots">Dotted</option>}
        </select>
        {!hideZoom && (
        <div className="zoom" role="group" aria-label="Zoom">
          <button className="icon-btn small" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Zoom out">
            −
          </button>
          <button className="zoom-pct" onClick={() => setZoom(1)} title="Reset zoom">
            {Math.round(zoom * 100)}%
          </button>
          <button className="icon-btn small" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} aria-label="Zoom in">
            +
          </button>
        </div>
        )}
        {/* Notebook and Full screen always stay on the bar — they are how you
            reach the notebook and the hover-in panels, so they are the last
            things that should need a menu. Export yields first, then the
            Transcribe label, then Transcribe itself. */}
        {!tighter && (
          <button
            className="icon-btn ai"
            onClick={() => {
              flush();
              setTranscribe(true);
            }}
            aria-label="Transcribe handwriting"
            title="Transcribe handwriting to text"
          >
            <ISparkle />
            {!tight && <span className="btn-label">Transcribe</span>}
          </button>
        )}
        {!tight && (
          <button
            className="icon-btn"
            onClick={() => {
              flush();
              setExporting(true);
            }}
            aria-label="Export"
            title="Save to device"
          >
            <IDownload />
          </button>
        )}
        <button
          className={`icon-btn ${notebookOpen && !focus ? 'on' : ''}`}
          onClick={() => (focus ? nav({ focusPanel: 'notebook' }) : nav({ notebookOpen: !notebookOpen }))}
          aria-label="Notebook panel"
          title={focus ? 'Notebook — or hover the right edge' : 'Notebook'}
        >
          <IBook />
        </button>
        <FocusButton />
        <button className="icon-btn" onClick={(e) => openMore(e.currentTarget)} aria-label="More">
          <IMore />
        </button>
      </div>

      <EndlessCanvas
        key={note.id}
        paper={paper}
        strokes={ink.strokes as Stroke[]}
        height={ink.height}
        dark={dark}
        zoom={zoom}
        onZoom={setZoom}
        onChange={(patch) => {
          if (patch.strokes) latest.current.strokes = patch.strokes;
          if (patch.height) latest.current.height = patch.height;
          scheduleSave();
        }}
      />

      {transcribe && <TranscribeDialog note={note} onClose={() => setTranscribe(false)} />}
      {exporting && <ExportDialog note={note} onClose={() => setExporting(false)} />}
      {moreAnchor && (
        <Menu
          anchor={moreAnchor}
          align="right"
          onClose={closeMore}
          items={[
            ...(tighter
              ? [
                  {
                    label: 'Transcribe handwriting',
                    icon: <ISparkle size={18} />,
                    onClick: () => {
                      flush();
                      setTranscribe(true);
                    },
                  },
                ]
              : []),
            ...(tight
              ? [
                  {
                    label: 'Save to device…',
                    icon: <IDownload size={18} />,
                    onClick: () => {
                      flush();
                      setExporting(true);
                    },
                  },
                  { divider: true, label: '' },
                ]
              : []),
            { label: note.pinned ? 'Unpin note' : 'Pin note', icon: <IPin size={18} />, onClick: () => db.notes.update(note.id, { pinned: !note.pinned }) },
            { label: 'Move to folder…', icon: <IFolder size={18} />, onClick: () => setTimeout(() => openMove(moreAnchor), 0) },
            { divider: true, label: '' },
            { label: 'Delete note', icon: <ITrash size={18} />, danger: true, onClick: deleteNote },
          ]}
        />
      )}
      {moveAnchor && <MoveMenu anchor={moveAnchor} note={note} onClose={closeMove} />}
    </div>
  );
}

function MoveMenu({ anchor, note, onClose }: { anchor: HTMLElement; note: Note; onClose: () => void }) {
  const [folders, setFolders] = useState<{ id: string; name: string; emoji: string }[]>([]);
  useEffect(() => {
    db.folders.orderBy('order').toArray().then(setFolders);
  }, []);
  return (
    <Menu
      anchor={anchor}
      align="right"
      onClose={onClose}
      items={folders.map((f) => ({
        label: `${f.emoji} ${f.name}`,
        disabled: f.id === note.folderId,
        onClick: async () => {
          await db.notes.update(note.id, { folderId: f.id });
          toast(`Moved to ${f.name}`, 'success');
        },
      }))}
    />
  );
}
