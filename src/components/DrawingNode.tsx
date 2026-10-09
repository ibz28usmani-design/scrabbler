import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { InkCanvas, renderStrokesToPng, type Stroke } from './InkCanvas';
import { CORNELL_DEFAULT_HEIGHT, type Paper } from '../lib/paper';
import { handwritingToText } from '../lib/ai';
import { mdToEditorHtml } from '../lib/markdown';
import { toastError, toast } from '../lib/events';
import { hasKey } from '../lib/gemini';
import { useDark } from '../lib/theme';
import { ISparkle, ITrash } from './Icons';
import { Spinner } from './ui';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    drawing: {
      insertDrawing: (attrs?: { height?: number; paper?: Paper }) => ReturnType;
    };
  }
}

function DrawingView({ node, updateAttributes, deleteNode, editor, getPos, selected }: NodeViewProps) {
  const [active, setActive] = useState(!!node.attrs.autoActive);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dark = useDark();
  const strokes = (node.attrs.strokes ?? []) as Stroke[];

  useEffect(() => {
    if (node.attrs.autoActive) updateAttributes({ autoActive: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('.menu')) setActive(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [active]);

  useEffect(() => {
    if (selected) setActive(true);
  }, [selected]);

  const toText = async () => {
    if (!strokes.length) return;
    if (!hasKey()) return toast('Add your Gemini key in Settings to convert handwriting.', 'error');
    setBusy(true);
    try {
      const png = await renderStrokesToPng(strokes, node.attrs.height);
      const md = await handwritingToText(png);
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos !== undefined) editor.chain().focus().insertContentAt(pos + node.nodeSize, mdToEditorHtml(md)).run();
      toast('Handwriting converted — text added below the drawing.', 'success');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <NodeViewWrapper className={`drawing-node ${active ? 'is-active' : ''}`} contentEditable={false} data-drag-handle="">
      <div ref={ref}>
        {active && (
          <div className="drawing-head">
            <select
              value={node.attrs.paper}
              onChange={(e) => {
                const paper = e.target.value as Paper;
                // Cornell needs room for the cue/notes columns above the summary band.
                const bump = paper === 'cornell' && node.attrs.height < CORNELL_DEFAULT_HEIGHT;
                updateAttributes({ paper, ...(bump ? { height: CORNELL_DEFAULT_HEIGHT } : {}) });
              }}
              aria-label="Paper style"
            >
              <option value="blank">Plain</option>
              <option value="lines">Lined</option>
              <option value="grid">Square grid</option>
              <option value="dots">Dots</option>
              <option value="cornell">Cornell</option>
            </select>
            <button className="chip" onClick={toText} disabled={busy || !strokes.length}>
              {busy ? <Spinner size={13} /> : <ISparkle size={15} />} Handwriting → text
            </button>
            <span className="spacer" />
            <button className="icon-btn danger" onClick={() => deleteNode()} aria-label="Delete drawing">
              <ITrash size={18} />
            </button>
            <button className="chip" onClick={() => setActive(false)}>
              Done
            </button>
          </div>
        )}
        <InkCanvas
          strokes={strokes}
          height={node.attrs.height}
          paper={node.attrs.paper}
          active={active}
          dark={dark}
          onActivate={() => setActive(true)}
          onChange={(s) => updateAttributes({ strokes: s })}
          onHeight={(h) => updateAttributes({ height: h })}
        />
      </div>
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
      paper: { default: 'blank', parseHTML: (el) => el.getAttribute('data-paper') || 'blank', renderHTML: (a) => ({ 'data-paper': a.paper }) },
      autoActive: { default: false, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-drawing]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-drawing': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DrawingView, { stopEvent: () => true });
  },
  addCommands() {
    return {
      insertDrawing:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name, attrs: { ...attrs, autoActive: true } }, { type: 'paragraph' }]),
    };
  },
});
