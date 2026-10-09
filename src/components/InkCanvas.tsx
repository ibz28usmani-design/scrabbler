import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSettings } from '../lib/settings';
import { cornellGuides, type Paper } from '../lib/paper';
import { hitsStroke, lassoSelect, paintStroke, round, translateStrokes, unionBox, useTool, W, type Stroke, type Tool } from '../lib/ink';
import { InkToolbar } from './InkToolbar';

/**
 * Inline sketch block for typed notes. Pressure-sensitive and Apple Pencil-aware:
 * the Pencil draws while fingers scroll the page (palm rejection) unless finger
 * drawing is on. Full handwritten pages use EndlessCanvas instead.
 */

export type { Paper, Stroke };

export function renderStrokesToPng(strokes: Stroke[], height: number, scale = 2): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = W * scale;
  c.height = height * scale;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(scale, scale);
  for (const st of strokes) paintStroke(ctx, st, false);
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
        paintStroke(ctx, { ...st, p: st.p.map((v, k) => (k % 3 === 0 ? v + dx : k % 3 === 1 ? v + dy : v)) }, dark, false);
      } else paintStroke(ctx, st, dark);
    });
    const b = selection.size ? unionBox(strokes, selection) : null;
    if (b) {
      const mv = drawing.current?.move;
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = dark ? '#ece8df' : '#1a1a1a';
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
    if (st) paintStroke(ctx, st, dark, false);
    if (lasso && lasso.length > 1) {
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = dark ? '#ece8df' : '#1a1a1a';
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

  const selectionBox = () => unionBox(strokesRef.current, selection) ?? { x0: 0, y0: 0, x1: 0, y1: 0 };

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
    const stroke: Stroke = { t: tool.ink, c: tool.color, s: tool.size, p: [round(x), round(y), pressureOf(e.nativeEvent)] };
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
    if (d.lasso && d.lasso.length > 3) setSelection(lassoSelect(strokesRef.current, d.lasso));
    if (d.move && (d.move.dx || d.move.dy)) commit(translateStrokes(strokesRef.current, selection, d.move.dx, d.move.dy));
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

  const paperStyle = paperBackground(paper, scale, dark, height);
  const guides = paper === 'cornell' ? cornellGuides(height) : null;

  return (
    <div className={`ink ${active ? 'active' : ''}`}>
      {active && (
        <InkToolbar
          onUndo={undo}
          onRedo={redo}
          canUndo={undoRef.current.length > 0}
          canRedo={redoRef.current.length > 0}
          onDeleteSelection={
            selection.size
              ? () => {
                  commit(strokesRef.current.filter((_, i) => !selection.has(i)));
                  setSelection(new Set());
                }
              : undefined
          }
        />
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
        {guides && (
          <>
            <span className="cornell-label cues" style={{ left: 14 * scale, top: 8 * scale }}>
              Cues
            </span>
            <span className="cornell-label notes" style={{ left: (guides.cueX + 14) * scale, top: 8 * scale }}>
              Notes
            </span>
            <span className="cornell-label summary" style={{ left: 14 * scale, top: (guides.summaryY + 8) * scale }}>
              Summary
            </span>
          </>
        )}
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

function paperBackground(paper: Paper, scale: number, dark: boolean, height: number): React.CSSProperties {
  const line = dark ? 'rgba(255,255,255,.09)' : 'rgba(60,60,67,.12)';
  const step = 32 * scale;
  if (paper === 'lines') return { backgroundImage: `linear-gradient(to bottom, transparent ${step - 1}px, ${line} ${step - 1}px)`, backgroundSize: `100% ${step}px` };
  if (paper === 'grid')
    return {
      backgroundImage: `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
      backgroundSize: `${step}px ${step}px`,
    };
  if (paper === 'dots') return { backgroundImage: `radial-gradient(${line} 1.4px, transparent 1.6px)`, backgroundSize: `${step}px ${step}px` };
  if (paper === 'cornell') {
    const divider = dark ? 'rgba(245,197,24,.45)' : 'rgba(199,143,0,.4)';
    const { cueX, summaryY } = cornellGuides(height);
    return {
      // Layers paint top-first: ruled lines everywhere, a vertical cue/notes divider,
      // and a horizontal divider above the summary band.
      backgroundImage: [
        `linear-gradient(to bottom, transparent ${step - 1}px, ${line} ${step - 1}px)`,
        `linear-gradient(${divider}, ${divider})`,
        `linear-gradient(${divider}, ${divider})`,
      ].join(', '),
      backgroundSize: [`100% ${step}px`, `2px ${summaryY}px`, `100% 2px`].join(', '),
      backgroundPosition: [`0 0`, `${cueX * scale}px 0`, `0 ${summaryY * scale}px`].join(', '),
      backgroundRepeat: 'repeat-y, no-repeat, no-repeat',
    };
  }
  return {};
}
