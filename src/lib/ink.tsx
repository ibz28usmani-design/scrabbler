import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { getStroke } from 'perfect-freehand';
import { Pen, Pencil, Highlighter, Eraser, Undo2, Redo2, Lasso, Ruler, Trash2 } from 'lucide-react';
import type { Stroke } from './db';
import { recognizeShape } from './shapes';
import { IB } from './ui';

export type Tool = { kind: 'pen' | 'pencil' | 'hl' | 'eraser' | 'lasso'; color: string; size: number; ruler?: boolean };
export const INK_COLORS = ['ink', '#d64933', '#2f6fb3', '#1f8a70', '#e0a100', '#8e5bb5'];
export const defaultTool: Tool = { kind: 'pen', color: 'ink', size: 4 };

const cache = new WeakMap<Stroke, string>();
export function pathOf(s: Stroke) {
  let d = cache.get(s);
  if (d) return d;
  const o = getStroke(s.pts, {
    size: s.tool === 'hl' ? s.size * 4 : s.size, thinning: s.tool === 'hl' ? 0 : s.tool === 'pencil' ? 0.3 : 0.6,
    smoothing: 0.5, streamline: 0.45, simulatePressure: !!s.sp,
  });
  if (!o.length) return '';
  const r = (n: number) => Math.round(n * 10) / 10;
  d = `M${r(o[0][0])},${r(o[0][1])}Q`;
  for (let i = 0; i < o.length; i++) {
    const [x0, y0] = o[i], [x1, y1] = o[(i + 1) % o.length];
    d += `${r(x0)},${r(y0)} ${r((x0 + x1) / 2)},${r((y0 + y1) / 2)} `;
  }
  d += 'Z';
  cache.set(s, d);
  return d;
}
const opacity = (s: Stroke) => (s.tool === 'hl' ? 0.35 : s.tool === 'pencil' ? 0.75 : 1);
const fill = (c: string) => (c === 'ink' ? 'currentColor' : c);
const bounds = (list: Stroke[]) => {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const s of list) for (const [x, y] of s.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
};
const inside = (poly: number[][], [x, y]: number[]) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
/** A straight stroke from a to b with even pressure. */
const straight = (a: number[], b: number[]) => Array.from({ length: 13 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / 12, a[1] + ((b[1] - a[1]) * i) / 12, 0.5]);

/** Handwriting as a PNG (base64, no prefix), cropped to the strokes, for AI to read. */
export function inkPng(strokes: Stroke[]): string {
  const { x0, y0, x1, y1 } = bounds(strokes);
  const c = document.createElement('canvas');
  c.width = Math.min(1600, x1 - x0 + 40); c.height = Math.min(4000, y1 - y0 + 40);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.translate(20 - x0, 20 - y0);
  for (const s of strokes) { g.globalAlpha = opacity(s); g.fillStyle = s.color === 'ink' ? '#111' : s.color; g.fill(new Path2D(pathOf(s))); }
  return c.toDataURL('image/png').split(',')[1];
}
/** Handwriting as a standalone SVG file. */
export function inkSvg(strokes: Stroke[]): string {
  const { x0, y0, x1, y1 } = bounds(strokes);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0 - 20} ${y0 - 20} ${x1 - x0 + 40} ${y1 - y0 + 40}">${strokes.map(s => `<path d="${pathOf(s)}" fill="${s.color === 'ink' ? '#111' : s.color}" opacity="${opacity(s)}"/>`).join('')}</svg>`;
}

export type InkHandle = { undo: () => void; redo: () => void; del: () => void };
type Props = { strokes: Stroke[]; onChange: (s: Stroke[]) => void; w: number; h?: number; active: boolean; tool: Tool; onExtend?: () => void };

let penSeen = false;
export const Ink = forwardRef<InkHandle, Props>(function Ink({ strokes, onChange, w, active, tool, onExtend }, ref) {
  const svg = useRef<SVGSVGElement>(null), live = useRef<SVGPathElement>(null);
  const cur = useRef<Stroke | null>(null), scroll = useRef<{ y: number; el: Element | null } | null>(null);
  const hold = useRef({ t: 0, x: 0, y: 0 }), lasso = useRef<number[][] | null>(null), moveFrom = useRef<number[] | null>(null);
  const undo = useRef<Stroke[][]>([]), redo = useRef<Stroke[][]>([]), latest = useRef(strokes);
  const [sel, setSel] = useState<number[]>([]);
  const [off, setOff] = useState<[number, number] | null>(null);
  latest.current = strokes;
  useEffect(() => { setSel([]); }, [strokes.length, tool.kind]);
  const commit = (next: Stroke[]) => { undo.current.push(latest.current); if (undo.current.length > 60) undo.current.shift(); redo.current = []; latest.current = next; onChange(next); };
  useImperativeHandle(ref, () => ({
    undo: () => { const p = undo.current.pop(); if (p) { redo.current.push(latest.current); latest.current = p; onChange(p); } },
    redo: () => { const p = redo.current.pop(); if (p) { undo.current.push(latest.current); latest.current = p; onChange(p); } },
    del: () => { if (sel.length) commit(latest.current.filter((_, i) => !sel.includes(i))); },
  }));
  const pt = (e: { clientX: number; clientY: number; pressure: number }) => {
    const r = svg.current!.getBoundingClientRect(), k = w / r.width;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k, e.pressure || 0.5];
  };
  const erase = (p: number[]) => {
    const next = latest.current.filter(s => !s.pts.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 14 + s.size));
    if (next.length !== latest.current.length) commit(next);
  };
  const box = sel.length ? bounds(sel.map(i => strokes[i]).filter(Boolean)) : null;
  const setLive = (d: string, dashed = false, color = 'currentColor', op = 1) => {
    const l = live.current; if (!l) return;
    l.setAttribute('d', d); l.setAttribute('fill', dashed ? 'none' : color); l.setAttribute('stroke', dashed ? 'currentColor' : 'none');
    l.setAttribute('stroke-dasharray', dashed ? '6 5' : ''); l.setAttribute('opacity', String(op));
  };
  const down = (e: React.PointerEvent) => {
    if (!active) return;
    if (e.pointerType === 'pen') penSeen = true;
    if (e.pointerType === 'touch' && penSeen) { scroll.current = { y: e.clientY, el: svg.current!.closest('.scroller') }; return; }
    e.preventDefault(); svg.current!.setPointerCapture(e.pointerId);
    const p = pt(e);
    if (tool.kind === 'lasso') {
      if (box && p[0] > box.x0 - 10 && p[0] < box.x1 + 10 && p[1] > box.y0 - 10 && p[1] < box.y1 + 10) moveFrom.current = p;
      else { setSel([]); lasso.current = [p]; }
      return;
    }
    if (tool.kind === 'eraser') { cur.current = { pts: [], color: '', size: 0, tool: 'pen' }; erase(p); return; }
    cur.current = { pts: [p], color: tool.color, size: tool.size, tool: tool.kind, sp: e.pointerType !== 'pen' };
    hold.current = { t: Date.now(), x: p[0], y: p[1] };
  };
  const move = (e: React.PointerEvent) => {
    if (scroll.current) { scroll.current.el?.scrollBy(0, scroll.current.y - e.clientY); scroll.current.y = e.clientY; return; }
    const p = pt(e);
    if (moveFrom.current) return setOff([p[0] - moveFrom.current[0], p[1] - moveFrom.current[1]]);
    if (lasso.current) { lasso.current.push(p); return setLive('M' + lasso.current.map(q => `${q[0]},${q[1]}`).join('L') + 'Z', true); }
    const c = cur.current; if (!c) return;
    if (tool.kind === 'eraser') return erase(p);
    if (Math.hypot(p[0] - hold.current.x, p[1] - hold.current.y) > 4) hold.current = { t: Date.now(), x: p[0], y: p[1] };
    if (tool.ruler) c.pts = straight(c.pts[0], p);
    else { const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() || []; for (const ev of evs.length ? evs : [e]) c.pts.push(pt(ev)); }
    cache.delete(c); setLive(pathOf(c), false, fill(c.color), opacity(c));
  };
  const up = () => {
    scroll.current = null;
    if (moveFrom.current) {
      moveFrom.current = null;
      if (off) commit(latest.current.map((s, i) => (sel.includes(i) ? { ...s, pts: s.pts.map(q => [q[0] + off[0], q[1] + off[1], q[2]]) } : s)));
      return setOff(null);
    }
    if (lasso.current) {
      const poly = lasso.current; lasso.current = null; setLive('');
      if (poly.length > 4) setSel(latest.current.map((s, i) => (s.pts.filter(q => inside(poly, q)).length > s.pts.length * 0.6 ? i : -1)).filter(i => i >= 0));
      return;
    }
    const c = cur.current; cur.current = null;
    if (!c || tool.kind === 'eraser') return;
    setLive(''); cache.delete(c);
    if (tool.ruler) c.sp = false;
    else if (Date.now() - hold.current.t > 500 && c.pts.length >= 6) { // held still at the end: snap to a clean shape
      const shape = recognizeShape(c.pts.flat());
      if (shape) { c.pts = Array.from({ length: shape.p.length / 3 }, (_, i) => shape.p.slice(i * 3, i * 3 + 3)); c.sp = false; }
    }
    commit([...latest.current, c]);
    const r = svg.current!.getBoundingClientRect();
    if (onExtend && Math.max(...c.pts.map(q => q[1])) > (r.height * w) / r.width - 180) onExtend();
  };
  const path = (s: Stroke, i: number) => <path key={i} d={pathOf(s)} fill={fill(s.color)} opacity={opacity(s)} />;
  return (
    <svg ref={svg} className={'ink' + (active ? ' active' : '')} style={{ width: w }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {strokes.map((s, i) => (sel.includes(i) ? null : path(s, i)))}
      {box && <g transform={off ? `translate(${off[0]},${off[1]})` : undefined}>
        {sel.map(i => strokes[i] && path(strokes[i], i))}
        <rect className="sel-box" x={box.x0 - 8} y={box.y0 - 8} width={box.x1 - box.x0 + 16} height={box.y1 - box.y0 + 16} />
      </g>}
      <path ref={live} />
    </svg>
  );
});

export function InkBar({ tool, setTool, ink }: { tool: Tool; setTool: (t: Tool) => void; ink: React.RefObject<InkHandle | null> }) {
  const kinds = [['pen', Pen, 'Pen'], ['pencil', Pencil, 'Pencil'], ['hl', Highlighter, 'Highlighter'], ['eraser', Eraser, 'Eraser'], ['lasso', Lasso, 'Lasso: circle strokes, then drag to move']] as const;
  return (
    <div className="row bar-group">
      {kinds.map(([k, I, name]) => <IB key={k} title={name} on={tool.kind === k} onClick={() => setTool({ ...tool, kind: k })}><I size={17} /></IB>)}
      <IB title="Ruler: draw straight lines" on={tool.ruler} onClick={() => setTool({ ...tool, ruler: !tool.ruler })}><Ruler size={17} /></IB>
      {tool.kind === 'lasso' && <IB title="Delete selection" onClick={() => ink.current?.del()}><Trash2 size={17} /></IB>}
      <span className="sep" />
      {INK_COLORS.map(c => <button key={c} className={'swatch' + (tool.color === c ? ' on' : '')} aria-label={'Colour ' + c} style={{ background: c === 'ink' ? 'var(--ink)' : c }} onClick={() => setTool({ ...tool, color: c })} />)}
      <span className="sep" />
      {[2, 4, 7].map(s => <button key={s} className={'ib' + (tool.size === s ? ' on' : '')} aria-label={'Width ' + s} onClick={() => setTool({ ...tool, size: s })}><span className="dot" style={{ width: s + 3, height: s + 3 }} /></button>)}
      <span className="sep" />
      <IB title="Undo" onClick={() => ink.current?.undo()}><Undo2 size={17} /></IB>
      <IB title="Redo" onClick={() => ink.current?.redo()}><Redo2 size={17} /></IB>
    </div>
  );
}
