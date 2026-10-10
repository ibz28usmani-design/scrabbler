import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { displayColor, HIGHLIGHTS, INK_PALETTE, setTool, setToolColor, setToolSize, useTool, type Tool } from '../lib/ink';
import { updateSettings, useSettings, type Settings } from '../lib/settings';
import { useDark } from '../lib/theme';
import { IChevD, IEraser, IHighlighter, ILasso, IMarker, IPencil, IRedo, ITrash, IUndo } from './Icons';

type Edge = Settings['inkToolbarEdge'];

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
const MARGIN = 12;
/** Drop it this close to a corner and it tucks away, as PencilKit does. */
const CORNER = 96;

/** Which edge a point is nearest, and whether it is cornered. */
function placeAt(x: number, y: number, w: number, h: number): { edge: Edge; offset: number; corner: boolean } {
  const d = { left: x, right: w - x, top: y, bottom: h - y };
  const edge = (Object.keys(d) as Edge[]).reduce((a, b) => (d[a] <= d[b] ? a : b));
  const vertical = edge === 'left' || edge === 'right';
  const offset = Math.min(1, Math.max(0, vertical ? y / Math.max(1, h) : x / Math.max(1, w)));
  const corner = (x < CORNER || x > w - CORNER) && (y < CORNER || y > h - CORNER);
  return { edge, offset, corner };
}

/**
 * PencilKit-style tool palette, shared by handwritten notes and inline sketches.
 *
 * On a handwriting page it floats and behaves like Apple's: drag it to any of
 * the four edges and it snaps there, turning into a column down the left or
 * right so it never sits in front of the line you are writing; drop it in a
 * corner, or tap the chevron, and it tucks into a circle showing the current
 * tool. Where it sits is remembered.
 *
 * Only the controls you reach for mid-stroke live on the bar — the five tools,
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
  const { fingerDrawing, inkToolbarOpen: open, inkToolbarEdge: edge, inkToolbarOffset: offset } = useSettings();
  const dark = useDark();
  const [options, setOptions] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number; dx: number; dy: number; corner: boolean } | null>(null);
  const dock = useRef<HTMLDivElement>(null);
  /** When a drag last travelled far enough to be a move rather than a tap. A
      timestamp, not a flag: the click that ends a drag does not always fire,
      and a flag left set would swallow the next genuine tap. */
  const movedAt = useRef(0);
  const palette = tool.ink === 'marker' ? HIGHLIGHTS : INK_PALETTE;
  const swatch = displayColor(tool.color, dark);
  const vertical = floating && (edge === 'left' || edge === 'right');

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
    if (!floating) return;
    // Let the controls be controls; drag from the palette's own body.
    // When open, the controls are controls and you drag from the palette body.
    // Tucked away there is only the circle, so the whole thing drags.
    if (open && (e.target as HTMLElement).closest('button, input, label, select')) return;
    const el = dock.current;
    const box = el?.offsetParent?.getBoundingClientRect();
    if (!el || !box) return;
    const r = el.getBoundingClientRect();
    setOptions(false);
    // No preventDefault here: on touch that also cancels the click that follows,
    // so a tap on the tucked circle would never reopen the palette. Scrolling is
    // already held off by touch-action: none on the dock.
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no capture */
    }
    setDrag({ x: e.clientX - box.left, y: e.clientY - box.top, dx: e.clientX - r.left, dy: e.clientY - r.top, corner: false });
  };

  const moveDrag = (e: ReactPointerEvent) => {
    if (!drag) return;
    const box = dock.current?.offsetParent?.getBoundingClientRect();
    if (!box) return;
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    if (Math.abs(x - drag.x) > 5 || Math.abs(y - drag.y) > 5) movedAt.current = Date.now();
    setDrag({ ...drag, x, y, corner: placeAt(x, y, box.width, box.height).corner });
  };

  const endDrag = (e: ReactPointerEvent) => {
    if (!drag) return;
    const box = dock.current?.offsetParent?.getBoundingClientRect();
    const tapped = Date.now() - movedAt.current > 250;
    setDrag(null);
    // Pointer capture retargets the event to the dock, so a tap on the tucked
    // circle never produces a click of its own. Recognise it here instead.
    if (tapped && !open) {
      setOpen(true);
      return;
    }
    if (!box) return;
    const p = placeAt(e.clientX - box.left, e.clientY - box.top, box.width, box.height);
    // Keep it wholly on the page: it is centred on its offset, so the offset
    // cannot come closer to either end than half the palette.
    const r = dock.current!.getBoundingClientRect();
    const vert = p.edge === 'left' || p.edge === 'right';
    const half = (vert ? r.height / box.height : r.width / box.width) / 2;
    const offset = Math.min(1 - half, Math.max(half, p.offset));
    updateSettings({ inkToolbarEdge: p.edge, inkToolbarOffset: offset, ...(p.corner ? { inkToolbarOpen: false } : {}) });
  };

  /**
   * Snapped to its edge, or following the pointer mid-drag. Every offset is
   * written, including the unused ones: the docked-sketch rule pins top: 0, and
   * a stray top beats a bottom on an absolutely positioned box.
   */
  const loose: CSSProperties = { left: 'auto', right: 'auto', top: 'auto', bottom: 'auto', transform: 'none' };
  const style: CSSProperties | undefined = !floating
    ? undefined
    : drag
      ? { ...loose, left: drag.x - drag.dx, top: drag.y - drag.dy }
      : edge === 'top' || edge === 'bottom'
        ? { ...loose, left: `${offset * 100}%`, [edge]: MARGIN, transform: 'translateX(-50%)' }
        : { ...loose, top: `${offset * 100}%`, [edge]: MARGIN, transform: 'translateY(-50%)' };

  const dragProps = floating ? { onPointerDown: startDrag, onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag } : {};
  const cls = ['ink-dock', floating && 'floating', !open && 'collapsed', drag && 'dragging', drag?.corner && 'will-tuck', className].filter(Boolean).join(' ');

  if (!open) {
    return (
      <div className={cls} data-edge={edge} style={style} ref={dock} {...dragProps}>
        <button
          className="ink-mini glass"
          // A drag that ends on the circle must not also re-open it.
          onClick={() => Date.now() - movedAt.current > 250 && setOpen(true)}
          aria-label={`${labelFor(tool.tool)} — show drawing tools`}
          title="Show drawing tools (drag to move)"
        >
          {iconFor(tool.tool)}
          {tool.tool !== 'eraser' && tool.tool !== 'lasso' && <span className="tool-ink" style={{ ['--sw' as string]: swatch }} />}
        </button>
      </div>
    );
  }

  return (
    <div className={cls} data-edge={edge} style={style} ref={dock} {...dragProps}>
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
      {vertical && <span className="sr-only">Palette docked to the {edge}</span>}
    </div>
  );
}
