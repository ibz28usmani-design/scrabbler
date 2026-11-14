import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum } from 'd3-force';
import { db } from '../lib/db';
import { Head, noteText, linksOf, tagsOf } from '../lib/ui';

type N = SimulationNodeDatum & { id: string; label: string; color: string; kind: 'note' | 'tag'; deg: number };

export default function Graph({ open }: { open: (id: string) => void }) {
  const notes = useLiveQuery(() => db.notes.filter(n => !n.deleted).toArray(), []);
  const folders = useLiveQuery(() => db.folders.toArray(), []);
  const [showTags, setShowTags] = useState(true);
  const [, tick] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ node?: N; x: number; y: number; moved: boolean } | null>(null);

  const { nodes, links } = useMemo(() => {
    const colors = new Map((folders || []).map(f => [f.id, f.color]));
    const nodes: N[] = (notes || []).map(n => ({ id: n.id, label: n.title || 'Untitled', color: colors.get(n.folder) || '#888', kind: 'note', deg: 0 }));
    const byTitle = new Map(nodes.map(n => [n.label.toLowerCase(), n]));
    const links: { source: N; target: N }[] = [];
    for (const n of notes || []) {
      const src = nodes.find(x => x.id === n.id)!, text = noteText(n);
      for (const l of new Set(linksOf(text))) { const t = byTitle.get(l.toLowerCase()); if (t && t !== src) links.push({ source: src, target: t }); }
      if (showTags) for (const tag of tagsOf(text)) {
        let t = nodes.find(x => x.id === '#' + tag);
        if (!t) nodes.push(t = { id: '#' + tag, label: '#' + tag, color: 'var(--muted)', kind: 'tag', deg: 0 });
        links.push({ source: src, target: t });
      }
    }
    links.forEach(l => { l.source.deg++; l.target.deg++; });
    return { nodes, links };
  }, [notes, folders, showTags]);

  useEffect(() => {
    const sim = forceSimulation(nodes).force('link', forceLink(links).distance(90)).force('charge', forceManyBody().strength(-220))
      .force('center', forceCenter(0, 0)).force('collide', forceCollide(26)).on('tick', () => tick(t => t + 1));
    return () => { sim.stop(); };
  }, [nodes, links]);

  const down = (e: React.PointerEvent, node?: N) => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { node, x: e.clientX, y: e.clientY, moved: false }; };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.node) { d.node.x = (d.node.x || 0) + dx / view.k; d.node.y = (d.node.y || 0) + dy / view.k; tick(t => t + 1); }
    else setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
    d.x = e.clientX; d.y = e.clientY;
  };
  const up = () => { const d = drag.current; drag.current = null; if (d?.node && !d.moved && d.node.kind === 'note') open(d.node.id); };
  const w = box.current?.clientWidth || 800, h = box.current?.clientHeight || 600;

  return (
    <div className="view">
      <Head title="Graph" sub={`${(notes || []).length} notes · ${links.length} connections`}>
        <label className="row small"><input type="checkbox" checked={showTags} onChange={e => setShowTags(e.target.checked)} /> Show #tags</label>
        <button className="btn small" onClick={() => setView({ x: 0, y: 0, k: 1 })}>Reset view</button>
      </Head>
      <div ref={box} className="graph" onPointerDown={e => down(e)} onPointerMove={move} onPointerUp={up}
        onWheel={e => setView(v => ({ ...v, k: Math.min(3, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.1 : 0.9))) }))}>
        <svg width="100%" height="100%">
          <g transform={`translate(${w / 2 + view.x},${h / 2 + view.y}) scale(${view.k})`}>
            {links.map((l, i) => <line key={i} x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y} className="glink" />)}
            {nodes.map(n => (
              <g key={n.id} transform={`translate(${n.x || 0},${n.y || 0})`} className="gnode" onPointerDown={e => down(e, n)} onPointerMove={move} onPointerUp={up}>
                {n.kind === 'tag' ? <rect x={-7} y={-7} width={14} height={14} fill={n.color} transform="rotate(45)" /> : <circle r={8 + Math.min(10, n.deg * 2)} fill={n.color} />}
                <text y={26 + Math.min(10, n.deg * 2)} textAnchor="middle">{n.label.slice(0, 28)}</text>
              </g>
            ))}
          </g>
        </svg>
        {!links.length && <p className="graph-hint muted">Type [[Note title]] or #tag inside a note to connect it here. Drag to move, scroll to zoom, tap a note to open it.</p>}
      </div>
    </div>
  );
}
