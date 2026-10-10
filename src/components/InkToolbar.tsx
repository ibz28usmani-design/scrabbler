import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { displayColor, HIGHLIGHTS, INK_PALETTE, setTool, setToolColor, setToolSize, useTool, type Tool } from '../lib/ink';
import { updateSettings, useSettings, type Settings } from '../lib/settings';
import { useDark } from '../lib/theme';
import { IChevD, IEraser, IHighlighter, ILasso, IMarker, IPencil, IRedo, ITrash, IUndo } from './Icons';

type Edge = Settings['inkToolbarEdge'];
type Corner = Settings['inkToolbarCorner'];

const TOOLS: [Tool, ReactNode, string][] = [
  ['pen', <IPencil key="p" />, 'Pen'],
  ['pencil', <IMarker key="m" />, 'Pencil'],
  ['marker', <IHighlighter key="h" />, 'Highlighter'],
  ['eraser', <IEraser key="e" />, 'Eraser'],
  ['lasso', <ILasso key="l" />, 'Lasso'],
];

const SIZES: Record<'pen' | 'pencil' | 'marker', number[]> = {
  pen: [2, 3, 5, 8],
  pencil: [2, 3, 5, 8],
  marker: [3, 5, 8, 12],
};

const iconFor = (t: Tool) => TOOLS.find(([k]) => k === t)![1];
const labelFor = (t: Tool) => TOOLS.find(([k]) => k === t)![2];

/** Let go this near a corner and the palette tucks into the circle. */
const CORNER = 120;

/** Where a release lands: an edge to centre on, a corner, and whether it tucked. */
function placeAt(x: number, y: number, w: number, h: number): { edge: Edge; corner: Corner; inCorner: boolean } {
  const d = { left: x, right: w - x, top: y, bottom: h - y };
  const edge = (Object.keys(d) as Edge[]).reduce((a, b) => (d[a] <= d[b] ? a : b));
  const corner = `${y < h / 2 ? 't' : 'b'}${x < w / 2 ? 'l' : 'r'}` as Corner;
  const inCorner = (x < CORNER || x > w - CORNER) && (y < CORNER || y > h - CORNER);
  return { edge, corner, inCorner };
}

/**
 * PencilKit-style tool palette, shared by handwritten notes and inline sketches.
 *
 * On a handwriting page it floats and behaves like Apple's: drag it and it
 * settles in the middle of whichever edge you let go nearest, becoming a column
 * down the left or right so it is never in front of the line you are writing.
 * Let go near a corner, or tap the chevron, and it tucks into a circle showing
 * the tool in hand. There are only eight resting places — four edge centres and
 * four corners — so it never has to be aimed.
 *
 * Only the controls you reach for mid-stroke live on the bar: the five tools,
 * the current colour, undo and redo. Colours, widths and the finger switch are
 * behind the colour chip, or by tapping the tool you are already using, because
 * a single row holding all of them is wider than an iPad.
 */
export function InkToolbar({
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onDeleteSelection,
  floating = false,
  className = '',
  children,
}: {
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onDeleteSelection?: () => void;
  /** Dockable and draggable, as on a handwriting page. Inline sketches pin it in place. */
  floating?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const tool = useTool();
  const { fingerDrawing, inkToolbarOpen: open, inkToolbarEdge: edge, inkToolbarCorner: corner } = useSettings();
  const dark = useDark();
  const [options, setOptions] = useState(false);
  const dock = useRef<HTMLDivElement>(null);
  /**
   * The drag runs entirely outside React. A pointermove that re-rendered five
   * tool buttons, seven swatches and a blurred glass panel is what made this
   * lag behind the Pencil; a move is now one compositor-only transform write.
   */
  const drag = useRef<{ id: number; sx: number; sy: number; moved: boolean } | null>(null);
  const palette = tool.ink === 'marker' ? HIGHLIGHTS : INK_PALETTE;
  const swatch = displayColor(tool.color, dark);
  const vertical = floating && open && (edge === 'left' || edge === 'right');

  // The popover is a menu: a tap outside or Escape puts it away.
  useEffect(() => {
    if (!options) return;
    const onDown = (e: PointerEvent) => {
      if (!dock.current?.contains(e.target as Node)) setOptions(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOptions(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [options]);

  const setOpen = (v: boolean) => {
    setOptions(false);
    updateSettings({ inkToolbarOpen: v });
  };

  // ---------------------------------------------------------------- dragging

  const startDrag = (e: ReactPointerEvent) => {
    if (!floating || drag.current) return;
    // While open the controls are controls, so you drag from the palette's own
    // body. Tucked away there is only the circle, so all of it drags.
    if (open && (e.target as HTMLElement).closest('button, input, label, select')) return;
    const el = dock.current;
    if (!el) return;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
    el.classList.add('dragging');
    // No preventDefault here: on touch that also cancels the click that follows,
    // so a tap on the circle would never reopen the palette. Scrolling is held
    // off by touch-action: none on the dock instead.
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no capture */
    }
    if (options) setOptions(false);
  };

  const moveDrag = (e: ReactPointerEvent) => {
    const d = drag.current;
    const el = dock.current;
    if (!d || !el || e.pointerId !== d.id) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    const box = el.offsetParent?.getBoundingClientRect();
    if (box) el.classList.toggle('will-tuck', open && placeAt(e.clientX - box.left, e.clientY - box.top, box.width, box.height).inCorner);
  };

  const endDrag = (e: ReactPointerEvent) => {
    const d = drag.current;
    const el = dock.current;
    if (!d || !el || e.pointerId !== d.id) return;
    drag.current = null;
    el.classList.remove('dragging', 'will-tuck');

    // A tap, not a drag. Pointer capture retargets the event to the dock, so the
    // circle never gets a click of its own; recognise the tap here instead.
    if (!d.moved) {
      el.style.transform = '';
      if (!open) setOpen(true);
      return;
    }
    const box = el.offsetParent?.getBoundingClientRect();
    if (!box) {
      el.style.transform = '';
      return;
    }
    const p = placeAt(e.clientX - box.left, e.clientY - box.top, box.width, box.height);
    // FLIP: note where it is, let the new resting place apply synchronously,
    // then animate the difference away. Smoother than transitioning the layout,
    // which would relayout the page on every frame of the settle.
    const first = el.getBoundingClientRect();
    el.style.transform = '';
    flushSync(() => updateSettings(open && !p.inCorner ? { inkToolbarEdge: p.edge } : { inkToolbarOpen: false, inkToolbarCorner: p.corner }));
    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (dx || dy) {
      el.style.transition = 'none';
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      void el.offsetWidth; // commit the jump before animating it away
      el.style.transition = '';
      el.style.transform = '';
    }
  };

  const dragProps = floating ? { onPointerDown: startDrag, onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag } : {};
  const cls = ['ink-dock', floating && 'floating', !open && 'collapsed', className].filter(Boolean).join(' ');
  // Resting places live in CSS, so the inline transform belongs to the drag alone.
  const place = { 'data-edge': edge, 'data-corner': corner };

  if (!open) {
    return (
      <div className={cls} {...place} ref={dock} {...dragProps}>
        <button className="ink-mini glass" aria-label={`${labelFor(tool.tool)} — show drawing tools`} title="Show drawing tools (drag to move)">
          {iconFor(tool.tool)}
          {tool.tool !== 'eraser' && tool.tool !== 'lasso' && <span className="tool-ink" style={{ ['--sw' as string]: swatch }} />}
        </button>
      </div>
    );
  }

  return (
    <div className={cls} {...place} ref={dock} {...dragProps}>
      <div className="ink-toolbar glass" role="toolbar" aria-label="Drawing tools">
        {floating && <span className="ink-grab" aria-hidden="true" />}
        <div className="ink-tools">
          {TOOLS.map(([t, icon, label]) => (
            <button
              key={t}
              className={`ink-tool ${tool.tool === t ? 'on' : ''}`}
              title={label}
              aria-label={label}
              aria-pressed={tool.tool === t}
              onClick={() => {
                // Tapping the tool you are already using opens its options, as PencilKit does.
                if (tool.tool === t && t !== 'eraser' && t !== 'lasso') setOptions((o) => !o);
                else {
                  setTool(t);
                  setOptions(false);
                }
              }}
            >
              {icon}
              {tool.tool === t && t !== 'eraser' && t !== 'lasso' && <span className="tool-ink" style={{ ['--sw' as string]: swatch }} />}
            </button>
          ))}
        </div>
        <span className="ink-sep" />
        <button
          className={`ink-chip ${options ? 'on' : ''}`}
          style={{ ['--sw' as string]: swatch }}
          onClick={() => setOptions((o) => !o)}
          aria-label="Colour and width"
          aria-expanded={options}
          title="Colour and width"
        >
          <span className="ink-chip-dot" />
          <IChevD size={13} />
        </button>
        <span className="ink-sep" />
        <div className="ink-actions">
          <button className="icon-btn" onClick={onUndo} disabled={!canUndo} aria-label="Undo">
            <IUndo />
          </button>
          <button className="icon-btn" onClick={onRedo} disabled={!canRedo} aria-label="Redo">
            <IRedo />
          </button>
          {onDeleteSelection && (
            <button className="icon-btn danger" aria-label="Delete selection" onClick={onDeleteSelection}>
              <ITrash />
            </button>
          )}
          {children}
        </div>
        <button className="ink-collapse" onClick={() => setOpen(false)} aria-label="Hide drawing tools" title="Hide drawing tools">
          <IChevD />
        </button>
      </div>

      {options && (
        <div className="ink-options glass" role="dialog" aria-label="Colour and width">
          <div className="ink-opt-row">
            <span className="ink-opt-label">{tool.ink === 'marker' ? 'Highlight' : 'Ink'}</span>
            <div className="ink-colors">
              {palette.map(({ c, name }) => (
                <button
                  key={c}
                  className={`swatch ${tool.color === c ? 'on' : ''}`}
                  style={{ ['--sw' as string]: displayColor(c, dark) }}
                  aria-label={name}
                  aria-pressed={tool.color === c}
                  title={name}
                  onClick={() => setToolColor(c)}
                />
              ))}
              <label className="swatch custom" title="Custom colour">
                <input type="color" value={tool.color} onChange={(e) => setToolColor(e.target.value)} aria-label="Custom colour" />
              </label>
            </div>
          </div>
          <div className="ink-opt-row">
            <span className="ink-opt-label">Width</span>
            <div className="ink-sizes">
              {SIZES[tool.ink].map((s) => (
                <button key={s} className={`size-dot ${tool.size === s ? 'on' : ''}`} onClick={() => setToolSize(s)} aria-label={`Width ${s}`} aria-pressed={tool.size === s}>
                  <span style={{ width: 2 + s * (tool.ink === 'marker' ? 1.6 : 1.2), height: 2 + s * (tool.ink === 'marker' ? 1.6 : 1.2) }} />
                </button>
              ))}
            </div>
          </div>
          <label className="check finger-check" title="Off: only Apple Pencil draws, fingers scroll">
            <input type="checkbox" checked={fingerDrawing} onChange={(e) => updateSettings({ fingerDrawing: e.target.checked })} />
            Draw with finger
          </label>
        </div>
      )}
      <span className="sr-only">
        Palette docked to the {edge}
        {vertical ? ' as a column' : ''}
      </span>
    </div>
  );
}
