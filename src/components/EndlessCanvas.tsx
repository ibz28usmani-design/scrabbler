import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  bbox,
  contentBottom,
  erasePixelsAll,
  hitsStroke,
  intersects,
  lassoSelect,
  paintStroke,
  round,
  RULER_HALF_W,
  RULER_LEN,
  rulerAxis,
  rulerCatches,
  rulerFrame,
  rulerGrab,
  setRuler,
  snapToRuler,
  tidyAngle,
  translateStrokes,
  unionBox,
  useRuler,
  useTool,
  W,
  type Ruler,
  type Stroke,
  type Tool,
} from '../lib/ink';
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
  | { kind: 'stroke'; id: number; stroke: Stroke; ruled: boolean }
  | { kind: 'erase'; id: number; erased: boolean; lx: number; ly: number }
  | { kind: 'lasso'; id: number; poly: number[][] }
  | { kind: 'move'; id: number; x: number; y: number; dx: number; dy: number }
  | { kind: 'ruler'; id: number; mode: 'move' | 'rotate'; x: number; y: number; flip: boolean };

/** The straightedge itself: a translucent blade, ticks, and its angle. */
function paintRuler(ctx: CanvasRenderingContext2D, r: Ruler, dark: boolean, scale: number) {
  const { ux, uy } = rulerAxis(r);
  const px = (n: number) => n / scale;
  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.rotate(Math.atan2(uy, ux));
  const h = RULER_LEN / 2;
  ctx.fillStyle = dark ? 'rgba(236,232,223,.14)' : 'rgba(31,31,31,.10)';
  ctx.strokeStyle = dark ? 'rgba(236,232,223,.5)' : 'rgba(31,31,31,.42)';
  ctx.lineWidth = px(1);
  ctx.beginPath();
  ctx.roundRect(-h, -RULER_HALF_W, RULER_LEN, RULER_HALF_W * 2, px(6));
  ctx.fill();
  ctx.stroke();
  // Ticks run off one edge, as on a real rule, so which edge you are drawing
  // along is never in doubt.
  ctx.beginPath();
  for (let d = -h; d <= h + 0.01; d += 20) {
    const long = Math.round((d + h) / 20) % 5 === 0;
    ctx.moveTo(d, RULER_HALF_W);
    ctx.lineTo(d, RULER_HALF_W - (long ? 11 : 6));
  }
  ctx.stroke();
  // Grips at the ends, where a finger turns it.
  for (const d of [-h + 16, h - 16]) {
    ctx.beginPath();
    ctx.arc(d, 0, px(5), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  // The angle, upright wherever the ruler points.
  ctx.save();
  ctx.translate(r.x - uy * (RULER_HALF_W + px(18)), r.y + ux * (RULER_HALF_W + px(18)));
  ctx.fillStyle = dark ? 'rgba(236,232,223,.78)' : 'rgba(31,31,31,.7)';
  ctx.font = `${px(13)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.round(((r.angle % 180) + 180) % 180)}°`, 0, 0);
  ctx.restore();
}

export function EndlessCanvas({ paper, strokes: initial, height: initialHeight, dark, zoom, onZoom, onChange, toolbarExtra }: EndlessCanvasProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const tool = useTool();
  const ruler = useRuler();
  // The pointer handlers are rebuilt every render, but `draw` is memoised and
  // must not be: read the ruler through a ref so a nudge repaints without
  // rebuilding the whole draw path.
  const rulerRef = useRef(ruler);
  rulerRef.current = ruler;
  const { fingerDrawing } = useSettings();

  const [strokes, setStrokes] = useState<Stroke[]>(initial);
  const [height, setHeight] = useState(initialHeight);
  const [box, setBox] = useState({ cw: 0, ch: 0 });
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [, bump] = useState(0);
  const strokesRef = useRef(strokes);
  // Follow the state only when it changes: the eraser writes the ref ahead of
  // the state mid-gesture, and an unrelated render then must not undo that.
  const seenStrokes = useRef(strokes);
  if (seenStrokes.current !== strokes) {
    seenStrokes.current = strokes;
    strokesRef.current = strokes;
  }
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
  // Through a ref: the parent passes a fresh onChange each render, which would
  // rebuild grow and re-walk every stroke in the effect below on every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const grow = useCallback(
    (bottom: number, minExtra = 0) => {
      const next = endlessHeight(paper, bottom, Math.max(viewLogicalH, 600), heightRef.current + minExtra);
      if (next !== heightRef.current) {
        heightRef.current = next;
        setHeight(next);
        onChangeRef.current({ height: next });
      }
    },
    [paper, viewLogicalH],
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

  /**
   * Repaint the page. With a `clip` only that patch of it is touched, which
   * is what the eraser wants: rubbing changes a nib's worth of page, and
   * redrawing all of it per frame cost 26ms a frame on a busy one.
   */
  const draw = useCallback((clip?: { x0: number; y0: number; x1: number; y1: number }) => {
    const base = baseRef.current;
    if (!base || !vpRef.current || !sheetRef.current || !scale) return;
    const { ox, oy, w, h } = geometry();
    const dpr = prepare(base, w, h);
    prepare(liveRef.current!, w, h);
    const ctx = base.getContext('2d')!;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, -ox * dpr, -oy * dpr);
    const whole = { x0: ox / scale, y0: oy / scale, x1: (ox + w) / scale, y1: (oy + h) / scale };
    const view = clip
      ? { x0: Math.max(whole.x0, clip.x0), y0: Math.max(whole.y0, clip.y0), x1: Math.min(whole.x1, clip.x1), y1: Math.min(whole.y1, clip.y1) }
      : whole;
    if (view.x1 <= view.x0 || view.y1 <= view.y0) return;
    ctx.save();
    if (clip) {
      ctx.beginPath();
      ctx.rect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
      ctx.clip();
    }
    ctx.clearRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    drawTemplate(ctx, paper, view.y0 - 20, view.y1 + 20, templateColors(dark), scale);
    const g = gesture.current;
    const moving = g?.kind === 'move' ? g : null;
    strokesRef.current.forEach((st, i) => {
      if (moving && selection.has(i)) {
        const shifted = { ...st, p: st.p.map((v, k) => (k % 3 === 0 ? v + moving.dx : k % 3 === 1 ? v + moving.dy : v)) };
        paintStroke(ctx, shifted, dark, false);
      } else if (intersects(bbox(st), view)) paintStroke(ctx, st, dark);
    });
    if (rulerRef.current.on) paintRuler(ctx, rulerRef.current, dark, scale);
    const sel = selection.size ? unionBox(strokesRef.current, selection) : null;
    if (sel) {
      ctx.save();
      ctx.setLineDash([6 / scale, 5 / scale]);
      ctx.strokeStyle = dark ? '#ece8df' : '#1a1a1a';
      ctx.lineWidth = 1.4 / scale;
      ctx.strokeRect(sel.x0 - 8 + (moving?.dx ?? 0), sel.y0 - 8 + (moving?.dy ?? 0), sel.x1 - sel.x0 + 16, sel.y1 - sel.y0 + 16);
      ctx.restore();
    }
    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper, dark, scale, selection, ruler]);

  /** Pending clip for the next frame; several nudges in one frame merge. */
  const clipRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const schedule = useCallback(
    (clip?: { x0: number; y0: number; x1: number; y1: number }) => {
      if (!clip) clipRef.current = null;
      else if (clipRef.current) {
        const c = clipRef.current;
        clipRef.current = { x0: Math.min(c.x0, clip.x0), y0: Math.min(c.y0, clip.y0), x1: Math.max(c.x1, clip.x1), y1: Math.max(c.y1, clip.y1) };
      } else clipRef.current = clip;
      cancelAnimationFrame(frame.current);
      const only = clip ? clipRef.current : null;
      frame.current = requestAnimationFrame(() => {
        clipRef.current = null;
        draw(only ?? undefined);
      });
    },
    [draw],
  );

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
      const r = tool.tool === 'eraser' ? eraserR : Math.max(1.5, (tool.size * (tool.ink === 'marker' ? 4 : 1.1)) / 2);
      ctx.arc(hover.x, hover.y, r, 0, Math.PI * 2);
      if (tool.tool === 'eraser') {
        // An outline, not a blob: at 44 units a filled disc hides the very ink
        // you are aiming at.
        ctx.fillStyle = dark ? 'rgba(236,232,223,.12)' : 'rgba(31,31,31,.08)';
        ctx.strokeStyle = dark ? 'rgba(236,232,223,.65)' : 'rgba(31,31,31,.5)';
        ctx.lineWidth = 1.2 / scale;
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = tool.color;
        ctx.globalAlpha = 0.4;
        ctx.fill();
      }
      ctx.restore();
    }
  };

  // ---------------------------------------------------------------- zoom

  // Gestures read these rather than re-subscribing on every zoom step, which
  // would reset a pinch's starting point mid-gesture and make it run away.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;
  const zoomAt = useCallback((z: number, clientX: number, clientY: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    if (Math.abs(next - zoomRef.current) < 0.001) return;
    const sr = sheetRef.current!.getBoundingClientRect();
    const sc = scaleRef.current;
    zoomAnchor.current = { lx: (clientX - sr.left) / sc, ly: (clientY - sr.top) / sc, cx: clientX, cy: clientY };
    // Steps before the next render build on this one, not on the last rendered zoom.
    zoomRef.current = next;
    onZoomRef.current(next);
  }, []);

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
    let start = zoomRef.current;
    const onGestureStart = (e: any) => {
      e.preventDefault();
      start = zoomRef.current;
    };
    const onGestureChange = (e: any) => {
      e.preventDefault();
      zoomAt(start * e.scale, e.clientX, e.clientY);
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(zoomRef.current * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    sc.addEventListener('gesturestart', onGestureStart, { passive: false } as AddEventListenerOptions);
    sc.addEventListener('gesturechange', onGestureChange, { passive: false } as AddEventListenerOptions);
    sc.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      sc.removeEventListener('gesturestart', onGestureStart);
      sc.removeEventListener('gesturechange', onGestureChange);
      sc.removeEventListener('wheel', onWheel);
    };
  }, [zoomAt]);

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
        if (last.d > 0 && Math.abs(m.d / last.d - 1) > 0.01) zoomAt(zoomRef.current * (m.d / last.d), m.x, m.y);
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
  }, [fingerDrawing, zoomAt]);

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
      if ((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return;
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

  /** The eraser's reach, in page units. Object mode stays a fingertip. */
  const eraserR = tool.eraserMode === 'pixel' ? tool.eraserSize : 10 / Math.max(zoom, 0.75);

  const eraseAt = (g: Extract<Gesture, { kind: 'erase' }>, x: number, y: number) => {
    // A pointer reports far more often than the nib moves anywhere new, and
    // each sample walks every stroke on the page. Overlapping discs look
    // identical, so only act once the nib has actually moved on.
    const step = Math.max(2, eraserR / 3);
    if (g.erased && Math.hypot(x - g.lx, y - g.ly) < step) return;
    const px = g.lx;
    const py = g.ly;
    const before = strokesRef.current;
    const next =
      tool.eraserMode === 'pixel'
        ? erasePixelsAll(before, x, y, eraserR)
        : (() => {
            const kept = before.filter((st) => !hitsStroke(st, x, y, eraserR));
            return kept.length === before.length ? null : kept;
          })();
    g.lx = x;
    g.ly = y;
    if (!next) return;
    if (!g.erased) {
      undo.current.push(before);
      redo.current = [];
      g.erased = true;
    }
    // Straight to the ref and a frame-coalesced repaint. Going through React
    // for every sample meant a render, a save and a walk of every point on the
    // page per sample: 26ms a frame on a busy page, and visibly dropped ones.
    // The state catches up once, when the hand lifts.
    strokesRef.current = next;
    // Only the patch the nib swept since the last sample has changed. Pad it
    // by the widest stroke so a half-drawn cap cannot be left behind.
    const pad = eraserR + 24;
    schedule({ x0: Math.min(x, px) - pad, y0: Math.min(y, py) - pad, x1: Math.max(x, px) + pad, y1: Math.max(y, py) + pad });
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') touchPointers.current.add(e.pointerId);
    if (gesture.current) return; // a palm or second contact while drawing
    if (e.button > 0 && e.pointerType === 'mouse') return;
    const here = pos(e);
    // The ruler is laid about with a finger or the mouse while the Pencil
    // keeps drawing — the same division of labour as the rest of the canvas.
    // A second finger is a pinch, not a grab.
    if (e.pointerType !== 'pen' && !(e.pointerType === 'touch' && touchPointers.current.size > 1)) {
      const grab = rulerGrab(ruler, here.x, here.y);
      if (grab) {
        e.preventDefault();
        try {
          liveRef.current!.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic or already-released pointer */
        }
        gesture.current = { kind: 'ruler', id: e.pointerId, mode: grab, x: here.x, y: here.y, flip: rulerFrame(ruler, here.x, here.y).t < 0 };
        return;
      }
    }
    if (e.pointerType === 'touch' && (!fingerDrawing || touchPointers.current.size > 1)) return;
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
      const g: Gesture = { kind: 'erase', id: e.pointerId, erased: false, lx: x, ly: y };
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
    const onRuler = rulerCatches(ruler, x, y);
    const p0 = onRuler ? snapToRuler(ruler, x, y) : { x, y };
    const stroke: Stroke = { t: tool.ink, c: tool.color, s: tool.size, p: [round(p0.x), round(p0.y), pressureOf(e.nativeEvent)] };
    gesture.current = { kind: 'stroke', id: e.pointerId, stroke, ruled: onRuler };
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
    if (g.kind === 'ruler') {
      const { x, y } = pos(e);
      if (g.mode === 'move') {
        setRuler({ x: ruler.x + (x - g.x), y: ruler.y + (y - g.y) });
        g.x = x;
        g.y = y;
      } else {
        // Turn about the middle; the end you are not holding leads.
        const deg = (Math.atan2(y - ruler.y, x - ruler.x) * 180) / Math.PI + (g.flip ? 180 : 0);
        setRuler({ angle: tidyAngle(deg) });
      }
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
      const q = g.ruled ? snapToRuler(ruler, x, y) : { x, y };
      g.stroke.p.push(round(q.x), round(q.y), pressureOf(ev));
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
    // The erase ran on the ref alone; tell React and the store about it now.
    if (g.kind === 'erase' && g.erased) apply(strokesRef.current);
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
        floating
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
                style={{ width: vpW, height: vpH, cursor: 'crosshair' }}
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
