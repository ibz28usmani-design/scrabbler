/**
 * Ink geometry shared by the endless handwriting canvas, inline sketches,
 * transcription and every export (canvas, SVG, PDF). One definition means a
 * stroke looks the same on screen, in a PDF and in a PNG.
 *
 * Coordinates are in a logical space 1000 units wide; screens scale them.
 */
import { getStroke } from 'perfect-freehand';
import { useSyncExternalStore } from 'react';

export const W = 1000;

export type Tool = 'pen' | 'pencil' | 'marker' | 'eraser' | 'lasso';
export type InkTool = Exclude<Tool, 'eraser' | 'lasso'>;

export interface Stroke {
  t: InkTool;
  c: string;
  s: number;
  /** flattened x,y,pressure triples */
  p: number[];
}

/** Charcoal is the default ink; it renders as chalk on the dark theme. */
export const CHARCOAL = '#1f1f1f';
const LEGACY_BLACKS = new Set(['#1c1c1e', '#000000', '#1f1f1f', '#111111']);

export const INK_PALETTE: { c: string; name: string }[] = [
  { c: CHARCOAL, name: 'Charcoal' },
  { c: '#5c5c5c', name: 'Graphite' },
  { c: '#1d3557', name: 'Navy' },
  { c: '#8a1c1c', name: 'Oxblood' },
  { c: '#2d5a3d', name: 'Forest' },
  { c: '#a0661d', name: 'Sepia' },
];

export const HIGHLIGHTS: { c: string; name: string }[] = [
  { c: '#ffd60a', name: 'Yellow' },
  { c: '#7bdff2', name: 'Blue' },
  { c: '#b9fbc0', name: 'Green' },
  { c: '#ffadad', name: 'Rose' },
];

// ---------------------------------------------------------------- tool state

/** Each tool remembers its own colour and size, like PencilKit's picker. */
interface ToolState {
  tool: Tool;
  colors: Record<InkTool, string>;
  sizes: Record<InkTool, number>;
}

const toolState: ToolState = {
  tool: 'pen',
  colors: { pen: CHARCOAL, pencil: '#3a3a3a', marker: '#ffd60a' },
  sizes: { pen: 3, pencil: 3, marker: 5 },
};
let toolSnapshot = snapshot();
const toolListeners = new Set<() => void>();

function snapshot() {
  const t = toolState.tool;
  const ink: InkTool = t === 'eraser' || t === 'lasso' ? 'pen' : t;
  return { ...toolState, ink, color: toolState.colors[ink], size: toolState.sizes[ink] };
}

export function setTool(tool: Tool) {
  toolState.tool = tool;
  toolSnapshot = snapshot();
  toolListeners.forEach((l) => l());
}

export function setToolColor(c: string) {
  const ink = toolSnapshot.ink;
  toolState.colors[ink] = c;
  if (toolState.tool === 'eraser' || toolState.tool === 'lasso') toolState.tool = ink;
  toolSnapshot = snapshot();
  toolListeners.forEach((l) => l());
}

export function setToolSize(s: number) {
  toolState.sizes[toolSnapshot.ink] = s;
  toolSnapshot = snapshot();
  toolListeners.forEach((l) => l());
}

export function useTool() {
  return useSyncExternalStore(
    (cb) => {
      toolListeners.add(cb);
      return () => toolListeners.delete(cb);
    },
    () => toolSnapshot,
  );
}

// ---------------------------------------------------------------- geometry

function optionsFor(st: Stroke, last: boolean) {
  const base = { last, simulatePressure: false, smoothing: 0.55, streamline: 0.45 };
  switch (st.t) {
    case 'pencil':
      return { ...base, size: st.s * 0.95, thinning: 0.7, streamline: 0.32 };
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

export function outline(st: Stroke, last = true): number[][] {
  return getStroke(toPoints(st.p), optionsFor(st, last));
}

/** SVG path data for a stroke outline — used by SVG and PDF exports. */
export function svgPath(st: Stroke, dx = 0, dy = 0): string {
  const o = outline(st);
  if (!o.length) return '';
  const f = (n: number) => (Math.round(n * 100) / 100).toString();
  let d = `M${f(o[0][0] + dx)} ${f(o[0][1] + dy)}`;
  for (let i = 1; i < o.length - 1; i++) {
    const [x0, y0] = o[i];
    const [x1, y1] = o[i + 1];
    d += ` Q${f(x0 + dx)} ${f(y0 + dy)} ${f((x0 + x1) / 2 + dx)} ${f((y0 + y1) / 2 + dy)}`;
  }
  return d + ' Z';
}

const pathCache = new WeakMap<Stroke, Path2D>();

/** Cached per stroke object, so redrawing on scroll costs no recomputation. */
export function strokePath(st: Stroke, last = true): Path2D {
  if (last) {
    const hit = pathCache.get(st);
    if (hit) return hit;
  }
  const o = outline(st, last);
  const path = new Path2D();
  if (o.length) {
    path.moveTo(o[0][0], o[0][1]);
    for (let i = 1; i < o.length - 1; i++) {
      const [x0, y0] = o[i];
      const [x1, y1] = o[i + 1];
      path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    path.closePath();
  }
  if (last) pathCache.set(st, path);
  return path;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const boxCache = new WeakMap<Stroke, Box>();

export function bbox(st: Stroke): Box {
  const hit = boxCache.get(st);
  if (hit) return hit;
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
  const pad = st.s * (st.t === 'marker' ? 2.2 : 1.2);
  const box = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  boxCache.set(st, box);
  return box;
}

export function unionBox(strokes: Stroke[], pick?: Set<number>): Box | null {
  let b: Box | null = null;
  strokes.forEach((s, i) => {
    if (pick && !pick.has(i)) return;
    const bb = bbox(s);
    b = b ? { x0: Math.min(b.x0, bb.x0), y0: Math.min(b.y0, bb.y0), x1: Math.max(b.x1, bb.x1), y1: Math.max(b.y1, bb.y1) } : { ...bb };
  });
  return b;
}

export function contentBottom(strokes: Stroke[]): number {
  let y = 0;
  for (const s of strokes) y = Math.max(y, bbox(s).y1);
  return y;
}

export function intersects(a: Box, b: Box) {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}

export function hitsStroke(st: Stroke, x: number, y: number, r: number) {
  const b = bbox(st);
  if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) return false;
  const rr = (r + st.s) ** 2;
  for (let i = 0; i < st.p.length; i += 3) {
    const dx = st.p[i] - x;
    const dy = st.p[i + 1] - y;
    if (dx * dx + dy * dy <= rr) return true;
    // Also test the segment to the next point so fast strokes can be erased.
    if (i + 3 < st.p.length) {
      const ax = st.p[i],
        ay = st.p[i + 1],
        bx = st.p[i + 3],
        by = st.p[i + 4];
      const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
      if (l2 > 0) {
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2));
        if ((ax + t * (bx - ax) - x) ** 2 + (ay + t * (by - ay) - y) ** 2 <= rr) return true;
      }
    }
  }
  return false;
}

export function pointInPoly(x: number, y: number, poly: number[][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Strokes mostly inside a lasso polygon. */
export function lassoSelect(strokes: Stroke[], poly: number[][]): Set<number> {
  const sel = new Set<number>();
  strokes.forEach((st, i) => {
    let inside = 0;
    let n = 0;
    for (let k = 0; k < st.p.length; k += 9) {
      n++;
      if (pointInPoly(st.p[k], st.p[k + 1], poly)) inside++;
    }
    if (n && inside / n > 0.5) sel.add(i);
  });
  return sel;
}

export function translateStrokes(strokes: Stroke[], sel: Set<number>, dx: number, dy: number): Stroke[] {
  return strokes.map((st, i) => (sel.has(i) ? { ...st, p: st.p.map((v, k) => (k % 3 === 0 ? round(v + dx) : k % 3 === 1 ? round(v + dy) : v)) } : st));
}

export const round = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- painting

/** Ink colour as it should appear on the current paper. */
export function displayColor(c: string, dark: boolean): string {
  if (dark && LEGACY_BLACKS.has(c.toLowerCase())) return '#ece8df';
  if (!dark && c.toLowerCase() === '#ffffff') return '#d4d4d8';
  return c;
}

const grainCache = new Map<string, CanvasPattern>();

/** A graphite texture: the colour with randomised alpha, so pencil reads as pencil. */
function grain(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | string {
  const hit = grainCache.get(color);
  if (hit) return hit;
  if (typeof document === 'undefined') return color;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, 64, 64);
  const img = g.getImageData(0, 0, 64, 64);
  // Deterministic noise so the texture doesn't shimmer between redraws.
  let seed = 7;
  for (let i = 3; i < img.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    img.data[i] = 120 + ((seed % 1000) / 1000) * 135;
  }
  g.putImageData(img, 0, 0);
  const pat = ctx.createPattern(c, 'repeat');
  if (!pat) return color;
  grainCache.set(color, pat);
  return pat;
}

export function paintStroke(ctx: CanvasRenderingContext2D, st: Stroke, dark: boolean, last = true) {
  ctx.save();
  const color = displayColor(st.c, dark);
  if (st.t === 'marker') {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.34;
    ctx.globalCompositeOperation = dark ? 'screen' : 'multiply';
  } else if (st.t === 'pencil') {
    ctx.fillStyle = grain(ctx, color);
    ctx.globalAlpha = 0.9;
  } else {
    ctx.fillStyle = color;
  }
  ctx.fill(strokePath(st, last));
  ctx.restore();
}
