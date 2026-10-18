import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
import { drawTemplate, endlessHeight, RULE, templateColors, type Paper } from '../lib/paper';
import { recognizeShape } from '../lib/shapes';
import { claimHandoff } from '../lib/penHandoff';
import { useSettings } from '../lib/settings';
import { InkToolbar } from './InkToolbar';

/**
 * The one handwriting surface, as in Apple Notes: a sketch that sits in a
 * note's text, from a doodle between paragraphs to a whole page of writing.
 *
 * Rendering is virtualised: two canvases the size of the *visible* part stick
 * to the note's scroller while the tall sheet scrolls beneath them, and only
 * strokes in view are painted. A single canvas the height of a long page would
 * exceed Safari's ~16 MP canvas limit on iPad and render blank.
 *
 *  - Apple Pencil always draws, and fingers scroll the note (palm rejection),
 *    unless finger drawing is on. The mouse draws once the sketch is selected.
 *  - Hold the Pencil still at the end of a line, circle, triangle or box and
 *    it snaps into a clean shape.
 *  - The sketch grows as you write toward its bottom; a page grows a page at a time.
 */

const SNAP_HOLD_MS = 550;
/** Below this the drag handle won't shrink a sketch. */
const MIN_H = 160;

export interface SketchCanvasProps {
  paper: Paper;
  strokes: Stroke[];
  height: number;
  dark: boolean;
  /** Selected: its tools are out, and the mouse and fingers draw. */
  active: boolean;
  onActivate: () => void;
  onChange: (patch: { strokes?: Stroke[]; height?: number }) => void;
  /** A whole page of handwriting: no frame, grows by pages. */
  page?: boolean;
  /** Take the Pencil stroke that made this sketch (lib/penHandoff). */
  adoptPen?: boolean;
  toolbarExtra?: ReactNode;
}

type Gesture =
  | { kind: 'stroke'; id: number; stroke: Stroke; ruled: boolean; snapped: boolean }
  | { kind: 'erase'; id: number; erased: boolean; lx: number; ly: number }
  | { kind: 'lasso'; id: number; poly: number[][] }
  | { kind: 'move'; id: number; x: number; y: number; dx: number; dy: number }
  | { kind: 'ruler'; id: number; mode: 'move' | 'rotate'; x: number; y: number; flip: boolean }
  | { kind: 'resize'; id: number; y: number; h: number };

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

export function SketchCanvas({ paper, strokes: initial, height: initialHeight, dark, active, onActivate, onChange, page = false, adoptPen = false, toolbarExtra }: SketchCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  /** The note's scroller, which the visible window of the sketch follows. */
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
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
  const holdTimer = useRef(0);
  const frame = useRef(0);

  // The note changed it from outside (its own undo, a restore): follow it.
  useEffect(() => {
    if (initial !== strokesRef.current && !gesture.current) setStrokes(initial);
  }, [initial]);
  useEffect(() => {
    if (initialHeight !== heightRef.current && !gesture.current) setHeight(initialHeight);
  }, [initialHeight]);

  const sheetW = box.cw;
  const scale = sheetW / W;
  const sheetH = height * scale;
  const vpW = sheetW;
  const vpH = Math.min(sheetH, box.ch || sheetH);

  // ---------------------------------------------------------------- sizing

  useLayoutEffect(() => {
    const wrap = wrapRef.current!;
    const scroller = (wrap.closest('.editor-scroll') as HTMLElement | null) ?? document.documentElement;
    scrollerRef.current = scroller;
    setToolbarHost(wrap.closest('.editor-pane') as HTMLElement | null);
    const measure = () => setBox({ cw: wrap.clientWidth, ch: scroller.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(scroller);
    measure();
    return () => ro.disconnect();
  }, []);

  // Through a ref: the parent passes a fresh onChange each render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /** Room below what is written: a page a step of ruling at a time, a sketch a little. */
  const grow = useCallback(
    (bottom: number) => {
      const next = page ? endlessHeight(paper, bottom, 600, heightRef.current) : Math.max(heightRef.current, Math.ceil((bottom + 96) / RULE) * RULE);
      if (next !== heightRef.current) {
        heightRef.current = next;
        setHeight(next);
        onChangeRef.current({ height: next });
      }
    },
    [paper, page],
  );

  // A page always offers room past its writing.
  useEffect(() => {
    if (page) grow(contentBottom(strokesRef.current));
  }, [page, grow]);

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
   * Repaint what is in view. With a `clip` only that patch of it is touched,
   * which is what the eraser wants: rubbing changes a nib's worth of page, and
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
    if (active && rulerRef.current.on) paintRuler(ctx, rulerRef.current, dark, scale);
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
  }, [paper, dark, scale, selection, ruler, active]);

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

  // Repaint as the note scrolls the sketch through the window.
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    const onScroll = () => {
      schedule();
      if (!gesture.current) drawLive(null);
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => sc.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule]);

  // ---------------------------------------------------------------- touch: palm rejection

  useEffect(() => {
    const el = liveRef.current!;
    const block = (e: TouchEvent) => {
      const stylus = Array.from(e.changedTouches).some((t: any) => t.touchType === 'stylus');
      // The Pencil never scrolls the note; a finger does unless it is drawing here.
      if (stylus || (fingerDrawing && active && e.touches.length === 1)) e.preventDefault();
    };
    el.addEventListener('touchstart', block, { passive: false });
    el.addEventListener('touchmove', block, { passive: false });
    return () => {
      el.removeEventListener('touchstart', block);
      el.removeEventListener('touchmove', block);
    };
  }, [fingerDrawing, active]);

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
    if (tool.tool !== 'lasso' || !active) setSelection(new Set());
  }, [tool.tool, active]);

  // While selected, ⌘Z belongs to the sketch, not to the note around it.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) doRedo();
        else doUndo();
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && selection.size) {
        e.preventDefault();
        e.stopPropagation();
        commit(strokesRef.current.filter((_, i) => !selection.has(i)));
        setSelection(new Set());
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const pos = (e: { clientX: number; clientY: number }) => {
    const sr = sheetRef.current!.getBoundingClientRect();
    return { x: (e.clientX - sr.left) / scale, y: (e.clientY - sr.top) / scale };
  };
  const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 0.5);

  /** The eraser's reach, in page units. Object mode stays a fingertip. */
  const eraserR = tool.eraserMode === 'pixel' ? tool.eraserSize : 10;

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
    // Straight to the ref and a frame-coalesced repaint; the state catches up
    // once, when the hand lifts.
    strokesRef.current = next;
    const pad = eraserR + 24;
    schedule({ x0: Math.min(x, px) - pad, y0: Math.min(y, py) - pad, x1: Math.max(x, px) + pad, y1: Math.max(y, py) + pad });
  };

  /** Hold the Pencil still at the end of a shape and it snaps clean. */
  const armSnap = (g: Extract<Gesture, { kind: 'stroke' }>) => {
    window.clearTimeout(holdTimer.current);
    if (g.ruled || g.snapped || g.stroke.t === 'marker') return;
    holdTimer.current = window.setTimeout(() => {
      if (gesture.current !== g) return;
      const shape = recognizeShape(g.stroke.p);
      if (!shape) return;
      g.stroke.p = shape.p;
      g.snapped = true;
      drawLive(g.stroke);
    }, SNAP_HOLD_MS);
  };

  const startStroke = (id: number, x: number, y: number, pressure: number) => {
    const onRuler = active && rulerCatches(ruler, x, y);
    const p0 = onRuler ? snapToRuler(ruler, x, y) : { x, y };
    const stroke: Stroke = { t: tool.ink, c: tool.color, s: tool.size, p: [round(p0.x), round(p0.y), pressure] };
    const g: Gesture = { kind: 'stroke', id, stroke, ruled: onRuler, snapped: false };
    gesture.current = g;
    drawLive(stroke);
    armSnap(g);
    return g;
  };

  const extendStroke = (g: Extract<Gesture, { kind: 'stroke' }>, x: number, y: number, pressure: number) => {
    if (g.snapped) return;
    const n = g.stroke.p.length;
    const q = g.ruled ? snapToRuler(ruler, x, y) : { x, y };
    // Only real movement resets the hold that snaps a shape.
    if (Math.hypot(q.x - g.stroke.p[n - 3], q.y - g.stroke.p[n - 2]) > 1.5) armSnap(g);
    g.stroke.p.push(round(q.x), round(q.y), pressure);
  };

  const endStroke = (g: Extract<Gesture, { kind: 'stroke' }>) => {
    window.clearTimeout(holdTimer.current);
    gesture.current = null;
    if (g.stroke.p.length >= 3) commit([...strokesRef.current, g.stroke]);
    drawLive(null);
  };

  // The Pencil stroke that made this sketch, carried over from the note.
  useEffect(() => {
    if (!adoptPen || !scale) return;
    let g: Extract<Gesture, { kind: 'stroke' }> | null = null;
    let used = 0;
    return claimHandoff((points, done) => {
      for (; used < points.length; used++) {
        const { x, y } = pos({ clientX: points[used].x, clientY: points[used].y });
        if (!g) g = startStroke(-1, x, y, points[used].p);
        else extendStroke(g, x, y, points[used].p);
      }
      if (g) drawLive(g.stroke);
      if (done && g) endStroke(g);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adoptPen, !!scale]);

  const onDown = (e: React.PointerEvent) => {
    if (gesture.current) return; // a palm or second contact while drawing
    if (e.button > 0 && e.pointerType === 'mouse') return;
    // The Pencil always draws. The mouse and a finger first select the sketch,
    // so a finger can still scroll past it and a click can still place the caret.
    if (e.pointerType !== 'pen' && !active) {
      onActivate();
      return;
    }
    if (e.pointerType === 'pen' && !active) onActivate();
    const here = pos(e);
    // The ruler is laid about with a finger or the mouse while the Pencil
    // keeps drawing — the same division of labour as the rest of the canvas.
    if (e.pointerType !== 'pen' && active) {
      const grab = rulerGrab(ruler, here.x, here.y);
      if (grab) {
        e.preventDefault();
        capture(e);
        gesture.current = { kind: 'ruler', id: e.pointerId, mode: grab, x: here.x, y: here.y, flip: rulerFrame(ruler, here.x, here.y).t < 0 };
        return;
      }
    }
    if (e.pointerType === 'touch' && !fingerDrawing) return;
    e.preventDefault();
    capture(e);
    const { x, y } = here;
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
    startStroke(e.pointerId, x, y, pressureOf(e.nativeEvent));
  };

  const capture = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
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
    if (g.kind === 'resize') {
      const min = Math.max(MIN_H, contentBottom(strokesRef.current) + 24);
      const next = Math.max(min, Math.round(g.h + (e.clientY - g.y) / scale));
      heightRef.current = next;
      setHeight(next);
      return;
    }
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
      extendStroke(g, x, y, pressureOf(ev));
    }
    drawLive(g.stroke);
    const y = g.stroke.p[g.stroke.p.length - 2];
    if (y > heightRef.current - 80) grow(y + 160);
  };

  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    if (g.kind === 'stroke') return endStroke(g);
    gesture.current = null;
    if (g.kind === 'resize') onChange({ height: heightRef.current });
    if (g.kind === 'lasso' && g.poly.length > 3) setSelection(lassoSelect(strokesRef.current, g.poly));
    if (g.kind === 'move' && (g.dx || g.dy)) commit(translateStrokes(strokesRef.current, selection, g.dx, g.dy));
    // The erase ran on the ref alone; tell React and the store about it now.
    if (g.kind === 'erase' && g.erased) apply(strokesRef.current);
    drawLive(null);
    schedule();
    bump((n) => n + 1);
  };

  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    capture(e);
    gesture.current = { kind: 'resize', id: e.pointerId, y: e.clientY, h: heightRef.current };
  };

  return (
    <div className={`sketch ${page ? 'page' : ''} ${active ? 'is-active' : ''} ${dark ? 'dark' : ''}`} ref={wrapRef}>
      {active &&
        toolbarHost &&
        createPortal(
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
          </InkToolbar>,
          toolbarHost,
        )}
      <div className={`sketch-sheet paper-${paper}`} ref={sheetRef} style={{ height: sheetH }} data-paper={paper}>
        <div className="sketch-viewport" ref={vpRef} style={{ width: vpW, height: vpH }}>
          <canvas ref={baseRef} className="sketch-base" style={{ width: vpW, height: vpH }} />
          <canvas
            ref={liveRef}
            className="sketch-live"
            style={{ width: vpW, height: vpH, cursor: active ? 'crosshair' : 'default', touchAction: fingerDrawing && active ? 'none' : 'pan-x pan-y' }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={() => !gesture.current && drawLive(null)}
            data-testid="sketch-live"
          />
        </div>
        {strokes.length === 0 && <div className="sketch-hint">{page ? 'Write anywhere with Apple Pencil — the page keeps going.' : 'Draw here with Apple Pencil'}</div>}
      </div>
      {active && !page && <div className="sketch-resize" onPointerDown={onResizeDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role="separator" aria-label="Drag to resize the sketch" />}
    </div>
  );
}
