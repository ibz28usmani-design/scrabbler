import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Placeholder } from '@tiptap/extension-placeholder';
import { useLiveQuery } from 'dexie-react-hooks';
import { editorExtensions } from './editorExtensions';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { db, type Note } from '../db';
import { LecturePanel } from './LecturePanel';
import { AIToolsButton, OPEN_AI_TOOLS } from './AITools';
import { menuExtensions } from './SlashMenu';
import { FileDrop } from './NotionBlockViews';
import { downscaleImage } from '../lib/attachments';
import { BlockHandle } from './BlockHandle';
import { setSlashHost } from '../lib/slashCommands';
import { nav, toggleSidebar, openModal, useNav } from '../lib/nav';
import { Menu, useElementWidth, useMenu, confirmDialog } from './ui';
import { IAa, IBook, IChecklist, IChevL, ICompose, IImage, IMic, IMore, IPencil, IPin, IRuled, ISidebar, ITable, ITrash, ICards, IDownload, IFolder, IClock } from './Icons';
import { NOTE_REPLACED } from '../lib/versions';
import { lazyNamed } from '../lib/lazy';
import { FocusButton } from './FocusMode';
import { toast } from '../lib/events';
import { createNote, linksFor } from '../lib/notes';
import { NoteContext } from '../lib/noteContext';
import { HANDWRITING_TEMPLATES, type Paper } from '../lib/paper';
import { beginHandoff, endHandoff, handoffActive, moveHandoff } from '../lib/penHandoff';
import { useStudyPresence } from '../lib/useStudyPresence';
import { LinksPanel } from './LinksPanel';
import { AppIcon } from './AppIcon';

export { editorExtensions };

const ExportDialog = lazyNamed(() => import('./ExportDialog'), 'ExportDialog');
const VersionHistory = lazyNamed(() => import('./VersionHistory'), 'VersionHistory');

function summarize(editor: Editor) {
  const text = editor.getText({ blockSeparator: '\n' });
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const hasDrawing = editor.getJSON().content?.some((n) => n.type === 'drawing');
  return {
    title: (lines[0] ?? '').slice(0, 120),
    snippet: lines.slice(1, 3).join(' ').slice(0, 160) || (hasDrawing ? 'Handwriting' : ''),
    text,
  };
}

export function NoteEditor({ note, narrow, wide }: { note: Note; narrow: boolean; wide: boolean }) {
  const saveTimer = useRef<number>(0);
  const noteId = note.id;
  const { notebookOpen, focus } = useNav();
  const [exporting, setExporting] = useState(false);
  const [history, setHistory] = useState(false);
  const [words, setWords] = useState(() => countWords(note.text ?? ''));
  // Below this the row cannot hold every action without pushing some off-screen.
  const paneRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Shed the secondary actions first; only hide the primary ones when the pane
  // is genuinely too small, rather than emptying the row all at once.
  const paneW = useElementWidth(paneRef);
  const tight = paneW > 0 && paneW < 700;
  const tighter = paneW > 0 && paneW < 470;
  const imgInput = useRef<HTMLInputElement>(null);
  const [fmtAnchor, openFmt, closeFmt] = useMenu();
  const [moreAnchor, openMore, closeMore] = useMenu();
  const [moveAnchor, openMove, closeMove] = useMenu();
  const [paperAnchor, openPaper, closePaper] = useMenu();
  useStudyPresence(note.kind === 'lecture' ? 'lecture' : 'notes', { folderId: note.folderId });
  const folders = useLiveQuery(() => db.folders.orderBy('order').toArray(), []) ?? [];

  const editor = useEditor(
    {
      extensions: [
        ...editorExtensions,
        ...menuExtensions,
        FileDrop,
        Placeholder.configure({
          placeholder: ({ node, pos }) =>
            pos === 0 && node.type.name !== 'drawing' ? 'Title' : node.type.name === 'detailsSummary' ? 'Toggle' : node.type.name === 'heading' ? `Heading ${node.attrs.level}` : 'Start writing, or write anywhere with Apple Pencil…',
          showOnlyCurrent: false,
          includeChildren: true,
        }),
      ],
      content: (note.content as any) ?? '',
      editorProps: { attributes: { class: 'prose', spellcheck: 'true', autocapitalize: 'sentences' } },
      onUpdate: ({ editor }) => {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(async () => {
          saveTimer.current = 0;
          const s = summarize(editor);
          setWords(countWords(s.text));
          const content = editor.getJSON();
          db.notes.update(noteId, { content, ...s, ...(await linksFor({ id: noteId, content, text: s.text })), updatedAt: Date.now() });
        }, 400);
      },
    },
    [noteId],
  );

  // Flush a pending save when switching notes, or when the app is put away (it may not come back).
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current && editor && !editor.isDestroyed) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = 0;
        const s = summarize(editor);
        db.notes.update(noteId, { content: editor.getJSON(), ...s, updatedAt: Date.now() });
      }
    };
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [editor, noteId]);

  // A version restored, or an AI rewrite undone, from outside the editor: show it, and drop any pending save of the old text.
  useEffect(() => {
    const onReplaced = (e: Event) => {
      const { noteId: id, content } = (e as CustomEvent).detail ?? {};
      if (id !== noteId || !editor || editor.isDestroyed) return;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = 0;
      editor.commands.setContent(content as any, { emitUpdate: false });
      setWords(countWords(editor.getText({ blockSeparator: '\n' })));
    };
    window.addEventListener(NOTE_REPLACED, onReplaced);
    return () => window.removeEventListener(NOTE_REPLACED, onReplaced);
  }, [editor, noteId]);

  // Focus a brand-new empty note — but not a handwritten one, where focusing the
  // trailing paragraph would scroll past the drawing block's own top (e.g. a Cornell
  // page's "Cues"/"Notes" labels) before the user ever sees it.
  useEffect(() => {
    const hasDrawing = editor?.getJSON().content?.some((n) => n.type === 'drawing');
    if (editor && !note.text && note.kind === 'note' && !hasDrawing && Date.now() - note.createdAt < 3000) editor.commands.focus('end');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // When AI rewrites the note content (e.g. lecture notes arrive), reload it.
  const contentVersion = useMemo(() => JSON.stringify(note.content ?? '').length + ':' + note.status, [note.content, note.status]);
  const lastStatus = useRef(note.status);
  useEffect(() => {
    if (!editor) return;
    if (lastStatus.current !== note.status && note.status === 'ready') editor.commands.setContent(note.content as any);
    lastStatus.current = note.status;
  }, [contentVersion, editor, note.content, note.status]);

  // While a Pencil stroke is being handed to a new sketch, it must not scroll the note.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hold = (e: TouchEvent) => handoffActive() && Array.from(e.touches).some((t: any) => t.touchType === 'stylus') && e.preventDefault();
    el.addEventListener('touchmove', hold, { passive: false });
    return () => el.removeEventListener('touchmove', hold);
  }, [editor]);

  // What the / menu needs from this screen.
  useEffect(() => {
    if (!editor) return;
    setSlashHost(editor, {
      noteId: note.id,
      folderId: note.folderId,
      pickImage: () => imgInput.current?.click(),
      openAI: () => window.dispatchEvent(new CustomEvent(OPEN_AI_TOOLS, { detail: editor })),
    });
  }, [editor, note.id, note.folderId]);

  if (!editor) return null;

  const fmt = (label: string, run: () => void, active: boolean, cls = '') => (
    <button className={`fmt-btn ${active ? 'on' : ''} ${cls}`} onClick={() => run()}>
      {label}
    </button>
  );

  const deleteNote = async () => {
    if (!(await confirmDialog('Move this note to Recently Deleted?', 'Delete'))) return;
    await db.notes.update(note.id, { deletedAt: Date.now() });
    nav({ noteId: null, pane: 'list' });
  };

  const setFont = (font: NonNullable<Note['font']>) => db.notes.update(note.id, { font });
  const paper: Paper = note.paper ?? (note.lined ? 'lines' : 'blank');
  const setPaper = (p: Paper) => db.notes.update(note.id, { paper: p, lined: p === 'lines' });

  /**
   * Apple Notes: the Pencil on empty page starts a drawing right there, and
   * the stroke that started it is in it. On text it is left to Scribble.
   */
  const onPenDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'pen' || e.button > 0) return;
    if ((e.target as HTMLElement).closest('.drawing-node, .ink-dock, button, a, input, select, textarea, .lecture-panel, .links-panel')) return;
    const view = editor.view;
    const doc = editor.state.doc;
    const last = doc.lastChild;
    const lastDom = view.dom.lastElementChild?.getBoundingClientRect();
    let from: number;
    let to: number;
    if (!lastDom || e.clientY > lastDom.bottom) {
      // Below everything: on the trailing empty line if there is one.
      const emptyLast = last?.type.name === 'paragraph' && !last.content.size;
      to = doc.content.size;
      from = emptyLast ? to - last!.nodeSize : to;
    } else {
      const hit = view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (!hit) return;
      const $pos = doc.resolve(hit.pos);
      if ($pos.depth < 1) return;
      const block = $pos.node(1);
      if (block.type.name !== 'paragraph' || block.content.size) return;
      from = $pos.before(1);
      to = $pos.after(1);
    }
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    beginHandoff(e.nativeEvent);
    editor
      .chain()
      .insertContentAt({ from, to }, [{ type: 'drawing', attrs: { strokes: [], height: 420, paper: null, adoptPen: true, autoActive: true } }, { type: 'paragraph' }])
      .run();
  };

  return (
    <div className="editor-pane" ref={paneRef}>
      <div className="toolbar">
        {narrow ? (
          <button className="icon-btn accent" onClick={() => nav({ pane: 'list' })} aria-label="Back">
            <IChevL /> <span className="back-label">Notes</span>
          </button>
        ) : (
          !wide && (
            <button className="icon-btn" onClick={toggleSidebar} aria-label="Toggle sidebar">
              <ISidebar />
            </button>
          )
        )}
        <div className="toolbar-group">
          <button className="icon-btn" onClick={(e) => openFmt(e.currentTarget)} aria-label="Formatting">
            <IAa />
          </button>
          {!tighter && (
            <button className="icon-btn" onClick={() => editor.chain().focus().toggleTaskList().run()} aria-label="Checklist">
              <IChecklist />
            </button>
          )}
          <button className="icon-btn" onClick={() => editor.chain().focus().insertDrawing().run()} aria-label="Draw">
            <IPencil />
          </button>
          {!tighter && (
            <>
              <button className="icon-btn" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} aria-label="Table">
                <ITable />
              </button>
              <button className="icon-btn" onClick={() => imgInput.current?.click()} aria-label="Insert image">
                <IImage />
              </button>
              <button className="icon-btn rec" onClick={() => openModal({ type: 'recorder', folderId: note.folderId })} aria-label="Record lecture">
                <IMic />
              </button>
            </>
          )}
          <AIToolsButton editor={editor} note={note} />
        </div>
        <span className="spacer" />
        {!tighter && (
          <button className="icon-btn" onClick={() => setExporting(true)} aria-label="Save to device" title="Save to device — PDF, Word, Markdown…">
            <IDownload />
          </button>
        )}
        {/* Notebook and Full screen always stay on the bar; only the word
            "Notebook" gives way, then the ruled-lines toggle. */}
        {!tight && (
          <button className={`icon-btn ${paper !== 'blank' ? 'on' : ''}`} onClick={(e) => openPaper(e.currentTarget)} aria-label="Lines & grids" title="Lines & grids">
            <IRuled />
          </button>
        )}
        <button
          className={`icon-btn ${notebookOpen && !focus ? 'on' : ''}`}
          onClick={() => (focus ? nav({ focusPanel: 'notebook' }) : nav({ notebookOpen: !notebookOpen }))}
          aria-label="Notebook panel"
          title={focus ? 'Notebook — or hover the right edge' : 'Notebook: sources, chat & studio'}
        >
          <IBook />
          {!tight && <span className="btn-label">Notebook</span>}
        </button>
        <FocusButton />
        <button className="icon-btn" onClick={(e) => openMore(e.currentTarget)} aria-label="More">
          <IMore />
        </button>
        <button
          className="icon-btn"
          aria-label="New note"
          onClick={() => createNote(note.folderId)}
        >
          <ICompose />
        </button>
        <input
          ref={imgInput}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            editor.chain().focus().setImage({ src: await downscaleImage(f) }).run();
          }}
        />
      </div>

      {note.kind === 'lecture' && <LecturePanel note={note} />}

      <div
        ref={scrollRef}
        className={`editor-scroll doc font-${note.font ?? 'serif'} paper-${paper}${paper === 'lines' || paper === 'cornell' ? ' lined' : ''}`}
        onPointerDown={onPenDown}
        onPointerMove={(e) => e.pointerType === 'pen' && handoffActive() && moveHandoff(e.nativeEvent)}
        onPointerUp={(e) => e.pointerType === 'pen' && endHandoff(e.nativeEvent)}
        onPointerCancel={(e) => e.pointerType === 'pen' && endHandoff(e.nativeEvent)}
      >
        <div className="doc-page">
          <div className="editor-date">{new Date(note.updatedAt).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}</div>
          <NoteContext.Provider value={{ noteId: note.id, folderId: note.folderId, title: note.title, paper }}>
            <EditorContent editor={editor} />
          </NoteContext.Provider>
          <BlockHandle editor={editor} />
          <LinksPanel note={note} />
        </div>
      </div>
      <div className="doc-status" aria-live="polite">
        {words.toLocaleString()} {words === 1 ? 'word' : 'words'} · {Math.max(1, Math.round(words / 200))} min read
      </div>
      <Suspense fallback={null}>
        {exporting && <ExportDialog note={note} onClose={() => setExporting(false)} />}
        {history && <VersionHistory note={note} onClose={() => setHistory(false)} />}
      </Suspense>

      {fmtAnchor && (
        <FormatPanel anchor={fmtAnchor} onClose={closeFmt}>
          <div className="fmt-row">
            {fmt('Title', () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 }), 'title')}
            {fmt('Heading', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }), 'heading')}
            {fmt('Subheading', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 }), 'sub')}
            {fmt('Body', () => editor.chain().focus().setParagraph().run(), editor.isActive('paragraph'))}
            {fmt('Code', () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive('codeBlock'), 'mono')}
          </div>
          <div className="fmt-row">
            {fmt('Serif', () => setFont('serif'), (note.font ?? 'serif') === 'serif', 'face-serif')}
            {fmt('Sans', () => setFont('sans'), note.font === 'sans', 'face-sans')}
            {fmt('Mono', () => setFont('mono'), note.font === 'mono', 'face-mono')}
            {fmt(paper === 'lines' ? 'Lines on' : 'Lines off', () => setPaper(paper === 'lines' ? 'blank' : 'lines'), paper === 'lines')}
          </div>
          <div className="fmt-row">
            {fmt('B', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'), 'b')}
            {fmt('I', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'), 'i')}
            {fmt('U', () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'), 'u')}
            {fmt('S', () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'), 's')}
            {fmt('Highlight', () => editor.chain().focus().toggleHighlight({ color: '#fde68a' }).run(), editor.isActive('highlight'))}
          </div>
          <div className="fmt-row">
            {fmt('• List', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
            {fmt('1. List', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
            {fmt('☐ Checklist', () => editor.chain().focus().toggleTaskList().run(), editor.isActive('taskList'))}
            {fmt('“ Quote', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'))}
          </div>
          <div className="fmt-row">
            {fmt('⇤ Left', () => editor.chain().focus().setTextAlign('left').run(), editor.isActive({ textAlign: 'left' }))}
            {fmt('Center', () => editor.chain().focus().setTextAlign('center').run(), editor.isActive({ textAlign: 'center' }))}
            {fmt('Right ⇥', () => editor.chain().focus().setTextAlign('right').run(), editor.isActive({ textAlign: 'right' }))}
            {fmt('— Divider', () => editor.chain().focus().setHorizontalRule().run(), false)}
          </div>
          {editor.isActive('table') && (
            <div className="fmt-row">
              {fmt('+ Row', () => editor.chain().focus().addRowAfter().run(), false)}
              {fmt('+ Column', () => editor.chain().focus().addColumnAfter().run(), false)}
              {fmt('− Row', () => editor.chain().focus().deleteRow().run(), false)}
              {fmt('− Column', () => editor.chain().focus().deleteColumn().run(), false)}
              {fmt('Delete table', () => editor.chain().focus().deleteTable().run(), false)}
            </div>
          )}
        </FormatPanel>
      )}

      {moreAnchor && (
        <Menu
          anchor={moreAnchor}
          align="right"
          onClose={closeMore}
          items={[
            ...(tighter
              ? [
                  { label: 'Insert table', icon: <ITable size={18} />, onClick: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
                  { label: 'Insert image', icon: <IImage size={18} />, onClick: () => imgInput.current?.click() },
                  { label: 'Record lecture', icon: <IMic size={18} />, onClick: () => openModal({ type: 'recorder', folderId: note.folderId }) },
                  { label: 'Save to device…', icon: <IDownload size={18} />, onClick: () => setExporting(true) },
                ]
              : []),
            ...(tight
              ? [
                  { label: 'Lines & grids…', icon: <IRuled size={18} />, onClick: () => setTimeout(() => openPaper(moreAnchor), 0) },
                  { divider: true, label: '' },
                ]
              : []),
            { label: note.pinned ? 'Unpin note' : 'Pin note', icon: <IPin size={18} />, onClick: () => db.notes.update(note.id, { pinned: !note.pinned }) },
            { label: 'Move to folder…', icon: <IFolder size={18} />, onClick: () => setTimeout(() => openMove(moreAnchor), 0) },
            { label: 'Make flashcards', icon: <ICards size={18} />, onClick: () => openModal({ type: 'generateDeck', from: { kind: 'note', noteId: note.id } }) },
            { label: 'Make a quiz', icon: <ICards size={18} />, onClick: () => openModal({ type: 'generateDeck', from: { kind: 'note', noteId: note.id }, quiz: true }) },
            { label: 'Save to device…', icon: <IDownload size={18} />, onClick: () => setExporting(true) },
            { label: 'Version history…', icon: <IClock size={18} />, onClick: () => setHistory(true) },
            { divider: true, label: '' },
            { label: 'Delete note', icon: <ITrash size={18} />, danger: true, onClick: deleteNote },
          ]}
        />
      )}
      {paperAnchor && (
        <Menu
          anchor={paperAnchor}
          align="right"
          onClose={closePaper}
          items={HANDWRITING_TEMPLATES.map((t) => ({
            label: `${paper === t.paper ? '✓ ' : ''}${t.label}`,
            hint: t.description,
            onClick: () => setPaper(t.paper),
          }))}
        />
      )}
      {moveAnchor && (
        <Menu
          anchor={moveAnchor}
          align="right"
          onClose={closeMove}
          items={folders.map((f) => ({
            label: f.name,
            icon: <AppIcon name={f.icon ?? f.emoji} size={17} />,
            disabled: f.id === note.folderId,
            onClick: async () => {
              await db.notes.update(note.id, { folderId: f.id });
              toast(`Moved to ${f.name}`, 'success');
            },
          }))}
        />
      )}
    </div>
  );
}

function FormatPanel({ anchor, onClose, children }: { anchor: HTMLElement; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = ref.current?.offsetWidth ?? 360;
    setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(r.left - 20, window.innerWidth - w - 8)) });
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [anchor, onClose]);
  return (
    <div className="fmt-panel" ref={ref} style={pos} onPointerDown={(e) => e.preventDefault()}>
      {children}
    </div>
  );
}

function countWords(text: string) {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}
