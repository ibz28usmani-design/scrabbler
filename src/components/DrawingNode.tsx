import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { SketchCanvas } from './SketchCanvas';
import { TranscribeDialog } from './TranscribeDialog';
import { HANDWRITING_TEMPLATES, PAGE_H, type Paper } from '../lib/paper';
import type { Stroke } from '../lib/ink';
import { transcribeHandwriting } from '../lib/ai';
import { renderInkPages } from '../lib/inkRender';
import { canReadImages } from '../lib/llm';
import { mdToEditorHtml } from '../lib/markdown';
import { useNoteContext } from '../lib/noteContext';
import { getSettings } from '../lib/settings';
import { useDark } from '../lib/theme';
import { ISparkle, ITrash } from './Icons';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    drawing: {
      insertDrawing: (attrs?: { height?: number; paper?: Paper | null; page?: boolean; adoptPen?: boolean }) => ReturnType;
    };
  }
}

/** After this long without a stroke, the handwriting is read for search and links. */
const OCR_IDLE_MS = 4000;

/** A cheap fingerprint of the ink, so unchanged handwriting isn't read twice. */
export function strokesKey(strokes: Stroke[]): string {
  let h = 0;
  for (const s of strokes) for (let i = 0; i < s.p.length; i += 9) h = (h * 31 + Math.round(s.p[i] * 7 + s.p[i + 1])) | 0;
  return `${strokes.length}:${h}`;
}

function DrawingView({ node, updateAttributes, deleteNode, editor, getPos, selected }: NodeViewProps) {
  const [active, setActive] = useState(!!node.attrs.autoActive);
  const [transcribing, setTranscribing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dark = useDark();
  const note = useNoteContext();
  const strokes = (node.attrs.strokes ?? []) as Stroke[];
  const own = node.attrs.paper as Paper | null;
  const paper: Paper = own ?? note?.paper ?? 'blank';
  const page = !!node.attrs.page;
  const adoptPen = useRef(!!node.attrs.adoptPen).current;

  useEffect(() => {
    if (node.attrs.autoActive || node.attrs.adoptPen) updateAttributes({ autoActive: false, adoptPen: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A tap anywhere else puts the sketch down — but not one on its own tools,
  // which float over the note rather than inside the sketch.
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('.menu, .ink-dock, .modal, .modal-backdrop')) setActive(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [active]);

  useEffect(() => {
    if (selected) setActive(true);
  }, [selected]);

  // Read the handwriting once you pause, so it is searchable and its [[links]]
  // and #tags count — as Apple Notes indexes handwriting.
  const key = strokesKey(strokes);
  useEffect(() => {
    if (!strokes.length || node.attrs.ocrKey === key || !getSettings().autoOcr || !canReadImages()) return;
    let stale = false;
    const t = window.setTimeout(async () => {
      try {
        const pages = await renderInkPages({ strokes, paper }, { scale: 1.2, template: paper === 'cornell' });
        const text = await transcribeHandwriting(pages, 'plain', paper);
        if (!stale) updateAttributes({ ocr: text.trim(), ocrKey: key });
      } catch {
        /* quota or network: tried again after the next stroke */
      }
    }, OCR_IDLE_MS);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const insertBelow = (md: string) => {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos !== undefined) editor.chain().focus().insertContentAt(pos + node.nodeSize, mdToEditorHtml(md)).run();
  };

  return (
    <NodeViewWrapper className={`drawing-node ${page ? 'page' : ''} ${active ? 'is-active' : ''}`} contentEditable={false} data-drag-handle="">
      <div ref={ref}>
        {active && (
          <div className="drawing-head">
            <span className="drawing-label">{page ? 'Handwriting' : 'Sketch'}</span>
            <select
              value={own ?? ''}
              onChange={(e) => updateAttributes({ paper: e.target.value || null })}
              aria-label="Sketch paper"
            >
              <option value="">Note’s paper</option>
              {HANDWRITING_TEMPLATES.map((t) => (
                <option key={t.paper} value={t.paper}>
                  {t.label}
                </option>
              ))}
            </select>
            <button className="chip" onClick={() => setTranscribing(true)} disabled={!strokes.length}>
              <ISparkle size={15} /> Transcribe
            </button>
            <span className="spacer" />
            <button className="icon-btn danger" onClick={() => deleteNode()} aria-label="Delete sketch">
              <ITrash size={18} />
            </button>
            <button className="chip" onClick={() => setActive(false)}>
              Done
            </button>
          </div>
        )}
        <SketchCanvas
          strokes={strokes}
          height={node.attrs.height}
          paper={paper}
          page={page}
          active={active}
          adoptPen={adoptPen}
          dark={dark}
          onActivate={() => setActive(true)}
          onChange={(patch) => updateAttributes(patch)}
        />
      </div>
      {transcribing && (
        <TranscribeDialog
          target={{ strokes, paper, title: note?.title ?? '', folderId: note?.folderId ?? '' }}
          onInsert={insertBelow}
          onRead={(plain) => updateAttributes({ ocr: plain, ocrKey: key })}
          onClose={() => setTranscribing(false)}
        />
      )}
    </NodeViewWrapper>
  );
}

export const Drawing = Node.create({
  name: 'drawing',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      strokes: {
        default: [],
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-strokes') || '[]');
          } catch {
            return [];
          }
        },
        renderHTML: (attrs) => ({ 'data-strokes': JSON.stringify(attrs.strokes ?? []) }),
      },
      height: { default: 420, parseHTML: (el) => Number(el.getAttribute('data-height') || 420), renderHTML: (a) => ({ 'data-height': a.height }) },
      /** Its own paper; null follows the note's. */
      paper: { default: null, parseHTML: (el) => el.getAttribute('data-paper') || null, renderHTML: (a) => (a.paper ? { 'data-paper': a.paper } : {}) },
      /** A whole page of handwriting rather than a sketch among the text. */
      page: { default: false, parseHTML: (el) => el.hasAttribute('data-page'), renderHTML: (a) => (a.page ? { 'data-page': '' } : {}) },
      /** What the handwriting says, read by the AI: searchable, and its [[links]] count. */
      ocr: { default: '', parseHTML: (el) => el.getAttribute('data-ocr') ?? '', renderHTML: (a) => (a.ocr ? { 'data-ocr': a.ocr } : {}) },
      ocrKey: { default: '', parseHTML: (el) => el.getAttribute('data-ocr-key') ?? '', renderHTML: (a) => (a.ocrKey ? { 'data-ocr-key': a.ocrKey } : {}) },
      autoActive: { default: false, rendered: false },
      adoptPen: { default: false, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-drawing]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-drawing': '' })];
  },
  // Plain text (search, AI sources, word counts) gets the handwriting's words.
  renderText({ node }) {
    return node.attrs.ocr || '';
  },
  addNodeView() {
    return ReactNodeViewRenderer(DrawingView, { stopEvent: () => true });
  },
  addCommands() {
    return {
      insertDrawing:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs: { height: attrs.page ? PAGE_H : 420, ...attrs, autoActive: true } }, { type: 'paragraph' }]),
    };
  },
});
