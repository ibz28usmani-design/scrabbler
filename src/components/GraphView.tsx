import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../db';
import { folderSubject, OTHER_SUBJECT } from '../lib/folders';
import { anchors, buildGraph, localGraph, tick, type Graph, type GraphNote } from '../lib/graph';
import { useDark } from '../lib/theme';
import { nav, useNav } from '../lib/nav';
import { useSettings } from '../lib/settings';
import { SERIES, seriesSlot } from '../lib/subjectColors';
import { PageHead } from './PageHead';
import { Segmented } from './ui';

/**
 * The plate's own colours: newsprint and ink by day, charcoal and chalk by
 * night, each with the subject inks checked for that surface.
 */
interface Inks {
  plate: string;
  label: string;
  ink: (group: string) => string;
}

function plateInks(dark: boolean, revised: string[]): Inks {
  const series = dark ? SERIES.dark : SERIES.light;
  const other = dark ? SERIES.otherDark : SERIES.otherLight;
  const tag = dark ? '#b9b2a3' : '#6b665b';
  return {
    plate: dark ? '#141310' : '#f7f3e8',
    label: dark ? '#e9e3d6' : '#1b1a17',
    ink: (group) => {
      if (group === 'tag') return tag;
      const slot = seriesSlot(group, revised);
      return slot === null ? other : series[slot];
    },
  };
}

interface View {
  x: number;
  y: number;
  k: number;
}

/**
 * Obsidian's graph view, set as a newspaper plate: every note a node coloured
 * by its subject, every link a fine line, subjects gathered in clusters.
 * Tap a note to open it; drag to pan, pinch or scroll to zoom, drag a node to
 * move it. From a note, its local graph shows just its neighbourhood.
 */
export function GraphView({ narrow, showSidebarToggle }: { narrow: boolean; showSidebarToggle: boolean }) {
  const { graphFocus } = useNav();
  const { revisionSubjects } = useSettings();
  const dark = useDark();
  const [tags, setTags] = useState(false);
  const [folders, setFolders] = useState(true);
  const [orphans, setOrphans] = useState(true);
  const [depth, setDepth] = useState(2);
  const [query, setQuery] = useState('');
  const [asList, setAsList] = useState(false);

  const data = useLiveQuery(async () => {
    const notes: GraphNote[] = [];
    await db.notes.each((n) => {
      if (!n.deletedAt) notes.push({ id: n.id, title: n.title, folderId: n.folderId, links: n.links ?? [], tags: n.tags ?? [] });
    });
    const folders = await db.folders.toArray();
    const subjects = await db.subjects.toArray();
    return { notes, folders, subjects };
  }, []);

  const graph = useMemo(() => {
    if (!data) return null;
    const cache = new Map<string, string>();
    const subjectOf = (folderId: string) => {
      if (!cache.has(folderId)) cache.set(folderId, folderSubject(data.folders, folderId) ?? OTHER_SUBJECT);
      return cache.get(folderId)!;
    };
    const whole = buildGraph(data.notes, subjectOf, { tags, orphans: graphFocus ? true : orphans, folders: folders ? data.folders : undefined });
    return graphFocus ? localGraph(whole, graphFocus, depth) : whole;
  }, [data, tags, folders, orphans, graphFocus, depth]);
  const inks = plateInks(dark, revisionSubjects);

  const focusNote = graphFocus ? data?.notes.find((n) => n.id === graphFocus) : undefined;
  const legend = [...revisionSubjects.slice(0, SERIES.dark.length).map((id) => ({ id, name: data?.subjects.find((s) => s.id === id)?.name ?? id })), { id: OTHER_SUBJECT, name: 'Other' }];

  return (
    <div className="study graph-page">
      <PageHead title={focusNote ? `Graph: ${focusNote.title || 'Untitled'}` : 'Graph'} narrow={narrow} showSidebarToggle={showSidebarToggle}>
        {graphFocus && (
          <button className="btn" onClick={() => nav({ graphFocus: null })}>
            Whole graph
          </button>
        )}
      </PageHead>
      <div className="graph-filters" role="toolbar" aria-label="Graph filters">
        <input className="graph-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a note" aria-label="Find a note in the graph" />
        <label className="check">
          <input type="checkbox" checked={folders} onChange={(e) => setFolders(e.target.checked)} /> Folders
        </label>
        <label className="check">
          <input type="checkbox" checked={tags} onChange={(e) => setTags(e.target.checked)} /> Tags
        </label>
        {!graphFocus && (
          <label className="check">
            <input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} /> Unlinked notes
          </label>
        )}
        {graphFocus && (
          <label className="check">
            Depth
            <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
              {[1, 2, 3].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
        )}
        <span className="spacer" />
        <Segmented
          value={asList ? 'list' : 'graph'}
          onChange={(v) => setAsList(v === 'list')}
          options={[
            { value: 'graph', label: 'Plate' },
            { value: 'list', label: 'List' },
          ]}
        />
      </div>
      {graph && (asList ? <GraphList graph={graph} legend={legend} inks={inks} revised={revisionSubjects} /> : <Plate graph={graph} legend={legend} inks={inks} dark={dark} revised={revisionSubjects} query={query} focus={graphFocus} />)}
    </div>
  );
}


function Plate({ graph, legend, inks, dark, revised, query, focus }: { graph: Graph; legend: { id: string; name: string }[]; inks: Inks; dark: boolean; revised: string[]; query: string; focus: string | null }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const hover = useRef<number | null>(null);
  const alpha = useRef(1);
  const frame = useRef(0);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const q = query.trim().toLowerCase();

  // Subjects in settings order, then the rest, so clusters keep their places.
  const rank = (g: string) => (revised.includes(g) ? revised.indexOf(g) : revised.length);
  const groups = useMemo(() => [...new Set(graph.nodes.map((n) => n.group).filter((g) => g !== 'tag'))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)), [graph, revised]);
  const anchor = useMemo(() => anchors(groups, groups.length > 1 ? 70 + Math.sqrt(graph.nodes.length) * 14 : 0), [groups, graph.nodes.length]);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fit the graph to the plate once it has roughly settled.
  const fitted = useRef(false);
  useEffect(() => {
    fitted.current = false;
    alpha.current = 1;
  }, [graph]);

  const toScreen = (x: number, y: number) => ({ x: (x - view.current.x) * view.current.k + size.w / 2, y: (y - view.current.y) * view.current.k + size.h / 2 });
  const toWorld = (sx: number, sy: number) => ({ x: (sx - size.w / 2) / view.current.k + view.current.x, y: (sy - size.h / 2) / view.current.k + view.current.y });
  const radius = (deg: number, kind: string) => (kind === 'tag' ? 3.2 : kind === 'folder' ? 5 + Math.sqrt(deg) * 1.2 : 3.6 + Math.sqrt(deg) * 2.2);

  const fit = () => {
    if (!graph.nodes.length || !size.w) return;
    const xs = graph.nodes.map((n) => n.x);
    const ys = graph.nodes.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // Leave the legend clear: its corner on a wide plate, its strip along the bottom on a phone.
    const side = size.w > 700 ? 230 : 0;
    const foot = size.w > 700 ? 0 : 70;
    const k = Math.min(2.2, Math.min((size.w - side) / (x1 - x0 + 120), (size.h - foot) / (y1 - y0 + 120)));
    view.current = { x: (x0 + x1) / 2 - side / 2 / k, y: (y0 + y1) / 2 + foot / 2 / k, k };
  };

  const draw = () => {
    const c = canvasRef.current;
    if (!c || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(size.w * dpr)) c.width = Math.round(size.w * dpr);
    if (c.height !== Math.round(size.h * dpr)) c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = inks.plate;
    ctx.fillRect(0, 0, size.w, size.h);
    const h = hover.current;
    const near = h !== null ? graph.neighbours[h] : null;
    const match = (i: number) => !q || graph.nodes[i].label.toLowerCase().includes(q);
    const dim = (i: number) => (h !== null && i !== h && !near!.has(i)) || (q && !match(i));
    const k = view.current.k;
    // Lines in the ink of the note they leave, like the branches on the poster:
    // folder branches fine, links you made bolder, and both drawn under the nodes.
    for (const tree of [true, false]) {
      ctx.lineWidth = tree ? Math.max(0.7, Math.min(1.3, k * 0.8)) : Math.max(1.2, Math.min(2.4, k * 1.5));
      for (const e of graph.edges) {
        if (!!e.tree !== tree) continue;
        const a = graph.nodes[e.a];
        const b = graph.nodes[e.b];
        const lit = h !== null && (e.a === h || e.b === h);
        ctx.globalAlpha = lit ? 1 : dim(e.a) && dim(e.b) ? 0.08 : tree ? (dark ? 0.42 : 0.5) : dark ? 0.78 : 0.85;
        ctx.strokeStyle = inks.ink(a.group === 'tag' ? b.group : a.group);
        const p = toScreen(a.x, a.y);
        const r = toScreen(b.x, b.y);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        // A slight bow, so dense bundles read as strands rather than a mesh.
        const bow = tree ? 0.05 : 0.1;
        const mx = (p.x + r.x) / 2 + (r.y - p.y) * bow;
        const my = (p.y + r.y) / 2 - (r.x - p.x) * bow;
        ctx.quadraticCurveTo(mx, my, r.x, r.y);
        ctx.stroke();
      }
    }
    // Nodes, each ringed in the plate's colour so overlaps stay separate.
    graph.nodes.forEach((n, i) => {
      const p = toScreen(n.x, n.y);
      if (p.x < -20 || p.y < -20 || p.x > size.w + 20 || p.y > size.h + 20) return;
      const rr = radius(n.degree, n.kind) * Math.max(0.7, Math.min(1.6, k));
      ctx.globalAlpha = dim(i) ? 0.18 : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr + 1.5, 0, Math.PI * 2);
      ctx.fillStyle = inks.plate;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
      // A folder is a hub: a ring in its subject's ink, hollow, so it reads apart from notes.
      if (n.kind === 'folder') {
        ctx.lineWidth = 2;
        ctx.strokeStyle = inks.ink(n.group);
        ctx.stroke();
      } else {
        ctx.fillStyle = inks.ink(n.group);
        ctx.fill();
      }
      if (n.id === focus) {
        ctx.strokeStyle = inks.label;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    // Labels: the busiest notes always, the rest as you zoom in or point.
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const busy = graph.nodes.filter((n) => n.kind === 'note').sort((a, b) => b.degree - a.degree).slice(0, 8).map((n) => n.id);
    const size1 = Math.round(Math.max(11, Math.min(15, 11 * k)));
    graph.nodes.forEach((n, i) => {
      const show = i === h || near?.has(i) || n.id === focus || (q && match(i)) || (h === null && !q && (k > 1.35 || busy.includes(n.id) || n.kind === 'folder'));
      if (!show) return;
      const p = toScreen(n.x, n.y);
      const rr = radius(n.degree, n.kind) * Math.max(0.7, Math.min(1.6, k));
      ctx.globalAlpha = dim(i) ? 0.25 : 0.92;
      ctx.fillStyle = inks.label;
      // Folders are set in italic, like a section's name over its column.
      ctx.font = `${n.kind === 'folder' ? 'italic 600 ' : ''}${size1}px 'Source Serif 4', Georgia, serif`;
      const text = n.label.length > 34 ? `${n.label.slice(0, 32)}…` : n.label;
      ctx.fillText(text, p.x, p.y + rr + 4);
    });
    ctx.globalAlpha = 1;
  };

  // Run the simulation until it settles, then just redraw on demand.
  useEffect(() => {
    let alive = true;
    const loop = () => {
      if (!alive) return;
      if (alpha.current > 0.02) {
        for (let s = 0; s < 2; s++) tick(graph, alpha.current, anchor);
        alpha.current *= 0.985;
        if (!fitted.current && alpha.current < 0.5) {
          fit();
          fitted.current = true;
        }
      }
      draw();
      frame.current = requestAnimationFrame(loop);
    };
    frame.current = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, anchor, size, q, focus]);

  // ---------------------------------------------------------------- pointer: pan, zoom, drag, open

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'pan' | 'node' | 'pinch'; node?: number; sx: number; sy: number; moved: boolean; d?: number; k?: number } | null>(null);

  const hit = (sx: number, sy: number): number | null => {
    const w = toWorld(sx, sy);
    let best: number | null = null;
    let bestD = Infinity;
    graph.nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - w.x, n.y - w.y);
      const reach = (radius(n.degree, n.kind) + 8) / Math.min(1, view.current.k);
      if (d < reach && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  };

  const local = (e: React.PointerEvent | React.WheelEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: React.PointerEvent) => {
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', sx: 0, sy: 0, moved: true, d: Math.hypot(a.x - b.x, a.y - b.y), k: view.current.k };
      return;
    }
    const node = hit(p.x, p.y);
    if (node !== null) {
      graph.nodes[node].fixed = true;
      gesture.current = { kind: 'node', node, sx: p.x, sy: p.y, moved: false };
    } else gesture.current = { kind: 'pan', sx: p.x, sy: p.y, moved: false };
  };

  const onMove = (e: React.PointerEvent) => {
    const p = local(e);
    const prev = pointers.current.get(e.pointerId);
    if (prev) pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) {
      const n = hit(p.x, p.y);
      if (n !== hover.current) {
        hover.current = n;
        setTip(n === null ? null : { text: graph.nodes[n].label, x: p.x, y: p.y });
      }
      return;
    }
    if (g.kind === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      view.current.k = Math.max(0.2, Math.min(5, g.k! * (Math.hypot(a.x - b.x, a.y - b.y) / g.d!)));
      return;
    }
    if (!prev) return;
    if (Math.hypot(p.x - g.sx, p.y - g.sy) > 4) g.moved = true;
    if (g.kind === 'pan') {
      view.current.x -= (p.x - prev.x) / view.current.k;
      view.current.y -= (p.y - prev.y) / view.current.k;
    } else if (g.kind === 'node' && g.node !== undefined) {
      const w = toWorld(p.x, p.y);
      graph.nodes[g.node].x = w.x;
      graph.nodes[g.node].y = w.y;
      alpha.current = Math.max(alpha.current, 0.3);
    }
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    gesture.current = null;
    if (g.kind === 'node' && g.node !== undefined) {
      graph.nodes[g.node].fixed = false;
      const n = graph.nodes[g.node];
      if (!g.moved) {
        if (n.kind === 'tag') nav({ view: 'search', query: n.label, pane: 'list' });
        else if (n.kind === 'folder') nav({ view: 'folder', folderId: n.id.slice('folder:'.length), noteId: null, pane: 'list' });
        else openNote(n.id);
      }
    }
  };

  const openNote = async (id: string) => {
    const note = await db.notes.get(id);
    if (note) nav({ view: 'folder', folderId: note.folderId, noteId: id, pane: 'editor' });
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = local(e);
    const before = toWorld(p.x, p.y);
    view.current.k = Math.max(0.2, Math.min(5, view.current.k * Math.exp(-e.deltaY * 0.0015)));
    const after = toWorld(p.x, p.y);
    view.current.x += before.x - after.x;
    view.current.y += before.y - after.y;
  };

  const notes = graph.nodes.filter((n) => n.kind === 'note').length;
  const links = graph.edges.filter((e) => !e.tree).length;
  return (
    <div className={`graph-plate ${dark ? 'dark' : 'light'}`} ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, touchAction: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => {
          hover.current = null;
          setTip(null);
        }}
        onWheel={onWheel}
        role="img"
        aria-label={`Graph of ${notes} notes and ${links} links. Switch to List for a readable version.`}
      />
      {tip && (
        <div className="viz-tip plate" style={{ left: tip.x, top: tip.y - 10 }}>
          {tip.text}
        </div>
      )}
      <div className="plate-legend">
        <div className="plate-rule" aria-hidden="true">
          {legend.map((l) => (
            <span key={l.id} style={{ background: inks.ink(l.id) }} />
          ))}
        </div>
        <div className="plate-title">
          {focus ? 'Local graph' : 'Notes'}
          <span className="plate-dot">.</span>
        </div>
        <ul className="plate-keys">
          {legend.map((l) => (
            <li key={l.id}>
              <span className="plate-swatch" style={{ background: inks.ink(l.id) }} />
              {l.name}
            </li>
          ))}
        </ul>
        <div className="plate-figures">
          <span>{String(notes).padStart(2, '0')}</span>
          <span>{String(links).padStart(2, '0')}</span>
        </div>
        <div className="plate-figure-labels">notes · links</div>
      </div>
      {graph.nodes.length === 0 && (
        <div className="plate-empty">
          {focus ? 'This note has no links yet.' : 'No links yet. Type [[ in a note to link it to another, or add #tags.'}
        </div>
      )}
    </div>
  );
}

/** The same graph as a table: every note, its subject and how connected it is. */
function GraphList({ graph, legend, inks, revised }: { graph: Graph; legend: { id: string; name: string }[]; inks: Inks; revised: string[] }) {
  const name = (g: string) => legend.find((l) => l.id === g)?.name ?? (g === 'tag' ? 'Tag' : 'Other');
  // Links you made, not the folder branches the plate draws.
  const linked = graph.nodes.map(() => [] as string[]);
  for (const e of graph.edges) if (!e.tree) (linked[e.a].push(graph.nodes[e.b].label), linked[e.b].push(graph.nodes[e.a].label));
  const rows = graph.nodes
    .map((n, i) => ({ n, links: linked[i] }))
    .filter(({ n }) => n.kind !== 'folder')
    .sort((a, b) => b.links.length - a.links.length);
  return (
    <div className="study-scroll">
      <table className="graph-table">
        <thead>
          <tr>
            <th>Note</th>
            <th>Subject</th>
            <th className="num">Links</th>
            <th>Linked with</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ n, links }) => (
            <tr key={n.id}>
              <td>
                {n.kind === 'note' ? (
                  <button className="link-btn" onClick={async () => {
                    const note = await db.notes.get(n.id);
                    if (note) nav({ view: 'folder', folderId: note.folderId, noteId: n.id, pane: 'editor' });
                  }}>
                    {n.label}
                  </button>
                ) : (
                  n.label
                )}
              </td>
              <td>
                <span className="plate-swatch" style={{ background: inks.ink(n.group) }} /> {name(seriesSlot(n.group, revised) === null && n.group !== 'tag' ? OTHER_SUBJECT : n.group)}
              </td>
              <td className="num">{links.length}</td>
              <td className="muted">{links.slice(0, 6).join(', ')}{links.length > 6 ? '…' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
