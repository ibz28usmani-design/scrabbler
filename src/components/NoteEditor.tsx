import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Placeholder } from '@tiptap/extension-placeholder';
import { useLiveQuery } from 'dexie-react-hooks';
import { editorExtensions } from './editorExtensions';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db, type Note } from '../db';
import { LecturePanel } from './LecturePanel';
import { AIToolsButton } from './AITools';
import { nav, toggleSidebar, openModal, useNav } from '../lib/nav';
import { Menu, useElementWidth, useMenu, confirmDialog } from './ui';
import { IAa, IBook, IChecklist, IChevL, ICompose, IImage, IMic, IMore, IPencil, IPin, IRuled, ISidebar, ITable, ITrash, ICards, IDownload, IFolder } from './Icons';
import { ExportDialog } from './ExportDialog';
import { FocusButton } from './FocusMode';
import { toast } from '../lib/events';
import { createNote } from '../lib/notes';

export { editorExtensions };

function summarize(editor: Editor) {
  const text = editor.getText({ blockSeparator: '\n' });
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const hasDrawing = editor.getJSON().content?.some((n) => n.type === 'drawing');
  return {
    title: (lines[0] ?? (hasDrawing ? 'Handwritten note' : '')).slice(0, 120),
    snippet: lines.slice(1, 3).join(' ').slice(0, 160) || (hasDrawing ? 'Drawing' : ''),
    text,
  };
}

async function downscaleImage(file: File, max = 1600): Promise<string> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.86);
}

export function NoteEditor({ note, narrow, wide }: { note: Note; narrow: boolean; wide: boolean }) {
  const saveTimer = useRef<number>(0);
  const noteId = note.id;
  const { notebookOpen, focus } = useNav();
  const [exporting, setExporting] = useState(false);
  const [words, setWords] = useState(() => countWords(note.text ?? ''));
  // Below this the row cannot hold every action without pushing some off-screen.
  const paneRef = useRef<HTMLDivElement>(null);
  // Shed the secondary actions first; only hide the primary ones when the pane
  // is genuinely too small, rather than emptying the row all at once.
  const paneW = useElementWidth(paneRef);
  const tight = paneW > 0 && paneW < 700;
  const tighter = paneW > 0 && paneW < 470;
  const imgInput = useRef<HTMLInputElement>(null);
  const [fmtAnchor, openFmt, closeFmt] = useMenu();
  const [moreAnchor, openMore, closeMore] = useMenu();
  const [moveAnchor, openMove, closeMove] = useMenu();
  const folders = useLiveQuery(() => db.folders.orderBy('order').toArray(), []) ?? [];

  const editor = useEditor(
    {
      extensions: [
        ...editorExtensions,
        Placeholder.configure({
          placeholder: ({ node, pos }) => (pos === 0 && node.type.name !== 'drawing' ? 'Title' : 'Start writing, or tap ✎ to draw with Apple Pencil…'),
          showOnlyCurrent: false,
        }),
      ],
      content: (note.content as any) ?? '',
      editorProps: { attributes: { class: 'prose', spellcheck: 'true', autocapitalize: 'sentences' } },
      onUpdate: ({ editor }) => {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          const s = summarize(editor);
          setWords(countWords(s.text));
          db.notes.update(noteId, { content: editor.getJSON(), ...s, updatedAt: Date.now() });
        }, 400);
      },
    },
    [noteId],
  );

  // Flush pending save when switching notes.
  useEffect(() => {
    return () => {
      if (saveTimer.current && editor && !editor.isDestroyed) {
        window.clearTimeout(saveTimer.current);
        const s = summarize(editor);
        db.notes.update(noteId, { content: editor.getJSON(), ...s, updatedAt: Date.now() });
      }
    };
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
          <button className="icon-btn" onClick={() => editor.chain().focus().insertDrawing({ paper: 'blank' }).run()} aria-label="Draw">
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
          <button
            className={`icon-btn ${note.lined ? 'on' : ''}`}
            onClick={() => db.notes.update(note.id, { lined: !note.lined })}
            aria-label="Ruled lines"
            aria-pressed={!!note.lined}
            title="Ruled lines"
          >
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

      <div className={`editor-scroll doc font-${note.font ?? 'serif'}${note.lined ? ' lined' : ''}`}>
        <div className="doc-page">
          <div className="editor-date">{new Date(note.updatedAt).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}</div>
          <EditorContent editor={editor} />
        </div>
      </div>
      <div className="doc-status" aria-live="polite">
        {words.toLocaleString()} {words === 1 ? 'word' : 'words'} · {Math.max(1, Math.round(words / 200))} min read
      </div>
      {exporting && <ExportDialog note={note} onClose={() => setExporting(false)} />}

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
            {fmt(note.lined ? 'Lines on' : 'Lines off', () => db.notes.update(note.id, { lined: !note.lined }), !!note.lined)}
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
                  { label: note.lined ? 'Hide ruled lines' : 'Show ruled lines', icon: <IRuled size={18} />, onClick: () => db.notes.update(note.id, { lined: !note.lined }) },
                  { divider: true, label: '' },
                ]
              : []),
            { label: note.pinned ? 'Unpin note' : 'Pin note', icon: <IPin size={18} />, onClick: () => db.notes.update(note.id, { pinned: !note.pinned }) },
            { label: 'Move to folder…', icon: <IFolder size={18} />, onClick: () => setTimeout(() => openMove(moreAnchor), 0) },
            { label: 'Make flashcards', icon: <ICards size={18} />, onClick: () => openModal({ type: 'generateDeck', from: { kind: 'note', noteId: note.id } }) },
            { label: 'Make a quiz', icon: <ICards size={18} />, onClick: () => openModal({ type: 'generateDeck', from: { kind: 'note', noteId: note.id }, quiz: true }) },
            { label: 'Save to device…', icon: <IDownload size={18} />, onClick: () => setExporting(true) },
            { divider: true, label: '' },
            { label: 'Delete note', icon: <ITrash size={18} />, danger: true, onClick: deleteNote },
          ]}
        />
      )}
      {moveAnchor && (
        <Menu
          anchor={moveAnchor}
          align="right"
          onClose={closeMove}
          items={folders.map((f) => ({
            label: `${f.emoji} ${f.name}`,
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
