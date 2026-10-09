import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { bbox, contentBottom, hitsStroke, intersects, lassoSelect, paintStroke, round, translateStrokes, unionBox, useTool, W, type Stroke, type Tool } from '../lib/ink';
import { drawTemplate, endlessHeight, templateColors, type Paper } from '../lib/paper';
import { useSettings } from '../lib/settings';
import { InkToolbar } from './InkToolbar';

/**
 * An endless handwriting surface, like Apple Notes' handwriting pages.
 *
 * Rendering is virtualised: two canvases the size of the *visible* area stick to
 * the viewport while a tall sheet scrolls beneath them, and only strokes in view
 * are painted. A single canvas the height of a long note would exceed Safari's
 * ~16 MP canvas limit on iPad and render blank.
 *
 *  - Apple Pencil draws; fingers scroll (palm rejection) unless finger drawing is on.
 *  - Pinch (or ⌘/Ctrl + scroll) zooms around the gesture point.
 *  - The page extends itself as you write or scroll toward the end.
 */

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const MAX_PAGE_PX = 1100;

export interface EndlessCanvasProps {
  paper: Paper;
  strokes: Stroke[];
  height: number;
  dark: boolean;
  zoom: number;
  onZoom: (z: number) => void;
  onChange: (patch: { strokes?: Stroke[]; height?: number }) => void;
  toolbarExtra?: ReactNode;
}

type Gesture =
  | { kind: 'stroke'; id: number; stroke: Stroke }
  | { kind: 'erase'; id: number; erased: boolean }
  | { kind: 'lasso'; id: number; poly: number[][] }
  | { kind: 'move'; id: number; x: number; y: number; dx: number; dy: number };

export function EndlessCanvas({ paper, strokes: initial, height: initialHeight, dark, zoom, onZoom, onChange, toolbarExtra }: EndlessCanvasProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const tool = useTool();
  const { fingerDrawing } = useSettings();

  const [strokes, setStrokes] = useState<Stroke[]>(initial);
  const [height, setHeight] = useState(initialHeight);
  const [box, setBox] = useState({ cw: 0, ch: 0 });
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [, bump] = useState(0);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const heightRef = useRef(height);
  heightRef.current = height;
  const undo = useRef<Stroke[][]>([]);
  const redo = useRef<Stroke[][]>([]);
  const gesture = useRef<Gesture | null>(null);
  const touchPointers = useRef(new Set<number>());
  const zoomAnchor = useRef<{ lx: number; ly: number; cx: number; cy: number } | null>(null);
  const frame = useRef(0);

  const gutter = box.cw < 700 ? 6 : 28;
  const topPad = 84;
  const baseW = Math.max(280, Math.min(box.cw - gutter * 2, MAX_PAGE_PX));
  const sheetW = baseW * zoom;
  const scale = sheetW / W;
  const sheetH = height * scale;
  const vpW = Math.min(sheetW, box.cw);
  const vpH = Math.min(sheetH, box.ch);
  const padW = Math.max(box.cw, sheetW + gutter * 2);

  // ---------------------------------------------------------------- sizing

  useLayoutEffect(() => {
    const el = scrollerRef.current!;
    const measure = () => setBox({ cw: el.clientWidth, ch: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const viewLogicalH = box.ch / (scale || 1);

  const grow = useCallback(
    (bottom: number, minExtra = 0) => {
      const next = endlessHeight(paper, bottom, Math.max(viewLogicalH, 600), heightRef.current + minExtra);
      if (next !== heightRef.current) {
        heightRef.current = next;
        setHeight(next);
        onChange({ height: next });
      }
    },
    [paper, viewLogicalH, onChange],
  );

  // A fresh canvas should always offer at least a screenful past the content.
  useEffect(() => {
    if (box.ch) grow(contentBottom(strokesRef.current));
  }, [box.ch, grow]);

  // ---------------------------------------------------------------- rendering

  const geometry = () => {
    const vp = vpRef.current!;
    const sheet = sheetRef.current!;
    const vr = vp.getBoundingClientRect();
    const sr = sheet.getBoundingClientRect();
    return { ox: vr.left - sr.left, oy: vr.top - sr.top, w: vp.clientWidth, h: vp.clientHeight, sr };
  };

  const prepare = (c: HTMLCanvasElement, w: number, h: number) => {
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (c.width !== pw || c.height !== ph) {
      c.width = pw;
      c.height = ph;
    }
    return dpr;
  };

  const draw = useCallback(() => {
    const base = baseRef.current;
    if (!base || !vpRef.current || !sheetRef.current || !scale) return;
    const { ox, oy, w, h } = geometry();
    const dpr = prepare(base, w, h);
    prepare(liveRef.current!, w, h);
    const ctx = base.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, -ox * dpr, -oy * dpr);
    const view = { x0: ox / scale, y0: oy / scale, x1: (ox + w) / scale, y1: (oy + h) / scale };
    drawTemplate(ctx, paper, view.y0 - 20, view.y1 + 20, templateColors(dark), scale);
    const g = gesture.current;
    const moving = g?.kind === 'move' ? g : null;
    strokesRef.current.forEach((st, i) => {
      if (moving && selection.has(i)) {
        const shifted = { ...st, p: st.p.map((v, k) => (k % 3 === 0 ? v + moving.dx : k % 3 === 1 ? v + moving.dy : v)) };
        paintStroke(ctx, shifted, dark, false);
      } else if (intersects(bbox(st), view)) paintStroke(ctx, st, dark);
    });
    const sel = selection.size ? unionBox(strokesRef.current, selection) : null;
    if (sel) {
      ctx.save();
      ctx.setLineDash([6 / scale, 5 / scale]);
      ctx.strokeStyle = dark ? '#ece8df' : '#1a1a1a';
      ctx.lineWidth = 1.4 / scale;
      ctx.strokeRect(sel.x0 - 8 + (moving?.dx ?? 0), sel.y0 - 8 + (moving?.dy ?? 0), sel.x1 - sel.x0 + 16, sel.y1 - sel.y0 + 16);
      ctx.restore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper, dark, scale, selection]);

  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  }, [draw]);

  useLayoutEffect(() => {
    draw();
  }, [draw, strokes, sheetH, vpW, vpH]);

  const drawLive = (st: Stroke | null, hover?: { x: number; y: number }, poly?: number[][]) => {
    const c = liveRef.current;
    if (!c || !vpRef.current) return;
    const { ox, oy, w, h } = geometry();
    const dpr = prepare(c, w, h);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, -ox * dpr, -oy * dpr);
    if (st) paintStroke(ctx, st, dark, false);
    if (poly && poly.length > 1) {
      ctx.save();
      ctx.setLineDash([5 / scale, 5 / scale]);
      ctx.strokeStyle = dark ? '#ece8df' : '#1a1a1a';
      ctx.lineWidth = 1.4 / scale;
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      poly.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.stroke();
      ctx.restore();
    }
    if (hover) {
      ctx.save();
      ctx.beginPath();
      const r = tool.tool === 'eraser' ? 10 : Math.max(1.5, (tool.size * (tool.ink === 'marker' ? 4 : 1.1)) / 2);
      ctx.arc(hover.x, hover.y, r, 0, Math.PI * 2);
      ctx.fillStyle = tool.tool === 'eraser' ? 'rgba(120,120,120,.3)' : tool.color;
      ctx.globalAlpha = 0.4;
      ctx.fill();
      ctx.restore();
    }
  };

  // ---------------------------------------------------------------- zoom

  const zoomAt = useCallback(
    (z: number, clientX: number, clientY: number) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
      if (Math.abs(next - zoom) < 0.001) return;
      const sr = sheetRef.current!.getBoundingClientRect();
      zoomAnchor.current = { lx: (clientX - sr.left) / scale, ly: (clientY - sr.top) / scale, cx: clientX, cy: clientY };
      onZoom(next);
    },
    [zoom, scale, onZoom],
  );

  // Keep the point under the fingers fixed while zooming.
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    if (!a) return;
    zoomAnchor.current = null;
    const sc = scrollerRef.current!;
    const sr = sheetRef.current!.getBoundingClientRect();
    sc.scrollLeft += sr.left + a.lx * scale - a.cx;
    sc.scrollTop += sr.top + a.ly * scale - a.cy;
  }, [scale]);

  useEffect(() => {
    const sc = scrollerRef.current!;
    let start = zoom;
    const onGestureStart = (e: any) => {
      e.preventDefault();
      start = zoom;
    };
    const onGestureChange = (e: any) => {
      e.preventDefault();
      zoomAt(start * e.scale, e.clientX, e.clientY);
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    sc.addEventListener('gesturestart', onGestureStart, { passive: false } as AddEventListenerOptions);
    sc.addEventListener('gesturechange', onGestureChange, { passive: false } as AddEventListenerOptions);
    sc.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      sc.removeEventListener('gesturestart', onGestureStart);
      sc.removeEventListener('gesturechange', onGestureChange);
      sc.removeEventListener('wheel', onWheel);
    };
  }, [zoom, zoomAt]);

  // ---------------------------------------------------------------- touch: palm rejection & two-finger pan

  useEffect(() => {
    const sc = scrollerRef.current!;
    let last: { x: number; y: number; d: number } | null = null;
    const mid = (t: TouchList) => {
      const a = t[0];
      const b = t[1];
      return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
    };
    const onStart = (e: TouchEvent) => {
      const stylus = Array.from(e.changedTouches).some((t: any) => t.touchType === 'stylus');
      if (stylus) return e.preventDefault();
      if (!fingerDrawing) return; // native one-finger scrolling
      e.preventDefault();
      if (e.touches.length >= 2) {
        last = mid(e.touches);
        // A second finger means "navigate", so abandon a stroke the first finger began.
        if (gesture.current?.kind === 'stroke') {
          gesture.current = null;
          drawLive(null);
        }
      }
    };
    const onMove = (e: TouchEvent) => {
      const stylus = Array.from(e.changedTouches).some((t: any) => t.touchType === 'stylus');
      if (stylus) return e.preventDefault();
      if (!fingerDrawing) return;
      e.preventDefault();
      if (e.touches.length >= 2 && last) {
        const m = mid(e.touches);
        sc.scrollLeft -= m.x - last.x;
        sc.scrollTop -= m.y - last.y;
        if (last.d > 0 && Math.abs(m.d / last.d - 1) > 0.01) zoomAt(zoom * (m.d / last.d), m.x, m.y);
        last = m;
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) last = null;
    };
    sc.addEventListener('touchstart', onStart, { passive: false });
    sc.addEventListener('touchmove', onMove, { passive: false });
    sc.addEventListener('touchend', onEnd);
    sc.addEventListener('touchcancel', onEnd);
    return () => {
      sc.removeEventListener('touchstart', onStart);
      sc.removeEventListener('touchmove', onMove);
      sc.removeEventListener('touchend', onEnd);
      sc.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerDrawing, zoom, zoomAt]);

  // ---------------------------------------------------------------- editing

  const commit = (next: Stroke[]) => {
    undo.current.push(strokesRef.current);
    if (undo.current.length > 200) undo.current.shift();
    redo.current = [];
    apply(next);
  };

  const apply = (next: Stroke[]) => {
    strokesRef.current = next;
    setStrokes(next);
    onChange({ strokes: next });
    grow(contentBottom(next));
  };

  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(strokesRef.current);
    setSelection(new Set());
    apply(prev);
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(strokesRef.current);
    apply(next);
  };

  useEffect(() => {
    if (tool.tool !== 'lasso') setSelection(new Set());
  }, [tool.tool]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && selection.size) {
        commit(strokesRef.current.filter((_, i) => !selection.has(i)));
        setSelection(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pos = (e: { clientX: number; clientY: number }) => {
    const sr = sheetRef.current!.getBoundingClientRect();
    return { x: (e.clientX - sr.left) / scale, y: (e.clientY - sr.top) / scale };
  };
  const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 0.5);

  const eraseAt = (g: Extract<Gesture, { kind: 'erase' }>, x: number, y: number) => {
    const before = strokesRef.current;
    const next = before.filter((st) => !hitsStroke(st, x, y, 10 / Math.max(zoom, 0.75)));
    if (next.length === before.length) return;
    if (!g.erased) {
      undo.current.push(before);
      redo.current = [];
      g.erased = true;
    }
    apply(next);
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') {
      touchPointers.current.add(e.pointerId);
      if (!fingerDrawing || touchPointers.current.size > 1) return;
    }
    if (gesture.current) return; // a palm or second contact while drawing
    if (e.button > 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    try {
      liveRef.current!.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
    const { x, y } = pos(e);
    // Barrel button / eraser end on styluses that have one.
    const t: Tool = e.buttons === 32 || e.button === 5 ? 'eraser' : tool.tool;
    if (t === 'eraser') {
      const g: Gesture = { kind: 'erase', id: e.pointerId, erased: false };
      gesture.current = g;
      eraseAt(g, x, y);
      return;
    }
    if (t === 'lasso') {
      const b = selection.size ? unionBox(strokesRef.current, selection) : null;
      if (b && x >= b.x0 - 10 && x <= b.x1 + 10 && y >= b.y0 - 10 && y <= b.y1 + 10) {
        gesture.current = { kind: 'move', id: e.pointerId, x, y, dx: 0, dy: 0 };
      } else {
        setSelection(new Set());
        gesture.current = { kind: 'lasso', id: e.pointerId, poly: [[x, y]] };
      }
      return;
    }
    const stroke: Stroke = { t: tool.ink, c: tool.color, s: tool.size, p: [round(x), round(y), pressureOf(e.nativeEvent)] };
    gesture.current = { kind: 'stroke', id: e.pointerId, stroke };
    drawLive(stroke);
  };

  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) {
      if (e.pointerType === 'pen' && e.buttons === 0) drawLive(null, pos(e)); // Apple Pencil hover
      return;
    }
    if (e.pointerId !== g.id) return;
    const coalesced: PointerEvent[] = (e.nativeEvent as any).getCoalescedEvents?.() ?? [];
    const list = coalesced.length ? coalesced : [e.nativeEvent];
    if (g.kind === 'move') {
      const { x, y } = pos(e);
      g.dx = x - g.x;
      g.dy = y - g.y;
      schedule();
      return;
    }
    if (g.kind === 'lasso') {
      for (const ev of list) {
        const { x, y } = pos(ev);
        g.poly.push([x, y]);
      }
      drawLive(null, undefined, g.poly);
      return;
    }
    if (g.kind === 'erase') {
      for (const ev of list) {
        const { x, y } = pos(ev);
        eraseAt(g, x, y);
      }
      drawLive(null, pos(e));
      return;
    }
    for (const ev of list) {
      const { x, y } = pos(ev);
      g.stroke.p.push(round(x), round(y), pressureOf(ev));
    }
    drawLive(g.stroke);
    const y = g.stroke.p[g.stroke.p.length - 2];
    if (y > heightRef.current - viewLogicalH * 0.35) grow(y, viewLogicalH * 0.5);
  };

  const onUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') touchPointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    gesture.current = null;
    if (g.kind === 'stroke' && g.stroke.p.length >= 3) commit([...strokesRef.current, g.stroke]);
    if (g.kind === 'lasso' && g.poly.length > 3) setSelection(lassoSelect(strokesRef.current, g.poly));
    if (g.kind === 'move' && (g.dx || g.dy)) commit(translateStrokes(strokesRef.current, selection, g.dx, g.dy));
    drawLive(null);
    schedule();
    bump((n) => n + 1);
  };

  const onScroll = () => {
    schedule();
    if (!gesture.current) drawLive(null);
    const sc = scrollerRef.current!;
    // Endless: approaching the end adds more paper.
    if (sc.scrollTop + sc.clientHeight > sc.scrollHeight - sc.clientHeight * 0.6) grow(contentBottom(strokesRef.current), viewLogicalH);
  };

  return (
    <div className={`endless ${dark ? 'dark' : ''}`}>
      <InkToolbar
        className="floating"
        onUndo={doUndo}
        onRedo={doRedo}
        canUndo={undo.current.length > 0}
        canRedo={redo.current.length > 0}
        onDeleteSelection={
          selection.size
            ? () => {
                commit(strokesRef.current.filter((_, i) => !selection.has(i)));
                setSelection(new Set());
              }
            : undefined
        }
      >
        {toolbarExtra}
      </InkToolbar>
      <div
        className="endless-scroller"
        ref={scrollerRef}
        onScroll={onScroll}
        style={{ touchAction: fingerDrawing ? 'none' : 'pan-x pan-y' }}
        data-testid="endless-scroller"
      >
        <div className="endless-pad" style={{ width: padW, height: sheetH + topPad + 48 }}>
          <div
            className={`endless-sheet paper-${paper}`}
            ref={sheetRef}
            style={{ width: sheetW, height: sheetH, marginLeft: (padW - sheetW) / 2, marginTop: topPad }}
            data-paper={paper}
          >
            <div className="endless-viewport" ref={vpRef} style={{ width: vpW, height: vpH }}>
              <canvas ref={baseRef} className="endless-base" style={{ width: vpW, height: vpH }} />
              <canvas
                ref={liveRef}
                className="endless-live"
                style={{ width: vpW, height: vpH, cursor: tool.tool === 'lasso' ? 'crosshair' : 'crosshair' }}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onPointerLeave={() => !gesture.current && drawLive(null)}
                data-testid="endless-live"
              />
            </div>
          </div>
        </div>
      </div>
      {strokes.length === 0 && <div className="endless-hint">Write anywhere with Apple Pencil — the page keeps going.</div>}
    </div>
  );
}
