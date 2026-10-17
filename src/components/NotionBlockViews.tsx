/**
 * Notion blocks that need React to draw them: equations, a table of contents,
 * links to other notes, and embedded media.
 */
import { Extension, Node, mergeAttributes, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useReducer, useRef, useState } from 'react';
import { db } from '../db';
import { nav } from '../lib/nav';
import { cleanUrl, embedPlan, type EmbedKind } from '../lib/embeds';
import { promptDialog, Spinner, useObjectUrl } from './ui';
import { attachmentKind, formatBytes, insertFiles } from '../lib/attachments';
import { toast, toastError } from '../lib/events';
import { getSlashHost } from '../lib/slashHost';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    notionViews: {
      insertMathBlock: (latex?: string) => ReturnType;
      insertMathInline: (latex: string) => ReturnType;
      insertToc: () => ReturnType;
      insertNoteLink: (attrs: { id: string; title: string }) => ReturnType;
      insertEmbed: (attrs: { src: string; kind: EmbedKind }) => ReturnType;
    };
  }
}

// ------------------------------------------------------------------ equations

type Katex = typeof import('katex').default;
let katexLoad: Promise<Katex> | null = null;
/** KaTeX and its fonts load the first time a note shows an equation. */
const loadKatex = () =>
  (katexLoad ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => m.default));

function useKatexHtml(latex: string, display: boolean) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadKatex().then((k) => live && setHtml(k.renderToString(latex || '\\square', { displayMode: display, throwOnError: false, trust: false, strict: 'ignore' })));
    return () => {
      live = false;
    };
  }, [latex, display]);
  return html;
}

function MathBlockView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex: string = node.attrs.latex ?? '';
  const [editing, setEditing] = useState(!latex);
  const [draft, setDraft] = useState(latex);
  const html = useKatexHtml(editing ? draft : latex, true);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) area.current?.focus();
  }, [editing]);
  const done = () => {
    updateAttributes({ latex: draft.trim() });
    setEditing(false);
    editor.commands.focus();
  };
  return (
    <NodeViewWrapper className={`math-block ${selected ? 'is-selected' : ''}`} contentEditable={false}>
      <div className="math-render" onClick={() => editor.isEditable && setEditing(true)} dangerouslySetInnerHTML={{ __html: html ?? '' }} />
      {editing && (
        <div className="math-edit">
          <textarea
            ref={area}
            className="input mono"
            rows={Math.min(6, draft.split('\n').length + 1)}
            value={draft}
            placeholder="E = mc^2"
            spellCheck={false}
            autoCapitalize="off"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                e.preventDefault();
                done();
              }
              if (e.key === 'Escape') {
                setDraft(latex);
                setEditing(false);
              }
            }}
          />
          <button className="btn primary small" onClick={done}>
            Done
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}

function MathInlineView({ node, updateAttributes, editor }: NodeViewProps) {
  const html = useKatexHtml(node.attrs.latex ?? '', false);
  const edit = async () => {
    if (!editor.isEditable) return;
    const v = await promptDialog('Inline equation (LaTeX)', node.attrs.latex ?? '', 'a^2 + b^2 = c^2');
    if (v !== null) updateAttributes({ latex: v });
  };
  return (
    <NodeViewWrapper as="span" className="math-inline" contentEditable={false} onClick={edit} dangerouslySetInnerHTML={{ __html: html ?? '…' }} />
  );
}

const latexAttr = {
  latex: {
    default: '',
    parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? '',
    renderHTML: (a: Record<string, any>) => ({ 'data-latex': a.latex }),
  },
};

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: () => latexAttr,
  parseHTML: () => [{ tag: 'div[data-type="math-block"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'math-block' })],
  renderText: ({ node }) => node.attrs.latex,
  addNodeView: () => ReactNodeViewRenderer(MathBlockView, { stopEvent: ({ event }) => (event.target as HTMLElement).closest?.('.math-edit') != null }),
  addCommands() {
    return {
      insertMathBlock:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    };
  },
});

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => latexAttr,
  parseHTML: () => [{ tag: 'span[data-type="math-inline"]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'math-inline' })],
  renderText: ({ node }) => node.attrs.latex,
  addNodeView: () => ReactNodeViewRenderer(MathInlineView, { as: 'span' }),
  addCommands() {
    return {
      insertMathInline:
        (latex) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    };
  },
});

// ------------------------------------------------------------------ table of contents

interface TocEntry {
  pos: number;
  level: number;
  text: string;
}

export function tocEntries(editor: Editor): TocEntry[] {
  const out: TocEntry[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') out.push({ pos, level: node.attrs.level, text: node.textContent });
    else if (node.type.name === 'details' && node.attrs.heading) out.push({ pos, level: node.attrs.heading, text: node.firstChild?.textContent ?? '' });
    return node.type.name !== 'heading';
  });
  return out.filter((e) => e.text.trim());
}

function TocView({ editor }: NodeViewProps) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    editor.on('update', bump);
    return () => void editor.off('update', bump);
  }, [editor]);
  const entries = tocEntries(editor);
  const go = (pos: number) => {
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    dom?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    editor.chain().setTextSelection(pos + 1).focus(undefined, { scrollIntoView: false }).run();
  };
  return (
    <NodeViewWrapper className="toc-block" contentEditable={false}>
      {entries.length ? (
        entries.map((e) => (
          <button key={e.pos} className={`toc-item l${e.level}`} onMouseDown={(ev) => ev.preventDefault()} onClick={() => go(e.pos)}>
            {e.text}
          </button>
        ))
      ) : (
        <div className="toc-empty">Add headings to build a table of contents.</div>
      )}
    </NodeViewWrapper>
  );
}

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-type="toc"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toc' })],
  addNodeView: () => ReactNodeViewRenderer(TocView),
  addCommands() {
    return {
      insertToc:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});

// ------------------------------------------------------------------ links to notes

export async function openNote(id: string) {
  const n = await db.notes.get(id);
  if (n && !n.deletedAt) nav({ view: 'folder', folderId: n.folderId, noteId: id, pane: 'editor' });
}

function NoteLinkView({ node }: NodeViewProps) {
  const id: string = node.attrs.id;
  const note = useLiveQuery(() => db.notes.get(id), [id]);
  const gone = note === undefined ? false : !note || !!note.deletedAt;
  const title = (note?.title || node.attrs.title || 'Untitled').trim() || 'Untitled';
  return (
    <NodeViewWrapper as="span" className={`note-link ${gone ? 'gone' : ''}`} contentEditable={false} onClick={() => !gone && openNote(id)} title={gone ? 'This note was deleted' : 'Open note'}>
      <span className="note-link-icon">{note?.kind === 'ink' ? '✎' : note?.kind === 'lecture' ? '🎙' : '📄'}</span>
      {title}
    </NodeViewWrapper>
  );
}

export const NoteLink = Node.create({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: '', parseHTML: (el) => el.getAttribute('data-note') ?? '', renderHTML: (a) => ({ 'data-note': a.id }) },
      title: { default: '', parseHTML: (el) => el.textContent ?? '', renderHTML: () => ({}) },
    };
  },
  parseHTML: () => [{ tag: 'span[data-note]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { class: 'note-link' }), node.attrs.title || 'Untitled'],
  renderText: ({ node }) => node.attrs.title || 'Untitled',
  addNodeView: () => ReactNodeViewRenderer(NoteLinkView, { as: 'span' }),
  addCommands() {
    return {
      insertNoteLink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs }, { type: 'text', text: ' ' }]),
    };
  },
});

// ------------------------------------------------------------------ embeds

function EmbedView({ node, selected, deleteNode }: NodeViewProps) {
  const src: string = node.attrs.src;
  const plan = embedPlan(src, node.attrs.kind);
  const href = cleanUrl(src) ?? undefined;
  let host = src;
  try {
    host = new URL(src).hostname.replace(/^www\./, '');
  } catch {
    /* keep the raw text */
  }
  return (
    <NodeViewWrapper className={`embed-block as-${plan.as} ${selected ? 'is-selected' : ''}`} contentEditable={false}>
      {plan.as === 'frame' && (
        <iframe src={plan.src} title={host} loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms" referrerPolicy="strict-origin-when-cross-origin" />
      )}
      {plan.as === 'video' && <video src={plan.src} controls playsInline preload="metadata" />}
      {plan.as === 'audio' && <audio src={plan.src} controls preload="metadata" />}
      {plan.as === 'card' ? (
        <a className="embed-card" href={href} target="_blank" rel="noopener noreferrer">
          <span className="embed-favicon">🔗</span>
          <span className="embed-card-text">
            <span className="embed-host">{host}</span>
            <span className="embed-url">{src}</span>
          </span>
        </a>
      ) : (
        <div className="embed-foot">
          <a href={href} target="_blank" rel="noopener noreferrer">
            {host} ↗
          </a>
          {selected && (
            <button className="link-btn" onClick={() => deleteNode()}>
              Remove
            </button>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: '', parseHTML: (el) => el.getAttribute('data-src') ?? '', renderHTML: (a) => ({ 'data-src': a.src }) },
      kind: { default: 'embed', parseHTML: (el) => el.getAttribute('data-kind') ?? 'embed', renderHTML: (a) => ({ 'data-kind': a.kind }) },
    };
  },
  parseHTML: () => [{ tag: 'div[data-type="embed"]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'embed' }), ['a', { href: node.attrs.src }, node.attrs.src]],
  renderText: ({ node }) => node.attrs.src,
  addNodeView: () => ReactNodeViewRenderer(EmbedView),
  addCommands() {
    return {
      insertEmbed:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

// ------------------------------------------------------------------ attached files

/** First-page previews, kept for the session so scrolling past a PDF doesn't redraw it. */
const previews = new Map<string, Promise<{ image: string; pages: number }>>();

function usePdfPreview(blobId: string, blob: Blob | undefined) {
  const [preview, setPreview] = useState<{ image: string; pages: number } | null>(null);
  useEffect(() => {
    if (!blob) return;
    let live = true;
    let job = previews.get(blobId);
    if (!job) {
      job = import('../lib/pdf').then((m) => m.pdfFirstPage(blob));
      previews.set(blobId, job);
      job.catch(() => previews.delete(blobId));
    }
    job.then((p) => live && setPreview(p)).catch((e) => console.warn('PDF preview failed', e));
    return () => {
      live = false;
    };
  }, [blobId, blob]);
  return preview;
}

const FILE_GLYPH: Record<string, string> = { pdf: 'PDF', video: '▶', audio: '♪', image: '🖼', file: '📎' };

function AttachmentView({ node, selected, editor, deleteNode }: NodeViewProps) {
  const { blobId, name, mime, size } = node.attrs as { blobId: string; name: string; mime: string; size: number };
  const stored = useLiveQuery(() => (blobId ? db.blobs.get(blobId) : undefined), [blobId]);
  const missing = stored === undefined ? false : !stored;
  const blob = stored?.blob;
  const url = useObjectUrl(blob);
  const kind = attachmentKind(mime, name);
  const preview = usePdfPreview(blobId, kind === 'pdf' ? blob : undefined);
  const [adding, setAdding] = useState(false);
  const meta = [formatBytes(size), preview && `${preview.pages} ${preview.pages === 1 ? 'page' : 'pages'}`].filter(Boolean).join(' · ');

  const toSources = async () => {
    const host = getSlashHost(editor);
    if (!blob || !host) return;
    setAdding(true);
    try {
      const { addPdf } = await import('../lib/sources');
      nav({ notebookOpen: true, notebookTab: 'sources' });
      await addPdf(host.folderId, new File([blob], name, { type: 'application/pdf' }));
      toast('Added to this folder’s notebook sources.', 'success');
    } catch (e) {
      toastError(e);
    } finally {
      setAdding(false);
    }
  };

  const head = (
    <div className="file-head">
      <span className={`file-glyph k-${kind}`}>{FILE_GLYPH[kind]}</span>
      <span className="file-text">
        <span className="file-name">{name || 'File'}</span>
        <span className="file-meta">{missing ? 'This file is no longer on this device' : meta}</span>
      </span>
      {url && (
        <span className="file-actions">
          {kind === 'pdf' && (
            <button className="chip" onMouseDown={(e) => e.preventDefault()} onClick={toSources} disabled={adding} title="Read it in Notebook chat and Studio">
              {adding ? <Spinner size={13} /> : '+'} Sources
            </button>
          )}
          <a className="chip" href={url} target="_blank" rel="noopener">
            Open
          </a>
          <a className="chip" href={url} download={name}>
            Save
          </a>
        </span>
      )}
      {selected && editor.isEditable && (
        <button className="link-btn danger" onClick={() => deleteNode()}>
          Remove
        </button>
      )}
    </div>
  );

  return (
    <NodeViewWrapper className={`file-block k-${kind} ${selected ? 'is-selected' : ''} ${missing ? 'missing' : ''}`} contentEditable={false}>
      {kind === 'video' && url && <video src={`${url}#t=0.1`} controls playsInline preload="metadata" />}
      {kind === 'audio' && url && <audio src={url} controls preload="metadata" />}
      {kind === 'pdf' && url && (
        <a className="pdf-preview" href={url} target="_blank" rel="noopener" aria-label={`Open ${name}`}>
          {preview ? <img src={preview.image} alt="" /> : <Spinner size={18} />}
        </a>
      )}
      {head}
    </NodeViewWrapper>
  );
}

export const Attachment = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      blobId: { default: '', parseHTML: (el) => el.getAttribute('data-blob') ?? '', renderHTML: (a) => ({ 'data-blob': a.blobId }) },
      name: { default: '', parseHTML: (el) => el.getAttribute('data-name') ?? el.textContent ?? '', renderHTML: (a) => ({ 'data-name': a.name }) },
      mime: { default: '', parseHTML: (el) => el.getAttribute('data-mime') ?? '', renderHTML: (a) => ({ 'data-mime': a.mime }) },
      size: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-size')) || 0, renderHTML: (a) => ({ 'data-size': a.size }) },
    };
  },
  parseHTML: () => [{ tag: 'div[data-type="attachment"]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'attachment' }), node.attrs.name],
  renderText: ({ node }) => node.attrs.name,
  addNodeView: () => ReactNodeViewRenderer(AttachmentView, { stopEvent: ({ event }) => !!(event.target as HTMLElement).closest?.('a, button, video, audio') }),
});

/** Files dropped or pasted into a note: pictures become images, the rest attachments. */
export const FileDrop = Extension.create({
  name: 'fileDrop',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('fileDrop'),
        props: {
          handleDrop: (view, event) => {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (!files.length || !editor.isEditable) return false;
            event.preventDefault();
            let at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            // The first line is the note's title: files dropped on it go just below.
            const title = view.state.doc.firstChild;
            if (at !== undefined && title?.isTextblock && at < title.nodeSize) at = title.nodeSize - 1;
            void insertFiles(editor, files, at);
            return true;
          },
          handlePaste: (_view, event) => {
            const data = event.clipboardData;
            const files = Array.from(data?.files ?? []);
            // Copied web content brings HTML along; let the editor paste that as usual.
            if (!files.length || data?.getData('text/html') || !editor.isEditable) return false;
            event.preventDefault();
            void insertFiles(editor, files);
            return true;
          },
        },
      }),
    ];
  },
});

export const notionViewExtensions = [MathBlock, MathInline, TableOfContents, NoteLink, Embed, Attachment];
