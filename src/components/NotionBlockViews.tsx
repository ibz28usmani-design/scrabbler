/**
 * Notion blocks that need React to draw them: equations, a table of contents,
 * links to other notes, and embedded media.
 */
import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useReducer, useRef, useState } from 'react';
import { db } from '../db';
import { nav } from '../lib/nav';
import { embedPlan, type EmbedKind } from '../lib/embeds';
import { promptDialog } from './ui';

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
        <a className="embed-card" href={src} target="_blank" rel="noopener noreferrer">
          <span className="embed-favicon">🔗</span>
          <span className="embed-card-text">
            <span className="embed-host">{host}</span>
            <span className="embed-url">{src}</span>
          </span>
        </a>
      ) : (
        <div className="embed-foot">
          <a href={src} target="_blank" rel="noopener noreferrer">
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

export const notionViewExtensions = [MathBlock, MathInline, TableOfContents, NoteLink, Embed];
