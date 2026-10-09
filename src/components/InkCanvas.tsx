import { getStroke } from 'perfect-freehand';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSettings, updateSettings } from '../lib/settings';
import { IEraser, IHighlighter, ILasso, IMarker, IPencil, IRedo, ITrash, IUndo } from './Icons';

/**
 * Pressure-sensitive ink surface designed for Apple Pencil:
 *  - Pencil draws; fingers scroll the page (palm rejection) unless finger drawing is on.
 *  - Uses coalesced pointer events, pressure and tilt-aware strokes, hover preview.
 *  - Strokes are stored in a 1000-unit logical width so they scale with the window.
 */

export type Tool = 'pen' | 'pencil' | 'marker' | 'eraser' | 'lasso';
export type Paper = 'blank' | 'lines' | 'grid' | 'dots';

export interface Stroke {
  t: Exclude<Tool, 'eraser' | 'lasso'>;
  c: string;
  s: number;
  /** flattened x,y,pressure triples */
  p: number[];
}

const W = 1000;

export const INK_COLORS = ['#1c1c1e', '#2563eb', '#dc2626', '#16a34a', '#f59e0b', '#9333ea', '#ec4899', '#ffffff'];

// Shared tool state so every drawing remembers the last tool, like PencilKit's picker.
const toolState = { tool: 'pen' as Tool, color: '#1c1c1e', size: 4 };
const toolListeners = new Set<() => void>();
let toolSnapshot = { ...toolState };
function setTool(patch: Partial<typeof toolState>) {
  Object.assign(toolState, patch);
  toolSnapshot = { ...toolState };
  toolListeners.forEach((l) => l());
}
function useTool() {
  return useSyncExternalStore(
    (cb) => {
      toolListeners.add(cb);
      return () => toolListeners.delete(cb);
    },
    () => toolSnapshot,
  );
}

function optionsFor(st: Stroke, last: boolean) {
  const base = { last, simulatePressure: false, smoothing: 0.55, streamline: 0.45 };
  switch (st.t) {
    case 'pencil':
      return { ...base, size: st.s * 0.85, thinning: 0.75, streamline: 0.35 };
    case 'marker':
      return { ...base, size: st.s * 4, thinning: 0, smoothing: 0.6, start: { cap: false }, end: { cap: false } };
    default:
      return { ...base, size: st.s * 1.1, thinning: 0.62 };
  }
}

function toPoints(p: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2]]);
  return out;
}

function strokePath(st: Stroke, last = true): Path2D {
  const outline = getStroke(toPoints(st.p), optionsFor(st, last));
  const path = new Path2D();
  if (!outline.length) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length - 1; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[i + 1];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

function paint(ctx: CanvasRenderingContext2D, st: Stroke, dark: boolean, last = true) {
  ctx.save();
  let color = st.c;
  // Keep "black" ink legible in dark mode, like Apple Notes does.
  if (dark && (color === '#1c1c1e' || color === '#000000')) color = '#f2f2f7';
  else if (!dark && color === '#ffffff') color = '#d4d4d8';
  ctx.fillStyle = color;
  if (st.t === 'marker') {
    ctx.globalAlpha = 0.32;
    ctx.globalCompositeOperation = dark ? 'screen' : 'multiply';
  } else if (st.t === 'pencil') ctx.globalAlpha = 0.82;
  ctx.fill(strokePath(st, last));
  ctx.restore();
}

function bbox(st: Stroke) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i < st.p.length; i += 3) {
    x0 = Math.min(x0, st.p[i]);
    y0 = Math.min(y0, st.p[i + 1]);
    x1 = Math.max(x1, st.p[i]);
    y1 = Math.max(y1, st.p[i + 1]);
  }
  const pad = st.s * (st.t === 'marker' ? 2 : 1);
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

function hitsStroke(st: Stroke, x: number, y: number, r: number) {
  const b = bbox(st);
  if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) return false;
  const rr = (r + st.s) ** 2;
  for (let i = 0; i < st.p.length; i += 3) {
    const dx = st.p[i] - x;
    const dy = st.p[i + 1] - y;
    if (dx * dx + dy * dy <= rr) return true;
    // Also test the segment to the next point so fast strokes can be erased.
    if (i + 3 < st.p.length) {
      const ax = st.p[i], ay = st.p[i + 1], bx = st.p[i + 3], by = st.p[i + 4];
      const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
      if (l2 > 0) {
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2));
        if ((ax + t * (bx - ax) - x) ** 2 + (ay + t * (by - ay) - y) ** 2 <= rr) return true;
      }
    }
  }
  return false;
}

function pointInPoly(x: number, y: number, poly: number[][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const round = (n: number) => Math.round(n * 10) / 10;

export function renderStrokesToPng(strokes: Stroke[], height: number, scale = 2): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = W * scale;
  c.height = height * scale;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(scale, scale);
  for (const st of strokes) paint(ctx, st, false);
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}

interface Props {
  strokes: Stroke[];
  height: number;
  paper: Paper;
  active: boolean;
  onChange: (strokes: Stroke[]) => void;
  onHeight: (h: number) => void;
  onActivate: () => void;
  dark: boolean;
}

export function InkCanvas({ strokes, height, paper, active, onChange, onHeight, onActivate, dark }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const tool = useTool();
  const { fingerDrawing } = useSettings();
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const undoRef = useRef<Stroke[][]>([]);
  const redoRef = useRef<Stroke[][]>([]);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const drawing = useRef<{ id: number; stroke?: Stroke; lasso?: number[][]; erased?: boolean; move?: { x: number; y: number; dx: number; dy: number } } | null>(null);
  const scale = width / W || 1;

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const commit = useCallback(
    (next: Stroke[]) => {
      undoRef.current.push(strokesRef.current);
      if (undoRef.current.length > 100) undoRef.current.shift();
      redoRef.current = [];
      onChange(next);
    },
    [onChange],
  );

  // Redraw committed strokes.
  useEffect(() => {
    const c = baseRef.current;
    if (!c || !width) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * scale * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.clearRect(0, 0, W, height);
    strokes.forEach((st, i) => {
      if (selection.has(i) && drawing.current?.move) {
        const { dx, dy } = drawing.current.move;
        paint(ctx, { ...st, p: st.p.map((v, k) => (k % 3 === 0 ? v + dx : k % 3 === 1 ? v + dy : v)) }, dark);
      } else paint(ctx, st, dark);
    });
    if (selection.size) {
      let b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      selection.forEach((i) => {
        const s = strokes[i];
        if (!s) return;
        const bb = bbox(s);
        b = { x0: Math.min(b.x0, bb.x0), y0: Math.min(b.y0, bb.y0), x1: Math.max(b.x1, bb.x1), y1: Math.max(b.y1, bb.y1) };
      });
      const mv = drawing.current?.move;
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = '#e5a50a';
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeRect(b.x0 - 6 + (mv?.dx ?? 0), b.y0 - 6 + (mv?.dy ?? 0), b.x1 - b.x0 + 12, b.y1 - b.y0 + 12);
      ctx.restore();
    }
    const live = liveRef.current!;
    live.width = c.width;
    live.height = c.height;
  }, [strokes, width, height, scale, dark, selection]);

  // Clear selection when the tool changes or the block deactivates.
  useEffect(() => {
    if (tool.tool !== 'lasso' || !active) setSelection(new Set());
  }, [tool.tool, active]);

  // Palm rejection: stop Safari from scrolling for Pencil touches, let fingers scroll.
  useEffect(() => {
    const el = liveRef.current!;
    const block = (e: TouchEvent) => {
      if (!active) return;
      const stylus = Array.from(e.changedTouches).some((t: any) => t.touchType === 'stylus');
      if (stylus || fingerDrawing) e.preventDefault();
    };
    el.addEventListener('touchstart', block, { passive: false });
    el.addEventListener('touchmove', block, { passive: false });
    return () => {
      el.removeEventListener('touchstart', block);
      el.removeEventListener('touchmove', block);
    };
  }, [active, fingerDrawing]);

  const pos = (e: PointerEvent | React.PointerEvent) => {
    const r = liveRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 0.5);

  const drawLive = (st: Stroke | null, hover?: { x: number; y: number }, lasso?: number[][]) => {
    const c = liveRef.current!;
    const ctx = c.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.clearRect(0, 0, W, height);
    if (st) paint(ctx, st, dark, false);
    if (lasso && lasso.length > 1) {
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = '#e5a50a';
      ctx.lineWidth = 1.5 / scale;
      ctx.beginPath();
      ctx.moveTo(lasso[0][0], lasso[0][1]);
      lasso.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.stroke();
      ctx.restore();
    }
    if (hover) {
      ctx.save();
      ctx.beginPath();
      const r = tool.tool === 'eraser' ? 10 : Math.max(2, (tool.size * (tool.tool === 'marker' ? 4 : 1)) / 2);
      ctx.arc(hover.x, hover.y, r, 0, Math.PI * 2);
      ctx.fillStyle = tool.tool === 'eraser' ? 'rgba(120,120,120,.25)' : tool.color;
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.restore();
    }
  };

  const eraseAt = (x: number, y: number) => {
    const before = strokesRef.current;
    const next = before.filter((st) => !hitsStroke(st, x, y, 8));
    if (next.length !== before.length) {
      if (!drawing.current?.erased) {
        undoRef.current.push(before);
        redoRef.current = [];
        drawing.current!.erased = true;
      }
      strokesRef.current = next;
      onChange(next);
    }
  };

  const selectionBox = () => {
    let b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    selection.forEach((i) => {
      const s = strokesRef.current[i];
      if (!s) return;
      const bb = bbox(s);
      b = { x0: Math.min(b.x0, bb.x0), y0: Math.min(b.y0, bb.y0), x1: Math.max(b.x1, bb.x1), y1: Math.max(b.y1, bb.y1) };
    });
    return b;
  };

  const onDown = (e: React.PointerEvent) => {
    if (!active) {
      onActivate();
      return;
    }
    if (e.pointerType === 'touch' && !fingerDrawing) return; // finger scrolls
    if (drawing.current) return; // ignore extra contacts (palm)
    if (e.button > 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    try {
      liveRef.current!.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
    const { x, y } = pos(e);
    // Apple Pencil barrel button / eraser end on other styluses.
    const t: Tool = e.buttons === 32 || e.button === 5 ? 'eraser' : tool.tool;
    if (t === 'eraser') {
      drawing.current = { id: e.pointerId };
      eraseAt(x, y);
      return;
    }
    if (t === 'lasso') {
      const b = selectionBox();
      if (selection.size && x >= b.x0 - 8 && x <= b.x1 + 8 && y >= b.y0 - 8 && y <= b.y1 + 8) {
        drawing.current = { id: e.pointerId, move: { x, y, dx: 0, dy: 0 } };
      } else {
        setSelection(new Set());
        drawing.current = { id: e.pointerId, lasso: [[x, y]] };
      }
      return;
    }
    const stroke: Stroke = { t: t as Stroke['t'], c: tool.color, s: tool.size, p: [round(x), round(y), pressureOf(e.nativeEvent)] };
    drawing.current = { id: e.pointerId, stroke };
    drawLive(stroke);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drawing.current;
    if (!d) {
      if (active && e.pointerType === 'pen' && e.buttons === 0) drawLive(null, pos(e)); // Pencil hover
      return;
    }
    if (e.pointerId !== d.id) return;
    const events: PointerEvent[] = (e.nativeEvent as any).getCoalescedEvents?.() ?? [e.nativeEvent];
    const list = events.length ? events : [e.nativeEvent];
    if (d.move) {
      const { x, y } = pos(e);
      d.move.dx = x - d.move.x;
      d.move.dy = y - d.move.y;
      setSelection((s) => new Set(s));
      return;
    }
    if (d.lasso) {
      for (const ev of list) {
        const { x, y } = pos(ev);
        d.lasso.push([x, y]);
      }
      drawLive(null, undefined, d.lasso);
      return;
    }
    if (!d.stroke) {
      for (const ev of list) {
        const { x, y } = pos(ev);
        eraseAt(x, y);
      }
      drawLive(null, pos(e));
      return;
    }
    for (const ev of list) {
      const { x, y } = pos(ev);
      d.stroke.p.push(round(x), round(y), pressureOf(ev));
    }
    drawLive(d.stroke);
    const lastY = d.stroke.p[d.stroke.p.length - 2];
    if (lastY > height - 40) onHeight(Math.round(height + 240));
  };

  const onUp = (e: React.PointerEvent) => {
    const d = drawing.current;
    if (!d || e.pointerId !== d.id) return;
    drawing.current = null;
    if (d.stroke && d.stroke.p.length >= 3) commit([...strokesRef.current, d.stroke]);
    if (d.lasso && d.lasso.length > 3) {
      const sel = new Set<number>();
      strokesRef.current.forEach((st, i) => {
        let inside = 0;
        let n = 0;
        for (let k = 0; k < st.p.length; k += 9) {
          n++;
          if (pointInPoly(st.p[k], st.p[k + 1], d.lasso!)) inside++;
        }
        if (n && inside / n > 0.5) sel.add(i);
      });
      setSelection(sel);
    }
    if (d.move && (d.move.dx || d.move.dy)) {
      const { dx, dy } = d.move;
      commit(strokesRef.current.map((st, i) => (selection.has(i) ? { ...st, p: st.p.map((v, k) => (k % 3 === 0 ? round(v + dx) : k % 3 === 1 ? round(v + dy) : v)) } : st)));
    }
    drawLive(null);
  };

  const undo = () => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(strokesRef.current);
    setSelection(new Set());
    onChange(prev);
  };
  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(strokesRef.current);
    onChange(next);
  };

  const paperStyle = paperBackground(paper, scale, dark);

  return (
    <div className={`ink ${active ? 'active' : ''}`}>
      {active && (
        <div className="ink-toolbar" onPointerDown={(e) => e.stopPropagation()}>
          <div className="ink-tools">
            {(
              [
                ['pen', <IPencil key="p" />, 'Pen'],
                ['pencil', <IMarker key="m" />, 'Pencil'],
                ['marker', <IHighlighter key="h" />, 'Highlighter'],
                ['eraser', <IEraser key="e" />, 'Eraser'],
                ['lasso', <ILasso key="l" />, 'Lasso'],
              ] as const
            ).map(([t, icon, label]) => (
              <button key={t} className={`ink-tool ${tool.tool === t ? 'on' : ''}`} title={label} aria-label={label} onClick={() => setTool({ tool: t })}>
                {icon}
              </button>
            ))}
          </div>
          <div className="ink-colors">
            {INK_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${tool.color === c ? 'on' : ''}`}
                style={{ background: c }}
                aria-label={`Color ${c}`}
                onClick={() => setTool({ color: c, tool: tool.tool === 'eraser' || tool.tool === 'lasso' ? 'pen' : tool.tool })}
              />
            ))}
            <label className="swatch custom" title="Custom colour">
              <input type="color" value={tool.color} onChange={(e) => setTool({ color: e.target.value })} />
            </label>
          </div>
          <div className="ink-sizes">
            {[2, 4, 7, 12].map((s) => (
              <button key={s} className={`size-dot ${tool.size === s ? 'on' : ''}`} onClick={() => setTool({ size: s })} aria-label={`Size ${s}`}>
                <span style={{ width: 3 + s, height: 3 + s }} />
              </button>
            ))}
          </div>
          <div className="ink-actions">
            <button className="icon-btn" onClick={undo} disabled={!undoRef.current.length} aria-label="Undo">
              <IUndo />
            </button>
            <button className="icon-btn" onClick={redo} disabled={!redoRef.current.length} aria-label="Redo">
              <IRedo />
            </button>
            {selection.size > 0 && (
              <button
                className="icon-btn danger"
                aria-label="Delete selection"
                onClick={() => {
                  commit(strokesRef.current.filter((_, i) => !selection.has(i)));
                  setSelection(new Set());
                }}
              >
                <ITrash />
              </button>
            )}
            <label className="finger-toggle" title="Draw with finger">
              <input type="checkbox" checked={fingerDrawing} onChange={(e) => updateSettings({ fingerDrawing: e.target.checked })} />
              <span>Finger</span>
            </label>
          </div>
        </div>
      )}
      <div ref={wrapRef} className={`ink-surface paper-${paper}`} style={{ height: height * scale, ...paperStyle }}>
        <canvas ref={baseRef} className="ink-base" style={{ height: height * scale }} />
        <canvas
          ref={liveRef}
          className="ink-live"
          style={{ height: height * scale, touchAction: active && fingerDrawing ? 'none' : 'pan-x pan-y', cursor: active ? 'crosshair' : 'pointer' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => !drawing.current && drawLive(null)}
        />
        {!active && strokes.length === 0 && <div className="ink-hint">Tap to draw with Apple Pencil</div>}
      </div>
      {active && (
        <div
          className="ink-resize"
          onPointerDown={(e) => {
            e.preventDefault();
            const startY = e.clientY;
            const startH = height;
            const move = (ev: PointerEvent) => onHeight(Math.max(160, Math.round(startH + (ev.clientY - startY) / scale)));
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        >
          <span />
        </div>
      )}
    </div>
  );
}

function paperBackground(paper: Paper, scale: number, dark: boolean): React.CSSProperties {
  const line = dark ? 'rgba(255,255,255,.09)' : 'rgba(60,60,67,.12)';
  const step = 32 * scale;
  if (paper === 'lines') return { backgroundImage: `linear-gradient(to bottom, transparent ${step - 1}px, ${line} ${step - 1}px)`, backgroundSize: `100% ${step}px` };
  if (paper === 'grid')
    return {
      backgroundImage: `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
      backgroundSize: `${step}px ${step}px`,
    };
  if (paper === 'dots') return { backgroundImage: `radial-gradient(${line} 1.4px, transparent 1.6px)`, backgroundSize: `${step}px ${step}px` };
  return {};
}
