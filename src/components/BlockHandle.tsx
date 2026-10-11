/**
 * Notion's block handle: hover a block (or put the cursor in it, on iPad) and a
 * ＋ and a ⋮⋮ grip appear beside it. ＋ opens the / menu on a new line below;
 * dragging the grip moves the block; tapping it opens the block menu.
 */
import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import { useCallback, useEffect, useRef, useState } from 'react';
import { blockAt, blockAtPos, deleteBlock, dropBlock, duplicateBlock, freshBlock, insertLineAfter, moveBlock, type BlockRef } from '../lib/blockOps';
import { BLOCK_COLORS, colorBlock, turnInto, type BlockKind } from './notionBlocks';
import { Menu, type MenuItem } from './ui';

const TURN: [BlockKind, string][] = [
  ['text', 'Text'],
  ['h1', 'Heading 1'],
  ['h2', 'Heading 2'],
  ['h3', 'Heading 3'],
  ['bullet', 'Bulleted list'],
  ['number', 'Numbered list'],
  ['todo', 'To-do list'],
  ['toggle', 'Toggle list'],
  ['toggleh1', 'Toggle heading 1'],
  ['toggleh2', 'Toggle heading 2'],
  ['toggleh3', 'Toggle heading 3'],
  ['quote', 'Quote'],
  ['callout', 'Callout'],
  ['code', 'Code'],
];

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function blockFromCoords(view: EditorView, x: number, y: number): BlockRef | null {
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit) return null;
  const doc = view.state.doc;
  if (hit.inside >= 0) {
    const n = doc.nodeAt(hit.inside);
    if (n?.isAtom && n.isBlock) return blockAtPos(doc, hit.inside);
  }
  return blockAtPos(doc, hit.pos);
}

/** Position of the first editable text in a block, if it has any. */
function textStart(ref: BlockRef): number | null {
  if (ref.node.isTextblock) return ref.pos + 1;
  let found: number | null = null;
  ref.node.descendants((n, p) => {
    if (found !== null) return false;
    if (n.isTextblock) found = ref.pos + 1 + p + 1;
    return found === null;
  });
  return found;
}

interface Placed {
  ref: BlockRef;
  top: number;
  /** Too little margin beside the page for ＋ and the grip: show the grip alone. */
  compact: boolean;
}

export function BlockHandle({ editor }: { editor: Editor }) {
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [menu, setMenu] = useState<null | 'main' | 'turn' | 'color'>(null);
  const [drop, setDrop] = useState<{ top: number } | null>(null);
  const self = useRef<HTMLDivElement>(null);
  const grip = useRef<HTMLButtonElement>(null);
  const lastPointer = useRef<string>(window.matchMedia('(hover: none)').matches ? 'touch' : 'mouse');
  const dragging = useRef(false);

  const place = useCallback(
    (ref: BlockRef | null) => {
      const page = self.current?.offsetParent as HTMLElement | null;
      if (!ref || !page || editor.isDestroyed) return setPlaced(null);
      const dom = editor.view.nodeDOM(ref.pos) as HTMLElement | null;
      if (!dom?.getBoundingClientRect) return setPlaced(null);
      const pageTop = page.getBoundingClientRect().top;
      const t = textStart(ref);
      let top = dom.getBoundingClientRect().top - pageTop;
      if (t !== null) {
        try {
          const c = editor.view.coordsAtPos(t);
          top = (c.top + c.bottom) / 2 - pageTop - 13;
        } catch {
          /* fall back to the block's top */
        }
      }
      const scroller = page.closest('.editor-scroll');
      const gutter = scroller ? page.getBoundingClientRect().left - scroller.getBoundingClientRect().left : 0;
      setPlaced({ ref, top, compact: gutter < 58 });
    },
    [editor],
  );

  // Mouse: follow the hovered block. Touch and Pencil: follow the cursor's block.
  useEffect(() => {
    const view = editor.view;
    const scroller = view.dom.closest('.editor-scroll') as HTMLElement | null;
    if (!scroller) return;
    const onMove = (e: PointerEvent) => {
      lastPointer.current = e.pointerType;
      if (e.pointerType !== 'mouse' || dragging.current || menu) return;
      if (self.current?.contains(e.target as Node)) return;
      const r = view.dom.getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom) return setPlaced(null);
      place(blockFromCoords(view, Math.max(r.left + 4, Math.min(e.clientX, r.right - 4)), e.clientY));
    };
    const onDown = (e: PointerEvent) => {
      lastPointer.current = e.pointerType;
      // A tap on the line the cursor is already on changes no selection, so
      // place the handle once the tap has settled.
      if (e.pointerType !== 'mouse' && !self.current?.contains(e.target as Node)) {
        setTimeout(() => editor.isFocused && !dragging.current && place(blockAt(editor.state.selection.$from)), 60);
      }
    };
    const onLeave = () => !dragging.current && !menu && lastPointer.current === 'mouse' && setPlaced(null);
    scroller.addEventListener('pointermove', onMove);
    scroller.addEventListener('pointerdown', onDown, true);
    scroller.addEventListener('pointerleave', onLeave);
    return () => {
      scroller.removeEventListener('pointermove', onMove);
      scroller.removeEventListener('pointerdown', onDown, true);
      scroller.removeEventListener('pointerleave', onLeave);
    };
  }, [editor, place, menu]);

  useEffect(() => {
    const onSel = () => {
      if (dragging.current) return;
      if (lastPointer.current !== 'mouse') place(editor.isFocused ? blockAt(editor.state.selection.$from) : null);
    };
    // Typing hides a hover handle until the mouse moves again, as in Notion.
    const onUpdate = () => {
      if (dragging.current) return;
      if (lastPointer.current === 'mouse') setPlaced(null);
      else onSel();
    };
    const onBlur = () => !menu && lastPointer.current !== 'mouse' && setPlaced(null);
    editor.on('selectionUpdate', onSel);
    editor.on('focus', onSel);
    editor.on('update', onUpdate);
    editor.on('blur', onBlur);
    return () => {
      editor.off('selectionUpdate', onSel);
      editor.off('focus', onSel);
      editor.off('update', onUpdate);
      editor.off('blur', onBlur);
    };
  }, [editor, place, menu]);

  const current = () => (placed ? freshBlock(editor.state.doc, placed.ref) : null);

  const plus = () => {
    const ref = current();
    if (!ref) return;
    const { tr } = editor.state;
    if (ref.node.type.name === 'paragraph' && ref.node.content.size === 0) {
      tr.setSelection(TextSelection.create(tr.doc, ref.pos + 1)).insertText('/');
    } else insertLineAfter(tr, ref, '/');
    editor.view.dispatch(tr.scrollIntoView());
    editor.commands.focus();
  };

  /** Puts the cursor in the block so the editor's own commands act on it. */
  const selectBlock = (ref: BlockRef) => {
    const t = textStart(ref);
    if (t !== null) editor.chain().focus().setTextSelection(t).run();
  };

  // Grip: a tap opens the menu, a drag moves the block.
  const onGripDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const ref = current();
    if (!ref) return;
    e.preventDefault();
    const view = editor.view;
    const scroller = view.dom.closest('.editor-scroll') as HTMLElement | null;
    const page = self.current?.offsetParent as HTMLElement | null;
    const startX = e.clientX;
    const startY = e.clientY;
    let target: number | null = null;
    let raf = 0;
    let lastY = startY;
    e.currentTarget.setPointerCapture(e.pointerId);

    const findGap = (y: number) => {
      const r = view.dom.getBoundingClientRect();
      const over = blockFromCoords(view, r.left + 4, Math.max(r.top + 1, Math.min(y, r.bottom - 1)));
      if (!over || !page) return;
      const dom = view.nodeDOM(over.pos) as HTMLElement | null;
      if (!dom?.getBoundingClientRect) return;
      const b = dom.getBoundingClientRect();
      const before = y < b.top + b.height / 2;
      target = before ? over.pos : over.pos + over.node.nodeSize;
      setDrop({ top: (before ? b.top : b.bottom) - page.getBoundingClientRect().top });
    };
    const autoScroll = () => {
      if (!dragging.current || !scroller) return;
      const r = scroller.getBoundingClientRect();
      const edge = 60;
      const dy = lastY < r.top + edge ? -12 : lastY > r.bottom - edge ? 12 : 0;
      if (dy) {
        scroller.scrollTop += dy;
        findGap(lastY);
      }
      raf = requestAnimationFrame(autoScroll);
    };
    const move = (ev: PointerEvent) => {
      lastY = ev.clientY;
      if (!dragging.current && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
        dragging.current = true;
        document.body.classList.add('block-dragging');
        raf = requestAnimationFrame(autoScroll);
      }
      if (dragging.current) findGap(ev.clientY);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      cancelAnimationFrame(raf);
      document.body.classList.remove('block-dragging');
      setDrop(null);
      if (!dragging.current) {
        setMenu('main');
        return;
      }
      dragging.current = false;
      const fresh = freshBlock(editor.state.doc, ref);
      if (fresh && target !== null) {
        const tr = editor.state.tr;
        if (dropBlock(tr, fresh, target)) editor.view.dispatch(tr.scrollIntoView());
      }
      setPlaced(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const ref = current();
  const textual = !!ref && textStart(ref) !== null;
  const act = (fn: (ref: BlockRef) => void) => () => {
    const r = current();
    if (r) fn(r);
  };
  const items: MenuItem[] =
    menu === 'turn'
      ? TURN.map(([k, label]) => ({ label, onClick: act((r) => (selectBlock(r), turnInto(editor, k))) }))
      : menu === 'color'
        ? [
            { label: 'Default', onClick: act((r) => (selectBlock(r), colorBlock(editor, 'color', null), colorBlock(editor, 'background', null))) },
            ...BLOCK_COLORS.map((c) => ({ label: <span data-color={c}>{cap(c)}</span>, onClick: act((r) => (selectBlock(r), colorBlock(editor, 'color', c))) })),
            { divider: true, label: '' },
            ...BLOCK_COLORS.map((c) => ({ label: <span data-bg={c}>{cap(c)} background</span>, onClick: act((r) => (selectBlock(r), colorBlock(editor, 'background', c))) })),
          ]
        : [
            { label: 'Turn into…', icon: '⇄', disabled: !textual, onClick: () => setTimeout(() => setMenu('turn'), 0) },
            { label: 'Colour…', icon: 'A', disabled: !textual, onClick: () => setTimeout(() => setMenu('color'), 0) },
            { divider: true, label: '' },
            { label: 'Duplicate', icon: '⧉', hint: '⌘D', onClick: act((r) => editor.view.dispatch(duplicateBlock(editor.state.tr, r))) },
            { label: 'Move up', icon: '↑', hint: '⌘⇧↑', onClick: act((r) => { const tr = editor.state.tr; if (moveBlock(tr, r, -1)) editor.view.dispatch(tr.scrollIntoView()); }) },
            { label: 'Move down', icon: '↓', hint: '⌘⇧↓', onClick: act((r) => { const tr = editor.state.tr; if (moveBlock(tr, r, 1)) editor.view.dispatch(tr.scrollIntoView()); }) },
            { divider: true, label: '' },
            { label: 'Delete', icon: '🗑', danger: true, onClick: act((r) => editor.view.dispatch(deleteBlock(editor.state.tr, r))) },
          ];

  if (!editor.isEditable) return null;
  return (
    <>
      <div ref={self} className={`block-handle ${placed ? 'on' : ''} ${placed?.compact ? 'compact' : ''}`} style={{ top: placed?.top ?? 0 }} contentEditable={false}>
        <button className="block-handle-btn plus" aria-label="Add a block below" title="Add below — or type /" onPointerDown={(e) => e.preventDefault()} onClick={plus}>
          +
        </button>
        <button ref={grip} className="block-handle-btn grip" aria-label="Drag to move, tap for options" title="Drag to move · tap for options" onPointerDown={onGripDown}>
          ⋮⋮
        </button>
      </div>
      {drop && <div className="block-drop-line" style={{ top: drop.top }} />}
      {menu && grip.current && (
        <Menu
          anchor={grip.current}
          items={items}
          // "Turn into…" and "Colour…" reopen as their own menu right after this closes.
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
