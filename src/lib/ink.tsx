import { forwardRef, useImperativeHandle, useRef } from 'react';
import { getStroke } from 'perfect-freehand';
import { Pen, Pencil, Highlighter, Eraser, Undo2, Redo2 } from 'lucide-react';
import type { Stroke } from './db';
import { IB } from './ui';

export type Tool = { kind: 'pen' | 'pencil' | 'hl' | 'eraser'; color: string; size: number };
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

/** Handwriting as a PNG (base64, no prefix), cropped to the strokes, for AI to read. */
export function inkPng(strokes: Stroke[]): string {
  let x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0;
  for (const s of strokes) for (const [x, y] of s.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const c = document.createElement('canvas');
  c.width = Math.min(1600, x1 - x0 + 40); c.height = Math.min(4000, y1 - y0 + 40);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.translate(20 - x0, 20 - y0);
  for (const s of strokes) { g.globalAlpha = opacity(s); g.fillStyle = s.color === 'ink' ? '#111' : s.color; g.fill(new Path2D(pathOf(s))); }
  return c.toDataURL('image/png').split(',')[1];
}

export type InkHandle = { undo: () => void; redo: () => void };
type Props = { strokes: Stroke[]; onChange: (s: Stroke[]) => void; w: number; h?: number; active: boolean; tool: Tool; onExtend?: () => void };

let penSeen = false;
export const Ink = forwardRef<InkHandle, Props>(function Ink({ strokes, onChange, w, active, tool, onExtend }, ref) {
  const svg = useRef<SVGSVGElement>(null), live = useRef<SVGPathElement>(null);
  const cur = useRef<Stroke | null>(null), scroll = useRef<{ y: number; el: Element | null } | null>(null);
  const undo = useRef<Stroke[][]>([]), redo = useRef<Stroke[][]>([]), latest = useRef(strokes);
  latest.current = strokes;
  const commit = (next: Stroke[]) => { undo.current.push(latest.current); if (undo.current.length > 60) undo.current.shift(); redo.current = []; latest.current = next; onChange(next); };
  useImperativeHandle(ref, () => ({
    undo: () => { const p = undo.current.pop(); if (p) { redo.current.push(latest.current); latest.current = p; onChange(p); } },
    redo: () => { const p = redo.current.pop(); if (p) { undo.current.push(latest.current); latest.current = p; onChange(p); } },
  }));
  const pt = (e: { clientX: number; clientY: number; pressure: number }) => {
    const r = svg.current!.getBoundingClientRect(), k = w / r.width;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k, e.pressure || 0.5];
  };
  const erase = (p: number[]) => {
    const rad = 14;
    const next = latest.current.filter(s => !s.pts.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < rad + s.size));
    if (next.length !== latest.current.length) commit(next);
  };
  const down = (e: React.PointerEvent) => {
    if (!active) return;
    if (e.pointerType === 'pen') penSeen = true;
    if (e.pointerType === 'touch' && penSeen) { scroll.current = { y: e.clientY, el: svg.current!.closest('.scroller') }; return; }
    e.preventDefault(); svg.current!.setPointerCapture(e.pointerId);
    if (tool.kind === 'eraser') { cur.current = { pts: [], color: '', size: 0, tool: 'pen' }; erase(pt(e)); return; }
    cur.current = { pts: [pt(e)], color: tool.color, size: tool.size, tool: tool.kind, sp: e.pointerType !== 'pen' };
    if (live.current) { live.current.setAttribute('fill', fill(tool.color)); live.current.setAttribute('opacity', String(opacity(cur.current))); }
  };
  const move = (e: React.PointerEvent) => {
    if (scroll.current) { scroll.current.el?.scrollBy(0, scroll.current.y - e.clientY); scroll.current.y = e.clientY; return; }
    const c = cur.current; if (!c) return;
    if (tool.kind === 'eraser') { erase(pt(e)); return; }
    const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() || [];
    for (const ev of evs.length ? evs : [e]) c.pts.push(pt(ev));
    cache.delete(c); live.current?.setAttribute('d', pathOf(c));
  };
  const up = () => {
    scroll.current = null;
    const c = cur.current; cur.current = null;
    if (!c || tool.kind === 'eraser') return;
    live.current?.setAttribute('d', ''); cache.delete(c);
    commit([...latest.current, c]);
    const r = svg.current!.getBoundingClientRect();
    if (onExtend && Math.max(...c.pts.map(p => p[1])) > (r.height * w) / r.width - 180) onExtend();
  };
  return (
    <svg ref={svg} className={'ink' + (active ? ' active' : '')} style={{ width: w }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {strokes.map((s, i) => <path key={i} d={pathOf(s)} fill={fill(s.color)} opacity={opacity(s)} />)}
      <path ref={live} />
    </svg>
  );
});

export function InkBar({ tool, setTool, ink }: { tool: Tool; setTool: (t: Tool) => void; ink: React.RefObject<InkHandle | null> }) {
  const kinds = [['pen', Pen, 'Pen'], ['pencil', Pencil, 'Pencil'], ['hl', Highlighter, 'Highlighter'], ['eraser', Eraser, 'Eraser']] as const;
  return (
    <div className="row bar-group">
      {kinds.map(([k, I, name]) => <IB key={k} title={name} on={tool.kind === k} onClick={() => setTool({ ...tool, kind: k })}><I size={17} /></IB>)}
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
