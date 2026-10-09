import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { db, deleteSource, uid, type Chunk, type ChatMessage, type Citation, type Source, type StudioItem } from '../db';
import { nav, openModal, useNav, type NotebookTab } from '../lib/nav';
import { addDiscover, addFile, addText, addUrl, retrySource } from '../lib/sources';
import { answerQuestion, notebookOverview } from '../lib/ai';
import { generate, hasKey } from '../lib/gemini';
import { hasTextKey } from '../lib/llm';
import { openGenerateFromText } from '../lib/studyActions';
import { mdToEditorHtml, mdToHtml } from '../lib/markdown';
import { createNote } from '../lib/notes';
import { toast, toastError } from '../lib/events';
import { runStudio } from '../lib/studio';
import { Empty, Menu, Modal, Segmented, Spinner, confirmDialog, promptDialog } from './ui';
import { StudioViewer } from './StudioViewer';
import {
  IBook, ISearch, ICards, IClock, ICopy, IDoc, IFile, IGrad, IHeadphones, IImage, ILink, IMic, IMind, IMore, IPlus, IQuestion, IRefresh, ISend, ISparkle, IStop, IText, ITrash, IUpload, IX, IYouTube,
} from './Icons';

export function NotebookPanel({ folderId, overlay }: { folderId: string; overlay: boolean }) {
  const { notebookTab } = useNav();
  const folder = useLiveQuery(() => db.folders.get(folderId), [folderId]);
  const sourceCount = useLiveQuery(() => db.sources.where('folderId').equals(folderId).count(), [folderId]) ?? 0;
  return (
    <aside className={`notebook ${overlay ? 'overlay' : ''}`}>
      <div className="nb-head">
        <IBook size={18} />
        <div className="nb-title">
          {folder?.emoji} {folder?.name} <span className="muted">· Notebook</span>
        </div>
        <span className="spacer" />
        <button className="icon-btn" onClick={() => nav({ notebookOpen: false, focusPanel: null })} aria-label="Close notebook">
          <IX />
        </button>
      </div>
      <div className="nb-tabs">
        <Segmented<NotebookTab>
          value={notebookTab}
          onChange={(v) => nav({ notebookTab: v })}
          options={[
            { value: 'sources', label: `Sources${sourceCount ? ` (${sourceCount})` : ''}` },
            { value: 'chat', label: 'Chat' },
            { value: 'studio', label: 'Studio' },
          ]}
        />
      </div>
      {notebookTab === 'sources' && <SourcesTab folderId={folderId} />}
      {notebookTab === 'chat' && <ChatTab folderId={folderId} />}
      {notebookTab === 'studio' && <StudioTab folderId={folderId} />}
    </aside>
  );
}

// ---------------------------------------------------------------- sources

const KIND_ICON: Record<Source['kind'], ReactElement> = {
  pdf: <IFile size={18} />,
  text: <IText size={18} />,
  url: <ILink size={18} />,
  youtube: <IYouTube size={18} />,
  audio: <IMic size={18} />,
  image: <IImage size={18} />,
};

function SourcesTab({ folderId }: { folderId: string }) {
  const sources = useLiveQuery(() => db.sources.where('folderId').equals(folderId).reverse().sortBy('createdAt'), [folderId]) ?? [];
  const folder = useLiveQuery(() => db.folders.get(folderId), [folderId]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<null | 'link' | 'text' | 'discover'>(null);
  const [topic, setTopic] = useState('');
  const [link, setLink] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [paste, setPaste] = useState('');
  const [drag, setDrag] = useState(false);
  const [menu, setMenu] = useState<{ s: Source; el: HTMLElement } | null>(null);

  const onFiles = (files: FileList | File[]) => {
    for (const f of Array.from(files)) addFile(folderId, f);
  };

  return (
    <div
      className={`nb-body ${drag ? 'drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      }}
    >
      <div className="add-sources">
        <button className="add-src" onClick={() => fileInput.current?.click()}>
          <IUpload /> <span>Upload</span>
          <small>PDF · audio · image · text</small>
        </button>
        <button className="add-src" onClick={() => setMode(mode === 'link' ? null : 'link')}>
          <ILink /> <span>Link</span>
          <small>Website · YouTube</small>
        </button>
        <button className="add-src" onClick={() => setMode(mode === 'text' ? null : 'text')}>
          <IText /> <span>Paste text</span>
          <small>Copied text</small>
        </button>
        <button className="add-src" onClick={() => setMode(mode === 'discover' ? null : 'discover')}>
          <ISearch /> <span>Discover</span>
          <small>Research the web</small>
        </button>
      </div>
      {mode === 'discover' && (
        <form
          className="add-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!topic.trim()) return;
            if (!hasKey()) return toast('Web research needs a Gemini key — add one in Settings.', 'error');
            addDiscover(folderId, topic.trim());
            setTopic('');
            setMode(null);
          }}
        >
          <input className="input" autoFocus placeholder="What do you want to learn about?" value={topic} onChange={(e) => setTopic(e.target.value)} />
          <button className="btn primary" type="submit">
            Search
          </button>
        </form>
      )}
      <input ref={fileInput} type="file" multiple hidden accept=".pdf,.txt,.md,.csv,.json,.html,audio/*,video/*,image/*" onChange={(e) => e.target.files && (onFiles(e.target.files), (e.target.value = ''))} />
      {mode === 'link' && (
        <form
          className="add-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              new URL(link.trim());
            } catch {
              return toast('That doesn’t look like a valid link.', 'error');
            }
            addUrl(folderId, link);
            setLink('');
            setMode(null);
          }}
        >
          <input className="input" autoFocus placeholder="https://… or a YouTube link" value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" />
          <button className="btn primary" type="submit">
            Add
          </button>
        </form>
      )}
      {mode === 'text' && (
        <form
          className="add-form col"
          onSubmit={(e) => {
            e.preventDefault();
            if (!paste.trim()) return;
            addText(folderId, pasteTitle.trim(), paste);
            setPaste('');
            setPasteTitle('');
            setMode(null);
          }}
        >
          <input className="input" placeholder="Title (optional)" value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} />
          <textarea className="input" rows={6} autoFocus placeholder="Paste text here…" value={paste} onChange={(e) => setPaste(e.target.value)} />
          <button className="btn primary" type="submit">
            Add source
          </button>
        </form>
      )}
      <label className="check nb-notes-toggle">
        <input type="checkbox" checked={!!folder?.notesAsSources} onChange={(e) => db.folders.update(folderId, { notesAsSources: e.target.checked })} />
        Include this folder’s notes as sources
      </label>
      {sources.length === 0 ? (
        <Empty icon={<IBook size={30} />} title="Add sources to this notebook">
          Chat answers and Studio outputs are grounded in your sources, with citations you can tap to verify.
        </Empty>
      ) : (
        <ul className="source-list">
          {sources.map((s) => (
            <li key={s.id} className={`source ${s.status}`}>
              <input type="checkbox" checked={s.enabled} onChange={(e) => db.sources.update(s.id, { enabled: e.target.checked })} aria-label="Use this source" disabled={s.status !== 'ready'} />
              <span className="source-icon">{KIND_ICON[s.kind]}</span>
              <button className="source-main" onClick={() => s.status === 'ready' && openModal({ type: 'source', sourceId: s.id })}>
                <span className="source-title">{s.title}</span>
                <span className="source-sub">
                  {s.status === 'processing' && (
                    <>
                      <Spinner size={11} /> Processing…
                    </>
                  )}
                  {s.status === 'error' && <span className="err">{s.error}</span>}
                  {s.status === 'ready' && `${Math.round(s.text.length / 5.5).toLocaleString()} words`}
                </span>
              </button>
              {s.status === 'error' && (
                <button className="icon-btn small" onClick={() => retrySource(s)} aria-label="Retry">
                  <IRefresh size={16} />
                </button>
              )}
              <button className="icon-btn small" onClick={(e) => setMenu({ s, el: e.currentTarget })} aria-label="Source options">
                <IMore size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {menu && (
        <Menu
          anchor={menu.el}
          align="right"
          onClose={() => setMenu(null)}
          items={[
            { label: 'Open', disabled: menu.s.status !== 'ready', onClick: () => openModal({ type: 'source', sourceId: menu.s.id }) },
            {
              label: 'Rename…',
              onClick: async () => {
                const t = await promptDialog('Rename source', menu.s.title);
                if (t) db.sources.update(menu.s.id, { title: t });
              },
            },
            { label: 'Make flashcards', disabled: menu.s.status !== 'ready', onClick: () => makeDeckFromSource(menu.s) },
            { divider: true, label: '' },
            {
              label: 'Remove source',
              danger: true,
              onClick: async () => {
                if (await confirmDialog(`Remove “${menu.s.title}” from this notebook?`, 'Remove')) deleteSource(menu.s.id);
              },
            },
          ]}
        />
      )}
    </div>
  );
}

function makeDeckFromSource(s: Source) {
  openGenerateFromText(s.title, s.text);
}

export function SourceViewer({ sourceId, chunkId, onClose }: { sourceId: string; chunkId?: string; onClose: () => void }) {
  const isNote = sourceId.startsWith('note:');
  const source = useLiveQuery(() => (isNote ? undefined : db.sources.get(sourceId)), [sourceId]);
  const note = useLiveQuery(() => (isNote ? db.notes.get(sourceId.split(':')[1]) : undefined), [sourceId]);
  const chunks = useLiveQuery<Chunk[]>(() => (isNote ? Promise.resolve([]) : db.chunks.where('sourceId').equals(sourceId).sortBy('idx')), [sourceId]) ?? [];
  const blob = useLiveQuery(() => (source?.blobId ? db.blobs.get(source.blobId) : undefined), [source?.blobId]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [summary, setSummary] = useState<string | null>(source?.summary ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!chunkId) return;
    const t = setTimeout(() => bodyRef.current?.querySelector('.chunk.hit')?.scrollIntoView({ block: 'center' }), 60);
    return () => clearTimeout(t);
  }, [chunkId, chunks.length]);

  useEffect(() => setSummary(source?.summary ?? null), [source?.summary]);

  if (isNote) {
    return (
      <Modal title={note?.title || 'Note'} onClose={onClose} wide>
        <div className="source-text">
          <p className="muted">This passage comes from one of your notes.</p>
          <div className="chunk hit">{note?.text}</div>
          <button
            className="btn"
            onClick={() => {
              onClose();
              if (note) nav({ folderId: note.folderId, noteId: note.id, pane: 'editor' });
            }}
          >
            Open note
          </button>
        </div>
      </Modal>
    );
  }

  const guide = async () => {
    if (!source) return;
    setBusy(true);
    try {
      const md = await generate({ prompt: `Write a source guide for this document: a 3–4 sentence summary, then "**Key topics:**" as a comma-separated list.\n\n${source.text.slice(0, 300_000)}`, temperature: 0.3 });
      await db.sources.update(source.id, { summary: md });
      setSummary(md);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={source?.title ?? 'Source'} onClose={onClose} wide>
      <div className="source-actions">
        {source?.url && (
          <a className="btn small" href={source.url} target="_blank" rel="noreferrer">
            <ILink size={15} /> Open link
          </a>
        )}
        {blob && (
          <a className="btn small" href={URL.createObjectURL(blob.blob)} target="_blank" rel="noreferrer">
            <IFile size={15} /> Open original
          </a>
        )}
        {!summary && hasTextKey() && (
          <button className="btn small" onClick={guide} disabled={busy}>
            {busy ? <Spinner size={13} /> : <ISparkle size={15} />} Source guide
          </button>
        )}
      </div>
      {summary && <div className="source-summary prose md" dangerouslySetInnerHTML={{ __html: mdToHtml(summary) }} />}
      <div className="source-text" ref={bodyRef}>
        {chunks.map((c) => (
          <div key={c.id} className={`chunk ${c.id === chunkId ? 'hit' : ''}`}>
            {c.page && (c.idx === 0 || chunks[c.idx - 1]?.page !== c.page) && <div className="page-marker">Page {c.page}</div>}
            {c.text}
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- chat

function withCitations(html: string, citations: Citation[]): string {
  const known = new Set(citations.map((c) => c.n));
  return html.replace(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, (m, inner: string) => {
    const nums = inner.split(/\s*,\s*/).flatMap((p) => {
      const r = p.split(/[–-]/).map((x) => parseInt(x, 10));
      if (r.length === 2 && r[1] >= r[0] && r[1] - r[0] < 20) return Array.from({ length: r[1] - r[0] + 1 }, (_, i) => r[0] + i);
      return [r[0]];
    });
    if (!nums.some((n) => known.has(n))) return m;
    return nums.map((n) => (known.has(n) ? `<button class="cite" data-n="${n}">${n}</button>` : '')).join('');
  });
}

function ChatTab({ folderId }: { folderId: string }) {
  const messages = useLiveQuery(() => db.chats.where('folderId').equals(folderId).sortBy('createdAt'), [folderId]) ?? [];
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState<string | null>(null);
  const [overview, setOverview] = useState<{ summary: string; questions: string[] } | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [peek, setPeek] = useState<{ c: Citation; el: HTMLElement } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sourceCount = useLiveQuery(() => db.sources.where('folderId').equals(folderId).count(), [folderId]) ?? 0;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, streaming]);

  const send = async (q: string) => {
    q = q.trim();
    if (!q || streaming !== null) return;
    if (!hasTextKey()) {
      toast('Add an AI key in Settings to chat.', 'error');
      openModal({ type: 'settings' });
      return;
    }
    setInput('');
    const history = messages;
    await db.chats.add({ id: uid(), folderId, role: 'user', text: q, createdAt: Date.now() });
    setStreaming('');
    abort.current = new AbortController();
    try {
      const res = await answerQuestion(folderId, q, history, (t) => setStreaming(t), abort.current.signal);
      await db.chats.add({ id: uid(), folderId, role: 'model', text: res.text, citations: res.citations, createdAt: Date.now() });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        toastError(e);
        await db.chats.add({ id: uid(), folderId, role: 'model', text: `⚠️ ${(e as Error).message}`, createdAt: Date.now(), error: true });
      }
    } finally {
      setStreaming(null);
    }
  };

  const loadOverview = async () => {
    setLoadingOverview(true);
    try {
      setOverview(await notebookOverview(folderId));
    } catch (e) {
      toastError(e);
    } finally {
      setLoadingOverview(false);
    }
  };

  const onBubbleClick = (e: React.MouseEvent, m: ChatMessage) => {
    const btn = (e.target as HTMLElement).closest('.cite') as HTMLElement | null;
    if (!btn) return;
    const c = m.citations?.find((x) => x.n === Number(btn.dataset.n));
    if (c) setPeek({ c, el: btn });
  };

  return (
    <div className="nb-body chat">
      <div className="chat-scroll" ref={scroller}>
        {messages.length === 0 && streaming === null && (
          <div className="chat-empty">
            <div className="chat-empty-icon">
              <ISparkle size={28} />
            </div>
            <h3>Ask your notebook anything</h3>
            <p className="muted">
              {sourceCount ? `Answers are grounded in your ${sourceCount} source${sourceCount === 1 ? '' : 's'} with tappable citations.` : 'Add sources for grounded answers — or ask anything.'}
            </p>
            {overview ? (
              <div className="overview">
                <div className="prose md" dangerouslySetInnerHTML={{ __html: mdToHtml(overview.summary) }} />
                <div className="suggestions">
                  {overview.questions.map((q) => (
                    <button key={q} className="suggestion" onClick={() => send(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              sourceCount > 0 && (
                <button className="btn" onClick={loadOverview} disabled={loadingOverview}>
                  {loadingOverview ? <Spinner size={14} /> : <ISparkle size={16} />} Notebook guide & suggested questions
                </button>
              )
            )}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role} ${m.error ? 'error' : ''}`}>
            {m.role === 'user' ? (
              <div className="bubble">{m.text}</div>
            ) : (
              <>
                <div className="bubble prose md" onClick={(e) => onBubbleClick(e, m)} dangerouslySetInnerHTML={{ __html: withCitations(mdToHtml(m.text), m.citations ?? []) }} />
                {!m.error && (
                  <div className="msg-actions">
                    <button
                      className="icon-btn small"
                      title="Copy"
                      onClick={() => {
                        navigator.clipboard.writeText(m.text);
                        toast('Copied', 'success');
                      }}
                    >
                      <ICopy size={15} />
                    </button>
                    <button
                      className="chip"
                      onClick={async () => {
                        const q = messages[messages.indexOf(m) - 1]?.text ?? 'Saved response';
                        await createNote(folderId, { title: q.slice(0, 80), content: `<h1>${q.replace(/</g, '&lt;').slice(0, 120)}</h1>${mdToEditorHtml(m.text.replace(/\[\d+(?:,\s*\d+)*\]/g, ''))}`, snippet: m.text.slice(0, 140) });
                        toast('Saved to a new note', 'success');
                      }}
                    >
                      Save to note
                    </button>
                    {!!m.citations?.length && <span className="muted small">{new Set(m.citations.map((c) => c.sourceId)).size} sources cited</span>}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {streaming !== null && (
          <div className="msg model">
            <div className="bubble prose md">{streaming ? <div dangerouslySetInnerHTML={{ __html: mdToHtml(streaming) }} /> : <span className="typing"><i /><i /><i /></span>}</div>
          </div>
        )}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          className="input"
          rows={1}
          placeholder="Ask about your sources…"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px';
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        {streaming !== null ? (
          <button type="button" className="send stop" onClick={() => abort.current?.abort()} aria-label="Stop">
            <IStop size={16} />
          </button>
        ) : (
          <button type="submit" className="send" disabled={!input.trim()} aria-label="Send">
            <ISend size={18} />
          </button>
        )}
      </form>
      {messages.length > 0 && (
        <button
          className="clear-chat"
          onClick={async () => {
            if (await confirmDialog('Clear this notebook’s chat history?', 'Clear')) db.chats.where('folderId').equals(folderId).delete();
          }}
        >
          Clear chat
        </button>
      )}
      {peek && <CitationPeek c={peek.c} anchor={peek.el} onClose={() => setPeek(null)} />}
    </div>
  );
}

function CitationPeek({ c, anchor, onClose }: { c: Citation; anchor: HTMLElement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: -999, left: -999 });
  useEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 16);
    const h = ref.current?.offsetHeight ?? 200;
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    setPos({ top, left: Math.max(8, Math.min(r.left - w / 2, window.innerWidth - w - 8)) });
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [anchor, onClose]);
  return (
    <div className="cite-peek" ref={ref} style={pos}>
      <div className="cite-peek-head">
        <span className="cite static">{c.n}</span> <strong>{c.title}</strong>
        {c.page && <span className="muted"> · p. {c.page}</span>}
      </div>
      <div className="cite-peek-text">{c.text.length > 600 ? c.text.slice(0, 600) + '…' : c.text}</div>
      <button
        className="btn small"
        onClick={() => {
          onClose();
          openModal({ type: 'source', sourceId: c.sourceId, chunkId: c.chunkId });
        }}
      >
        View in source
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- studio

const STUDIO_TILES = [
  { kind: 'podcast', label: 'Audio Overview', desc: 'Two-host deep-dive podcast', icon: <IHeadphones size={22} /> },
  { kind: 'briefing', label: 'Briefing Doc', desc: 'Key themes & takeaways', icon: <IDoc size={22} /> },
  { kind: 'studyguide', label: 'Study Guide', desc: 'Quiz, essays & glossary', icon: <IGrad size={22} /> },
  { kind: 'mindmap', label: 'Mind Map', desc: 'Visual concept map', icon: <IMind size={22} /> },
  { kind: 'faq', label: 'FAQ', desc: 'Questions & answers', icon: <IQuestion size={22} /> },
  { kind: 'timeline', label: 'Timeline', desc: 'Events & key people', icon: <IClock size={22} /> },
  { kind: 'cheatsheet', label: 'Cheat Sheet', desc: 'One-page exam summary', icon: <IText size={22} /> },
] as const;

function StudioTab({ folderId }: { folderId: string }) {
  const items = useLiveQuery(() => db.studio.where('folderId').equals(folderId).reverse().sortBy('createdAt'), [folderId]) ?? [];
  const [podcastOpts, setPodcastOpts] = useState(false);
  const [length, setLength] = useState<'short' | 'default' | 'long'>('default');
  const [focus, setFocus] = useState('');
  const [view, setView] = useState<StudioItem | null>(null);
  const current = view ? items.find((i) => i.id === view.id) ?? view : null;

  const start = (kind: StudioItem['kind']) => {
    if (!hasTextKey()) {
      toast('Add an AI key in Settings to use Studio.', 'error');
      openModal({ type: 'settings' });
      return;
    }
    if (kind === 'podcast') {
      // Spoken overviews are rendered by Gemini's multi-speaker voices.
      if (!hasKey()) {
        toast('Audio Overviews need a Gemini key for the voices — add one in Settings.', 'error');
        openModal({ type: 'settings' });
        return;
      }
      return setPodcastOpts(true);
    }
    runStudio(folderId, kind);
  };

  return (
    <div className="nb-body studio">
      <div className="studio-grid">
        {STUDIO_TILES.map((t) => (
          <button key={t.kind} className={`studio-tile t-${t.kind}`} onClick={() => start(t.kind)}>
            <span className="studio-icon">{t.icon}</span>
            <span className="studio-label">{t.label}</span>
            <span className="studio-desc">{t.desc}</span>
          </button>
        ))}
        <button className="studio-tile t-cards" onClick={() => openModal({ type: 'generateDeck', from: { kind: 'folder', folderId } })}>
          <span className="studio-icon">
            <ICards size={22} />
          </span>
          <span className="studio-label">Flashcards</span>
          <span className="studio-desc">Spaced-repetition deck</span>
        </button>
        <button className="studio-tile t-quiz" onClick={() => openModal({ type: 'generateDeck', from: { kind: 'folder', folderId }, quiz: true })}>
          <span className="studio-icon">
            <IQuestion size={22} />
          </span>
          <span className="studio-label">Quiz</span>
          <span className="studio-desc">Multiple choice & more</span>
        </button>
      </div>
      {items.length > 0 && <div className="studio-section">Generated</div>}
      <ul className="studio-items">
        {items.map((it) => (
          <li key={it.id} className={`studio-item ${it.status}`}>
            <button className="studio-item-main" onClick={() => it.status !== 'working' && setView(it)}>
              <span className="studio-item-icon">{STUDIO_TILES.find((t) => t.kind === it.kind)?.icon}</span>
              <span className="studio-item-text">
                <span className="studio-item-title">{it.title}</span>
                <span className="studio-item-sub">
                  {it.status === 'working' ? (
                    <>
                      <Spinner size={11} /> {it.progress ?? 'Generating…'}
                    </>
                  ) : it.status === 'error' ? (
                    <span className="err">{it.error}</span>
                  ) : (
                    new Date(it.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                  )}
                </span>
              </span>
            </button>
            <button className="icon-btn small" aria-label="Delete" onClick={async () => {
                await db.studio.delete(it.id);
                if (it.audioBlobId) await db.blobs.delete(it.audioBlobId);
              }}>
              <ITrash size={16} />
            </button>
          </li>
        ))}
      </ul>
      {podcastOpts && (
        <Modal title="Audio Overview" onClose={() => setPodcastOpts(false)}>
          <p className="muted">Two AI hosts discuss your sources in a lively deep-dive conversation.</p>
          <div className="field">
            <span>Length</span>
            <Segmented
              value={length}
              onChange={setLength}
              options={[
                { value: 'short', label: 'Short' },
                { value: 'default', label: 'Default' },
                { value: 'long', label: 'Longer' },
              ]}
            />
          </div>
          <label className="field">
            <span>What should the hosts focus on? (optional)</span>
            <textarea className="input" rows={3} placeholder="e.g. Explain it for an exam tomorrow; focus on chapter 3" value={focus} onChange={(e) => setFocus(e.target.value)} />
          </label>
          <div className="confirm-actions">
            <button
              className="btn primary"
              onClick={() => {
                setPodcastOpts(false);
                runStudio(folderId, 'podcast', { length, focus });
              }}
            >
              <IPlus size={16} /> Generate
            </button>
          </div>
        </Modal>
      )}
      {current && current.status === 'ready' && <StudioViewer item={current} onClose={() => setView(null)} />}
    </div>
  );
}
