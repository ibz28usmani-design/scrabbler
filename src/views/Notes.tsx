import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import Placeholder from '@tiptap/extension-placeholder';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Plus, Trash2, Pin, Search, Bold, Italic, Underline, Strikethrough, List, ListOrdered, ListTodo, AlignLeft, AlignCenter, AlignRight, Highlighter, Link, Image as ImageIcon, Table, Quote, Code, Minus, Undo2, Redo2, PenLine, Type, Printer, PanelLeft, FolderPlus, Globe, LayoutTemplate, RotateCcw, History, Mic, Sigma, Pause, Play, Square } from 'lucide-react';
import { db, newNote, uid, saveNote, snapshot, type Note, type Version } from '../lib/db';
import { EXT, setActiveEditor } from '../lib/editor';
import { useRev } from '../lib/cloud';
import { transcribe } from '../lib/ai';
import { startRecording, type RecorderHandle } from '../lib/record';
import { Ink, InkBar, defaultTool, type InkHandle } from '../lib/ink';
import { LAYOUTS, PAPERS, DOC_TEMPLATES, type Region } from '../lib/layouts';
import { IB, Field, Modal, guard, toast, noteText, strip, linksOf, tagsOf, nice, printNodes, fileToDataUrl } from '../lib/ui';

const PAGE_W = 820;

export default function Notes({ openId, open }: { openId?: string; open: (id?: string) => void }) {
  const notes = useLiveQuery(() => db.notes.orderBy('updated').reverse().toArray(), []) || [];
  const folders = useLiveQuery(() => db.folders.toArray(), []) || [];
  const [folder, setFolder] = useState('all');
  const [q, setQ] = useState('');
  const [side, setSide] = useState(window.innerWidth > 1000);
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState<'' | 'tpl' | 'clip' | 'rec'>(new URLSearchParams(location.search).has('clip') ? 'clip' : '');
  const live = notes.filter(n => !n.deleted);
  const shown = useMemo(() => {
    const base = folder === 'trash' ? notes.filter(n => n.deleted) : live.filter(n => folder === 'all' || n.folder === folder);
    const s = q.toLowerCase();
    return base.filter(n => !s || (n.title + ' ' + noteText(n)).toLowerCase().includes(s)).sort((a, b) => +!!b.pinned - +!!a.pinned);
  }, [notes, folder, q]);
  const note = notes.find(n => n.id === openId);
  const rev = useRev(openId);
  const [ver, setVer] = useState(0);

  const create = async (p: Partial<Note> = {}) => {
    const n = newNote({ folder: ['all', 'trash'].includes(folder) ? 'notes' : folder, ...p });
    await db.notes.add(n); open(n.id); setMenu(false); setModal('');
  };
  const addFolder = async () => { const name = prompt('Folder name'); if (name) await db.folders.add({ id: uid(), name, color: '#1f8a70' }); };
  const renameFolder = async (id: string, old: string) => { const name = prompt('Rename folder', old); if (name) await db.folders.update(id, { name }); };
  const removeFolder = async (id: string) => {
    if (!confirm('Delete this folder? Its notes move to Notes.')) return;
    await db.notes.where('folder').equals(id).modify({ folder: 'notes' }); await db.folders.delete(id); setFolder('all');
  };
  const count = (id: string) => live.filter(n => n.folder === id).length;

  return (
    <div className={'notes-view' + (side ? '' : ' no-side')}>
      {side && <>
        <aside className="folders scroller">
          <div className="label pad">Folders</div>
          <button className={'folder' + (folder === 'all' ? ' on' : '')} onClick={() => setFolder('all')}><span className="fdot" style={{ background: 'var(--ink)' }} />All notes<em>{live.length}</em></button>
          {folders.map(f => (
            <button key={f.id} className={'folder' + (folder === f.id ? ' on' : '')} onClick={() => setFolder(f.id)} onDoubleClick={() => renameFolder(f.id, f.name)}>
              <span className="fdot" style={{ background: f.color }} />{f.name}<em>{count(f.id)}</em>
            </button>
          ))}
          <button className={'folder' + (folder === 'trash' ? ' on' : '')} onClick={() => setFolder('trash')}><Trash2 size={13} />Recently deleted<em>{notes.length - live.length}</em></button>
          <div className="row pad">
            <button className="btn small" onClick={addFolder}><FolderPlus size={14} /> New folder</button>
            {!['all', 'trash', 'notes'].includes(folder) && <button className="btn small" onClick={() => removeFolder(folder)}>Delete</button>}
          </div>
        </aside>
        <section className="note-list">
          <div className="row pad">
            <div className="search"><Search size={15} /><input placeholder="Search notes" value={q} onChange={e => setQ(e.target.value)} /></div>
            <div className="menu-wrap">
              <button className="btn primary" onClick={() => setMenu(!menu)} aria-label="New note"><Plus size={16} /></button>
              {menu && <div className="menu" onMouseLeave={() => setMenu(false)}>
                <button onClick={() => create()}><Type size={15} /> Typed note</button>
                <button onClick={() => create({ paper: 'grid', draw: true })}><PenLine size={15} /> Handwritten page</button>
                <button onClick={() => { setModal('tpl'); setMenu(false); }}><LayoutTemplate size={15} /> From a template…</button>
                <button onClick={() => { setModal('clip'); setMenu(false); }}><Globe size={15} /> Clip a web page…</button>
                <button onClick={() => { setModal('rec'); setMenu(false); }}><Mic size={15} /> Record a lecture…</button>
              </div>}
            </div>
          </div>
          <div className="scroller grow">
            {shown.map(n => (
              <button key={n.id} className={'note-item' + (n.id === openId ? ' on' : '')} onClick={() => { open(n.id); if (window.innerWidth < 760) setSide(false); }}>
                <strong>{n.pinned && <Pin size={12} />} {n.title || 'Untitled'}</strong>
                <span>{nice(n.updated)} · {noteText(n).slice(0, 60) || (n.ink.length ? 'Handwritten' : 'No text yet')}</span>
                {n.layout !== 'free' && <span className="chip">{LAYOUTS[n.layout]?.name}</span>}
              </button>
            ))}
            {!shown.length && <p className="muted pad">No notes here yet. Press + to start one.</p>}
          </div>
        </section>
      </>}
      {note ? <NotePage key={`${note.id}:${rev}:${ver}`} reload={() => setVer(v => v + 1)} note={note} notes={live} folders={folders} open={open} side={side} setSide={setSide} />
        : <div className="empty"><button className="ib" onClick={() => setSide(!side)} aria-label="Toggle sidebar"><PanelLeft size={18} /></button><h2>Pick a note, or press + to start one.</h2></div>}
      {modal === 'tpl' && <TemplateModal onClose={() => setModal('')} create={create} />}
      {modal === 'clip' && <ClipModal onClose={() => setModal('')} create={create} />}
      {modal === 'rec' && <RecorderModal onClose={() => setModal('')} create={create} />}
    </div>
  );
}

/* ---------- one note: page, regions, handwriting ---------- */
function NotePage({ note, notes, folders, open, side, setSide, reload }: { reload: () => void; note: Note; notes: Note[]; folders: { id: string; name: string }[]; open: (id?: string) => void; side: boolean; setSide: (b: boolean) => void }) {
  const [ed, setEd] = useState<Editor | null>(null);
  const [draw, setDrawState] = useState(!!note.draw);
  const [tool, setTool] = useState(defaultTool);
  const ink = useRef<InkHandle>(null), page = useRef<HTMLDivElement>(null), wrap = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => { const el = wrap.current!; const ro = new ResizeObserver(() => setZoom(Math.min(1, (el.clientWidth - 28) / PAGE_W))); ro.observe(el); return () => ro.disconnect(); }, []);
  const L = LAYOUTS[note.layout] || LAYOUTS.free;
  const up = (p: Partial<Note>) => saveNote(note.id, p);
  const [hist, setHist] = useState(false);
  const [busy, setBusy] = useState(false);
  const lec = useLiveQuery(() => db.lectures.get(note.id), [note.id]);
  const lecUrl = useMemo(() => (lec ? URL.createObjectURL(lec.audio) : ''), [lec]);
  const runTranscribe = () => guard(async () => {
    setBusy(true);
    try { const html = await transcribe(lec!.audio); await saveNote(note.id, { layout: 'free', content: { ...note.content, body: html } }); reload(); } finally { setBusy(false); }
  });
  const setDraw = (d: boolean) => { setDrawState(d); db.notes.update(note.id, { draw: d }); };
  const changeLayout = (id: string) => {
    const nl = LAYOUTS[id], ids = nl.regions.map(r => r.id);
    const orphan = Object.entries(note.content).filter(([k, v]) => !ids.includes(k) && strip(v).trim()).map(([, v]) => v).join('');
    const main = nl.regions.reduce((a, b) => ((b.min || 0) > (a.min || 0) ? b : a)).id;
    const content = Object.fromEntries(ids.map(k => [k, note.content[k] || '']));
    if (orphan) content[main] += orphan;
    up({ layout: id, content });
  };
  const text = noteText(note), words = text.split(/\s+/).filter(Boolean).length;
  const out = [...new Set(linksOf(text))], tags = tagsOf(text);
  const back = note.title ? notes.filter(n => n.id !== note.id && linksOf(noteText(n)).some(l => l.toLowerCase() === note.title.toLowerCase())) : [];
  const follow = async (title: string) => {
    const hit = notes.find(n => n.title.toLowerCase() === title.toLowerCase());
    if (hit) return open(hit.id);
    const n = newNote({ title, folder: note.folder }); await db.notes.add(n); open(n.id);
  };

  return (
    <section className="note-pane">
      <div className="toolbar">
        <IB title="Toggle sidebar" on={side} onClick={() => setSide(!side)}><PanelLeft size={17} /></IB>
        <IB title={draw ? 'Switch to typing' : 'Switch to handwriting'} on={draw} onClick={() => setDraw(!draw)}>{draw ? <PenLine size={17} /> : <Type size={17} />}</IB>
        <select className="select" aria-label="Layout" value={note.layout} onChange={e => changeLayout(e.target.value)}>
          {Object.entries(LAYOUTS).map(([k, l]) => <option key={k} value={k}>{l.name}</option>)}
        </select>
        <select className="select" aria-label="Paper" value={note.paper} onChange={e => up({ paper: e.target.value })}>
          {Object.entries(PAPERS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
        <span className="sep" />
        {draw ? <InkBar tool={tool} setTool={setTool} ink={ink} /> : <TextBar ed={ed} />}
        <span className="grow" />
        <select className="select" aria-label="Folder" value={note.folder} onChange={e => up({ folder: e.target.value })}>
          {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <IB title="Pin" on={note.pinned} onClick={() => up({ pinned: !note.pinned })}><Pin size={17} /></IB>
        <IB title="Version history" onClick={() => setHist(true)}><History size={17} /></IB>
        <IB title="Print or save as PDF" onClick={() => page.current && printNodes([page.current], 'size:A4;margin:10mm', 'print-note')}><Printer size={17} /></IB>
        {note.deleted
          ? <><IB title="Restore" onClick={() => db.notes.update(note.id, { deleted: undefined })}><RotateCcw size={17} /></IB><IB title="Delete forever" onClick={() => { if (confirm('Delete this note forever?')) { db.notes.delete(note.id); open(); } }}><Trash2 size={17} /></IB></>
          : <IB title="Delete" onClick={() => { db.notes.update(note.id, { deleted: Date.now() }); open(); }}><Trash2 size={17} /></IB>}
      </div>
      {lec && <div className="lecture-bar"><Mic size={16} /><audio controls src={lecUrl} /><button className="btn small primary" disabled={busy} onClick={runTranscribe}>{busy ? 'Transcribing… this can take a minute' : 'Transcribe into notes'}</button></div>}
      {hist && <HistoryModal note={note} onClose={() => setHist(false)} reload={reload} />}
      <div ref={wrap} className="scroller grow page-wrap">
        <div ref={page} className={`page paper-${note.paper}` + (draw ? ' drawing' : '')} style={{ width: PAGE_W, minHeight: note.h, zoom }}
          onPointerDownCapture={e => { if (e.pointerType === 'pen' && !draw) setDraw(true); }}>
          <div className="page-head">
            <Field className="title" placeholder="Title" aria-label="Title" value={note.title} onChange={v => up({ title: v })} />
            <span className="label">{nice(note.created)}</span>
          </div>
          <div key={note.layout} className={'regions layout-' + note.layout} style={{ gridTemplateAreas: L.areas, gridTemplateColumns: L.cols }}>
            {L.regions.map(r => <RegionEd key={r.id} note={note} r={r} onFocus={setEd} />)}
          </div>
          <Ink ref={ink} strokes={note.ink} onChange={s => up({ ink: s })} w={PAGE_W} active={draw} tool={tool} onExtend={() => up({ h: Math.max(note.h, page.current?.offsetHeight || 0) + 600 })} />
        </div>
        <footer className="note-foot" style={{ width: PAGE_W * zoom }}>
          <span className="label">{words} words{note.url && <> · <a href={note.url} target="_blank" rel="noreferrer">Source page</a></>}</span>
          {tags.map(t => <span key={t} className="chip">#{t}</span>)}
          {!!out.length && <div><span className="label">Links </span>{out.map(t => <button key={t} className="chip link" onClick={() => follow(t)}>{t}</button>)}</div>}
          {!!back.length && <div><span className="label">Linked from </span>{back.map(n => <button key={n.id} className="chip link" onClick={() => open(n.id)}>{n.title}</button>)}</div>}
        </footer>
      </div>
    </section>
  );
}

function RegionEd({ note, r, onFocus }: { note: Note; r: Region; onFocus: (e: Editor) => void }) {
  const t = useRef<ReturnType<typeof setTimeout>>(undefined), pending = useRef<string | null>(null);
  const flush = () => { if (pending.current !== null) { saveNote(note.id, { ['content.' + r.id]: pending.current }); pending.current = null; } };
  const editor = useEditor({
    extensions: [...EXT, Placeholder.configure({ placeholder: r.hint || (r.id === 'body' ? 'Start writing, or pick up the Pencil…' : '') })],
    content: note.content[r.id] || '',
    onFocus: ({ editor }) => { setActiveEditor(editor); onFocus(editor); },
    onUpdate: ({ editor }) => { pending.current = editor.getHTML(); clearTimeout(t.current); t.current = setTimeout(flush, 400); },
  });
  useEffect(() => () => { clearTimeout(t.current); flush(); }, []);
  return (
    <section className="region" style={{ gridArea: r.id, minHeight: r.min }}>
      {r.label && <div className="region-label">{r.label}</div>}
      <EditorContent editor={editor} />
    </section>
  );
}

function TextBar({ ed }: { ed: Editor | null }) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!ed) return; ed.on('transaction', force); return () => { ed.off('transaction', force); }; }, [ed]);
  if (!ed || ed.isDestroyed) return <span className="muted small">Tap the page to start typing</span>;
  const c = () => ed.chain().focus();
  const style = ed.isActive('heading', { level: 1 }) ? '1' : ed.isActive('heading', { level: 2 }) ? '2' : ed.isActive('heading', { level: 3 }) ? '3' : '0';
  const B = (title: string, on: boolean, run: () => void, icon: React.ReactNode) => <IB title={title} on={on} onClick={run}>{icon}</IB>;
  return (
    <div className="row bar-group">
      <select className="select" aria-label="Text style" value={style} onChange={e => (e.target.value === '0' ? c().setParagraph().run() : c().setHeading({ level: +e.target.value as 1 | 2 | 3 }).run())}>
        <option value="0">Normal text</option><option value="1">Title</option><option value="2">Heading</option><option value="3">Subheading</option>
      </select>
      <select className="select" aria-label="Font" value={ed.getAttributes('textStyle').fontFamily || ''} onChange={e => (e.target.value ? c().setFontFamily(e.target.value).run() : c().unsetFontFamily().run())}>
        <option value="">Default font</option><option value="Times New Roman, serif">Times</option><option value="Helvetica Neue, Arial, sans-serif">Helvetica</option><option value="Georgia, serif">Georgia</option><option value="ui-monospace, Menlo, monospace">Mono</option><option value="Oswald, sans-serif">Oswald</option>
      </select>
      <select className="select" aria-label="Font size" value={ed.getAttributes('textStyle').fontSize || ''} onChange={e => (e.target.value ? c().setFontSize(e.target.value).run() : c().unsetFontSize().run())}>
        <option value="">Size</option>{[11, 12, 14, 18, 24, 32, 48].map(s => <option key={s} value={s + 'px'}>{s}</option>)}
      </select>
      {B('Bold', ed.isActive('bold'), () => c().toggleBold().run(), <Bold size={16} />)}
      {B('Italic', ed.isActive('italic'), () => c().toggleItalic().run(), <Italic size={16} />)}
      {B('Underline', ed.isActive('underline'), () => c().toggleUnderline().run(), <Underline size={16} />)}
      {B('Strikethrough', ed.isActive('strike'), () => c().toggleStrike().run(), <Strikethrough size={16} />)}
      {B('Highlight', ed.isActive('highlight'), () => c().toggleHighlight({ color: '#f6d33c' }).run(), <Highlighter size={16} />)}
      <input type="color" className="color" aria-label="Text colour" value={ed.getAttributes('textStyle').color || '#d64933'} onChange={e => c().setColor(e.target.value).run()} />
      <span className="sep" />
      {B('Align left', ed.isActive({ textAlign: 'left' }), () => c().setTextAlign('left').run(), <AlignLeft size={16} />)}
      {B('Centre', ed.isActive({ textAlign: 'center' }), () => c().setTextAlign('center').run(), <AlignCenter size={16} />)}
      {B('Align right', ed.isActive({ textAlign: 'right' }), () => c().setTextAlign('right').run(), <AlignRight size={16} />)}
      {B('Bulleted list', ed.isActive('bulletList'), () => c().toggleBulletList().run(), <List size={16} />)}
      {B('Numbered list', ed.isActive('orderedList'), () => c().toggleOrderedList().run(), <ListOrdered size={16} />)}
      {B('Checklist', ed.isActive('taskList'), () => c().toggleTaskList().run(), <ListTodo size={16} />)}
      {B('Quote', ed.isActive('blockquote'), () => c().toggleBlockquote().run(), <Quote size={16} />)}
      {B('Code block', ed.isActive('codeBlock'), () => c().toggleCodeBlock().run(), <Code size={16} />)}
      {B('Divider', false, () => c().setHorizontalRule().run(), <Minus size={16} />)}
      {B('Link', ed.isActive('link'), () => { const href = prompt('Link address', ed.getAttributes('link').href || 'https://'); if (href === null) return; href ? c().extendMarkRange('link').setLink({ href }).run() : c().unsetLink().run(); }, <Link size={16} />)}
      {B('Picture', false, () => file.current?.click(), <ImageIcon size={16} />)}
      {B('Equation (LaTeX). You can also type $$x^2$$', false, () => { const latex = prompt('Equation in LaTeX, e.g. \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}'); if (latex) c().insertInlineMath({ latex }).run(); }, <Sigma size={16} />)}
      {B('Table', ed.isActive('table'), () => (ed.isActive('table') ? c().addRowAfter().run() : c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()), <Table size={16} />)}
      {B('Undo', false, () => c().undo().run(), <Undo2 size={16} />)}
      {B('Redo', false, () => c().redo().run(), <Redo2 size={16} />)}
      <input ref={file} type="file" accept="image/*" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) c().setImage({ src: await fileToDataUrl(f) }).run(); e.target.value = ''; }} />
    </div>
  );
}

/* ---------- templates and web clipper ---------- */
function TemplateModal({ onClose, create }: { onClose: () => void; create: (p: Partial<Note>) => void }) {
  const subjects = [...new Set(Object.values(LAYOUTS).map(l => l.subject))];
  return (
    <Modal title="Start from a template" onClose={onClose} wide>
      <div className="label">Documents</div>
      <div className="tpl-grid">
        {DOC_TEMPLATES.map(t => (
          <button key={t.name} className="tpl" onClick={() => create({ title: t.title, content: { body: t.html } })}>
            <div className="tpl-doc" dangerouslySetInnerHTML={{ __html: t.html }} /><strong>{t.name}</strong><span>{t.about}</span>
          </button>
        ))}
      </div>
      {subjects.map(s => <div key={s}>
        <div className="label">{s} note-taking methods</div>
        <div className="tpl-grid">
          {Object.entries(LAYOUTS).filter(([, l]) => l.subject === s).map(([k, l]) => (
            <div key={k} className="tpl">
              <div className="tpl-lay" style={{ gridTemplateAreas: l.areas, gridTemplateColumns: l.cols }}>{l.regions.map(r => <i key={r.id} style={{ gridArea: r.id }}>{r.label.split(/[·:(]/)[0]}</i>)}</div>
              <strong>{l.name}</strong><span>{l.about}</span>
              <div className="row"><button className="btn small" onClick={() => create({ layout: k })}>Typed</button><button className="btn small" onClick={() => create({ layout: k, paper: 'grid', draw: true })}>Handwritten</button></div>
            </div>
          ))}
        </div>
      </div>)}
    </Modal>
  );
}

function ClipModal({ onClose, create }: { onClose: () => void; create: (p: Partial<Note>) => void }) {
  const qs = new URLSearchParams(location.search);
  const [url, setUrl] = useState(qs.get('clip') || '');
  const [busy, setBusy] = useState(false);
  const sel = qs.get('s') || '';
  const done = (p: Partial<Note>) => { history.replaceState(null, '', location.pathname); create({ folder: 'clippings', ...p }); toast('Clipped to Clippings'); };
  const clip = () => guard(async () => {
    if (!/^https?:\/\//.test(url)) throw new Error('Enter a full address starting with https://');
    if (sel) return done({ title: qs.get('t') || url, url, content: { body: `<blockquote><p>${DOMPurify.sanitize(sel, { ALLOWED_TAGS: [] })}</p></blockquote><p><a href="${encodeURI(url)}">${qs.get('t') || url}</a></p>` } });
    setBusy(true);
    try {
      const r = await fetch('https://r.jina.ai/' + url, { headers: { Accept: 'text/plain' } });
      if (!r.ok) throw new Error(`Could not read that page (error ${r.status}).`);
      const raw = await r.text(), title = raw.match(/^Title: (.*)$/m)?.[1] || url;
      const md = raw.includes('Markdown Content:') ? raw.split('Markdown Content:')[1] : raw;
      done({ title, url, content: { body: DOMPurify.sanitize(await marked.parse(md)) } });
    } finally { setBusy(false); }
  });
  const bookmarklet = `javascript:location.href='${location.origin + location.pathname}?clip='+encodeURIComponent(location.href)+'&t='+encodeURIComponent(document.title)+'&s='+encodeURIComponent(getSelection())`;
  return (
    <Modal title="Clip a web page" onClose={onClose}>
      <p className="muted">Saves the article text as a note in Clippings, with a link back to the page.{sel && ' Your selected text will be saved as a quote.'}</p>
      <div className="row"><input className="input grow" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && clip()} autoFocus />
        <button className="btn primary" disabled={busy} onClick={clip}>{busy ? 'Clipping…' : 'Clip'}</button></div>
      <p className="muted small">Pages are read through the free r.jina.ai reader, which sees the address you clip. To clip from any site in one tap, save this as a bookmark: <a href={bookmarklet} onClick={e => e.preventDefault()}>Clip to Scrabbler</a> (drag it to your bookmarks bar, or copy its address into a new bookmark on iPad).</p>
    </Modal>
  );
}

/* ---------- version history and lecture recording ---------- */
function HistoryModal({ note, onClose, reload }: { note: Note; onClose: () => void; reload: () => void }) {
  const list = useLiveQuery(() => db.versions.where('note').equals(note.id).reverse().sortBy('at'), [note.id]) || [];
  const restore = async (v: Version) => {
    await snapshot(note.id, true);
    await db.notes.update(note.id, { title: v.title, layout: v.layout, content: v.content, ink: v.ink, updated: Date.now() });
    toast('Restored. The version you replaced is in the history too.'); reload();
  };
  return (
    <Modal title="Version history" onClose={onClose}>
      <p className="muted small">A version is kept before each burst of editing (at most one every ten minutes, thirty per note).</p>
      {list.map(v => { const text = Object.values(v.content).map(strip).join(' ').trim(); return (
        <div key={v.id} className="row version">
          <div className="grow"><strong>{new Date(v.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</strong>
            <div className="muted small">{text.split(/\s+/).filter(Boolean).length} words{v.ink.length ? ` · ${v.ink.length} pen strokes` : ''} · {text.slice(0, 70)}</div></div>
          <button className="btn small" onClick={() => restore(v)}>Restore</button>
        </div>); })}
      {!list.length && <p className="muted">No earlier versions yet. They appear as you edit.</p>}
    </Modal>
  );
}

function RecorderModal({ onClose, create }: { onClose: () => void; create: (p: Partial<Note>) => void }) {
  const [rec, setRec] = useState<RecorderHandle | null>(null);
  const [tick, setTick] = useState({ secs: 0, level: 0 });
  const [paused, setPaused] = useState(false);
  const level = useRef(0), file = useRef<HTMLInputElement>(null), live = useRef<RecorderHandle | null>(null);
  useEffect(() => { if (!rec) return; const t = setInterval(() => setTick({ secs: rec.elapsed, level: level.current }), 150); return () => clearInterval(t); }, [rec]);
  useEffect(() => () => { live.current?.stop().catch(() => {}); }, []);
  const save = async (audio: Blob, secs: number) => {
    const id = uid();
    await db.lectures.add({ id, audio, secs });
    create({ id, title: `Lecture · ${new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`, content: { body: '<p><em>Recording saved. Press “Transcribe into notes” above to turn it into study notes and a transcript.</em></p>' } });
  };
  const start = () => guard(async () => { const r = await startRecording(l => { level.current = l; }); live.current = r; setRec(r); });
  const stop = () => guard(async () => { const r = live.current!; live.current = null; const secs = r.elapsed; await save(await r.stop(), secs); });
  const mm = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <Modal title="Record a lecture" onClose={onClose}>
      {rec ? <>
        <div className="rec-time">{mm(tick.secs)}</div>
        <div className="bar"><i style={{ width: `${Math.round(tick.level * 100)}%` }} /></div>
        <div className="row"><button className="btn" onClick={() => { paused ? rec.resume() : rec.pause(); setPaused(!paused); }}>{paused ? <><Play size={15} /> Resume</> : <><Pause size={15} /> Pause</>}</button>
          <span className="grow" /><button className="btn primary" onClick={stop}><Square size={15} /> Stop and save</button></div>
        <p className="muted small">Keep Scrabbler open and on screen while recording. The recording stays on this device.</p>
      </> : <>
        <p className="muted">Records the lesson as a compact MP3 (about 14 MB an hour), saves it with a new note, then Gemini turns it into study notes and a transcript.</p>
        <div className="row"><button className="btn primary" onClick={start}><Mic size={15} /> Start recording</button><button className="btn" onClick={() => file.current?.click()}>Use an audio file…</button></div>
        <input ref={file} type="file" accept="audio/*,video/mp4" hidden onChange={e => { const f = e.target.files?.[0]; if (f) save(f, 0); }} />
      </>}
    </Modal>
  );
}
