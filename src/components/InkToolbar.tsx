import { useEffect, useLayoutEffect, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { displayColor, HIGHLIGHTS, INK_PALETTE, setTool, setToolColor, setToolSize, toggleRuler, useRuler, useTool, type Tool } from '../lib/ink';
import { updateSettings, useSettings, type Settings } from '../lib/settings';
import { useMediaQuery, useOffsetParentHeight } from './ui';
import { useDark } from '../lib/theme';
import { IChevD, IEraser, IHighlighter, ILasso, IMarker, IMore, IPencil, IPlus, IRedo, IRuler, ITrash, IUndo } from './Icons';

type Edge = Settings['inkToolbarEdge']['portrait'];
type Corner = Settings['inkToolbarSpot']['portrait'];

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

/** The squeeze stops here; the floors in the stylesheet guard the touch
    targets long before it, so reaching this means the pane is hopeless. */
const MIN_K = 0.5;

/** Where a release lands: an edge to centre on, a corner, and whether it tucked. */
export function placeAt(x: number, y: number, w: number, h: number): { edge: Edge; corner: Corner; inCorner: boolean } {
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
  const ruler = useRuler();
  const settings = useSettings();
  const { fingerDrawing, inkToolbarOpen: open } = settings;
  // Where the palette belongs depends on which way the iPad is held: a bar
  // along the bottom costs height that landscape has least of.
  const mode = useMediaQuery('(orientation: portrait)') ? 'portrait' : 'landscape';
  const edge = settings.inkToolbarEdge[mode];
  const spot = settings.inkToolbarSpot[mode];
  const dark = useDark();
  const [options, setOptions] = useState(false);
  const dock = useRef<HTMLDivElement>(null);
  /**
   * The drag runs entirely outside React. A pointermove that re-rendered five
   * tool buttons, seven swatches and a blurred glass panel is what made this
   * lag behind the Pencil; a move is now one compositor-only transform write.
   */
  const drag = useRef<{ id: number; sx: number; sy: number; x: number; y: number; moved: boolean } | null>(null);
  /** Tears down the window listeners for the drag in flight, if any. */
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);
  const palette = tool.ink === 'marker' ? HIGHLIGHTS : INK_PALETTE;
  const swatch = displayColor(tool.color, dark);
  const sideways = floating && open && (edge === 'left' || edge === 'right');
  /**
   * How much of the column fits. Every size in it is a multiple of this, so
   * the palette shrinks to the pane rather than scrolling inside it: twice
   * now a guess from the viewport has been wrong, because an iPad gives a web
   * app whatever height Safari's chrome leaves, and full screen changes it
   * again. Below MIN_K the pane is hopeless and the circle is the answer.
   */
  const paneH = useOffsetParentHeight(dock, sideways);
  const bar = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  const measured = useRef(-1);
  // A new pane is a fresh question: try full size again before shrinking.
  useLayoutEffect(() => {
    if (measured.current === paneH) return;
    measured.current = paneH;
    setK(1);
  }, [paneH]);
  // Converge on the factor that fits. The column's height is very nearly
  // linear in k, so one pass lands and a second confirms. Measuring beats the
  // arithmetic: not every size in the column scales, and any of them may be
  // changed in the stylesheet later without this ever being told.
  useLayoutEffect(() => {
    const el = bar.current;
    if (!sideways || !paneH || !el) return;
    // The box's own numbers, not the pane's: clientHeight is the room inside
    // the border, scrollHeight what the controls need. Working from the pane
    // instead left the palette two pixels over, every time — the toolbar's
    // one-pixel border, top and bottom.
    const room = el.clientHeight;
    const need = el.scrollHeight;
    if (!room || !need) return;
    // Judge by the pixels, not by the size of the step: a four-pixel overflow
    // is a change of 0.006 in k, and a threshold coarser than that declared
    // the pane hopeless when it only needed a nudge.
    if (need <= room) return;
    // Always take a real step down. Once the floors below bind, the column's
    // height stops responding to k and a purely proportional step shrinks by
    // less each time, stalling while there was still room to be found: it
    // called a 548px pane hopeless when the floors fit in 454.
    // A smaller forced step costs a few more layout passes on a resize and
    // lands nearer the true fit: at 0.04 the last step overshot, so the same
    // pane settled at 0.62 on the way back from full screen and 0.65 on the
    // way in — both fit, but the palette has no business being smaller than
    // it needs to be.
    const next = Math.max(MIN_K, Math.min((k * room) / need, k - 0.02));
    if (next < k) {
      setK(next);
      return;
    }
    // Squeezed as far as it goes and still too tall. Showing the circle here
    // was a dead end: a tap on it opened the column, which measured the same
    // pane, gave up, and showed the circle again — stuck, with nothing to say
    // why. Move the palette to the bottom instead, where the bar always fits.
    // A real pane only, never a half-laid-out one, or a measurement taken
    // mid-mount would quietly relocate a palette that was perfectly fine.
    if (paneH > 160) updateSettings({ inkToolbarEdge: { ...settings.inkToolbarEdge, [mode]: 'bottom' } });
  }, [sideways, paneH, k, tool.ink, options]);
  const vertical = sideways;

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
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false };
    el.classList.add('dragging');

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || ev.pointerId !== d.id) return;
      const dx = ev.clientX - d.sx;
      const dy = ev.clientY - d.sy;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
      d.x = ev.clientX;
      d.y = ev.clientY;
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      const box = el.offsetParent?.getBoundingClientRect();
      if (box) el.classList.toggle('will-tuck', open && placeAt(ev.clientX - box.left, ev.clientY - box.top, box.width, box.height).inCorner);
    };

    const settle = (d: NonNullable<typeof drag.current>, px: number, py: number) => {
      drag.current = null;
      el.classList.remove('dragging', 'will-tuck');

      // A tap, not a drag.
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
      const p = placeAt(px - box.left, py - box.top, box.width, box.height);
      // FLIP: note where it is, let the new resting place apply synchronously,
      // then animate the difference away on the compositor. Cheaper than
      // transitioning layout, which would relayout the page every frame.
      const first = el.getBoundingClientRect();
      el.style.transform = '';
      const atEdge = { inkToolbarEdge: { ...settings.inkToolbarEdge, [mode]: p.edge } };
      const atCorner = { inkToolbarSpot: { ...settings.inkToolbarSpot, [mode]: p.corner } };
      flushSync(() =>
        updateSettings(
          open
            ? // Dropped in a corner it tucks away; anywhere else it centres on
              // the nearest edge.
              p.inCorner
              ? { inkToolbarOpen: false, ...atCorner }
              : atEdge
            : // Tucked away it lives in the corners, so it goes to whichever is
              // nearest wherever it is let go.
              atCorner,
        ),
      );
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

    // Listen on the window rather than capturing the pointer. Capture retargets
    // every event to the dock, which cost us the circle's own click and, on
    // WebKit, made the drag lag the Pencil.
    const onUp = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || ev.pointerId !== d.id) return;
      stop();
      settle(d, ev.clientX, ev.clientY);
    };

    /**
     * A cancelled pointer still ends the drag somewhere — it just does not say
     * where, since the event reports (0, 0). Settle from the last position a
     * pointermove gave us. Trusting the event's own coordinates flung the
     * palette into the top-left corner; abandoning the drag instead made the
     * bottom corners unreachable on an iPad, where dragging to the bottom edge
     * meets the home-indicator gesture and cancels the pointer.
     */
    const onCancel = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || ev.pointerId !== d.id) return;
      stop();
      settle(d, d.x, d.y);
    };

    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      stopDrag.current = null;
    };
    stopDrag.current = stop;
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    if (options) setOptions(false);
  };

  // Without this the browser starts its own text/image drag part-way through,
  // which cancels the pointer stream and abandons the drag mid-flight.
  const dragProps = floating ? { onPointerDown: startDrag, onDragStart: (e: ReactDragEvent) => e.preventDefault(), draggable: false } : {};
  const asCircle = !open;
  const cls = ['ink-dock', floating && 'floating', asCircle && 'collapsed', className].filter(Boolean).join(' ');
  // Resting places live in CSS, so the inline transform belongs to the drag
  // alone. Only the state in force carries an attribute: with both present the
  // edge rules and the corner rules each set an opposing offset, which stretched
  // the dock into an invisible sheet and left the circle adrift in the middle.
  const place = asCircle ? { 'data-spot': spot } : { 'data-edge': edge };

  // The same controls serve both layouts, so they are built once. Along an
  // edge they sit in a row; down a side they stack into Apple's column.
  const toolBtn = ([t, icon, label]: [Tool, ReactNode, string]) => (
    <button
      key={t}
      className={`ink-tool ${tool.tool === t ? 'on' : ''}`}
      data-tool={t}
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
  );

  const rulerBtn = (
    <button
      className={`ink-tool ${ruler.on ? 'on' : ''}`}
      data-tool="ruler"
      title={ruler.on ? 'Put the ruler away' : 'Lay a ruler on the page'}
      aria-label="Ruler"
      aria-pressed={ruler.on}
      onClick={toggleRuler}
    >
      <IRuler />
    </button>
  );

  const actions = (
    <>
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
    </>
  );

  const swatches = palette.map(({ c, name }) => (
    <button
      key={c}
      className={`swatch ${tool.color === c ? 'on' : ''}`}
      style={{ ['--sw' as string]: displayColor(c, dark) }}
      aria-label={name}
      aria-pressed={tool.color === c}
      title={name}
      onClick={() => setToolColor(c)}
    />
  ));

  const customColor = (label: string) => (
    <label className="swatch custom" title={label} aria-label={label}>
      <input type="color" value={tool.color} onChange={(e) => setToolColor(e.target.value)} aria-label={label} />
    </label>
  );

  const widthRow = (
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
  );

  const fingerRow = (
    <label className="check finger-check" title="Off: only Apple Pencil draws, fingers scroll">
      <input type="checkbox" checked={fingerDrawing} onChange={(e) => updateSettings({ fingerDrawing: e.target.checked })} />
      Draw with finger
    </label>
  );

  const collapseBtn = (
    <button className="ink-collapse" onClick={() => setOpen(false)} aria-label="Hide drawing tools" title="Hide drawing tools">
      <IChevD />
    </button>
  );

  if (asCircle) {
    return (
      <div className={cls} {...place} ref={dock} {...dragProps}>
        <button className="ink-mini glass" aria-label={`${labelFor(tool.tool)} — show drawing tools`} title="Show drawing tools (drag to move)">
          {iconFor(tool.tool)}
          {tool.tool !== 'eraser' && tool.tool !== 'lasso' && <span className="tool-ink" style={{ ['--sw' as string]: swatch }} />}
        </button>
      </div>
    );
  }

  /**
   * Down a side the palette is Apple's column, not the row stood on its end:
   * undo and redo paired at the top, the tools lying on their side with their
   * tips pointing into the page, the colours as a two-wide grid, and the
   * custom colour and the rest behind + and … at the foot. A row rotated 90°
   * puts its colour chip and its controls in the order of a bar, which is not
   * what the hand reaches for when the palette is beside the writing.
   */
  if (vertical) {
    return (
      <div className={cls} {...place} ref={dock} {...dragProps}>
        <div className="ink-toolbar glass column" role="toolbar" aria-label="Drawing tools" ref={bar} style={{ ['--k' as string]: k.toFixed(3) }}>
          <span className="ink-grab" aria-hidden="true" />
          <div className="ink-actions">{actions}</div>
          <span className="ink-sep" />
          <div className="ink-tools">
            {TOOLS.map(toolBtn)}
            {rulerBtn}
          </div>
          <span className="ink-sep" />
          <div className="ink-colors">{swatches}</div>
          <div className="ink-foot">
            <label className="ink-add" title="Custom colour" aria-label="Custom colour">
              <input type="color" value={tool.color} onChange={(e) => setToolColor(e.target.value)} aria-label="Custom colour" />
              <IPlus size={18} />
            </label>
            <button className={`ink-more ${options ? 'on' : ''}`} onClick={() => setOptions((o) => !o)} aria-label="Width and more" aria-expanded={options} title="Width and more">
              <IMore />
            </button>
            {collapseBtn}
          </div>
        </div>

        {options && (
          <div className="ink-options glass" role="dialog" aria-label="Width and more">
            {widthRow}
            {fingerRow}
          </div>
        )}
        <span className="sr-only">Palette docked to the {edge} as a column</span>
      </div>
    );
  }

  return (
    <div className={cls} {...place} ref={dock} {...dragProps}>
      <div className="ink-toolbar glass" role="toolbar" aria-label="Drawing tools">
        {floating && <span className="ink-grab" aria-hidden="true" />}
        <div className="ink-tools">
          {TOOLS.map(toolBtn)}
          {rulerBtn}
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
        <div className="ink-actions">{actions}</div>
        {collapseBtn}
      </div>

      {options && (
        <div className="ink-options glass" role="dialog" aria-label="Colour and width">
          <div className="ink-opt-row">
            <span className="ink-opt-label">{tool.ink === 'marker' ? 'Highlight' : 'Ink'}</span>
            <div className="ink-colors">
              {swatches}
              {customColor('Custom colour')}
            </div>
          </div>
          {widthRow}
          {fingerRow}
        </div>
      )}
      <span className="sr-only">
        Palette docked to the {edge}
        {vertical ? ' as a column' : ''}
      </span>
    </div>
  );
}
