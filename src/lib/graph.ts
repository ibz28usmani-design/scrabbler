/**
 * The knowledge graph's model and layout: notes (and optionally tags and
 * folders) as nodes, links as edges, laid out by a small force simulation.
 * Folders are hubs each note branches from, and notes of a subject are drawn
 * gently toward their own region, so the graph grows in clusters, as a neuron
 * grows its branches.
 */

export interface GraphNote {
  id: string;
  title: string;
  folderId: string;
  links: string[];
  tags: string[];
}

export interface GNode {
  id: string;
  label: string;
  kind: 'note' | 'tag' | 'folder';
  /** Subject id, or 'other'. */
  group: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
  /** Pinned while dragged. */
  fixed?: boolean;
}

export interface GEdge {
  a: number;
  b: number;
  /** A branch of the folder tree rather than a link you made. */
  tree?: boolean;
}

export interface GraphFolder {
  id: string;
  name: string;
  parentId?: string;
}

export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
  index: Map<string, number>;
  neighbours: Set<number>[];
}

export function buildGraph(notes: GraphNote[], subjectOf: (folderId: string) => string, opts: { tags: boolean; orphans: boolean; folders?: GraphFolder[] }): Graph {
  const nodes: GNode[] = [];
  const index = new Map<string, number>();
  const add = (id: string, label: string, kind: GNode['kind'], group: string) => {
    if (index.has(id)) return index.get(id)!;
    // A deterministic spiral start, so the same vault lays out the same way.
    const i = nodes.length;
    const r = 30 * Math.sqrt(i + 1);
    const a = i * 2.39996;
    nodes.push({ id, label, kind, group, x: r * Math.cos(a), y: r * Math.sin(a), vx: 0, vy: 0, degree: 0 });
    index.set(id, i);
    return i;
  };
  for (const n of notes) add(n.id, n.title || 'Untitled', 'note', subjectOf(n.folderId));
  const edges: GEdge[] = [];
  const seen = new Set<string>();
  const link = (a: number, b: number, tree = false) => {
    if (a === b) return;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(tree ? { a, b, tree } : { a, b });
    nodes[a].degree++;
    nodes[b].degree++;
  };
  for (const n of notes) {
    const a = index.get(n.id)!;
    for (const to of n.links) if (index.has(to)) link(a, index.get(to)!);
    if (opts.tags) for (const t of n.tags) link(a, add(`tag:${t}`, `#${t}`, 'tag', 'tag'));
  }
  if (opts.folders) {
    const byId = new Map(opts.folders.map((f) => [f.id, f]));
    const hub = (id: string): number | undefined => {
      const f = byId.get(id);
      if (!f) return undefined;
      const known = index.has(`folder:${id}`);
      const i = add(`folder:${id}`, f.name, 'folder', subjectOf(id));
      // Each folder branches from the one it sits in, up to the top.
      if (!known && f.parentId) {
        const p = hub(f.parentId);
        if (p !== undefined) link(p, i, true);
      }
      return i;
    };
    for (const n of notes) {
      const h = hub(n.folderId);
      if (h !== undefined) link(h, index.get(n.id)!, true);
    }
  }
  let kept = nodes;
  if (!opts.orphans) kept = nodes.filter((n) => n.degree > 0);
  return reindex(kept, edges, nodes);
}

function reindex(kept: GNode[], edges: GEdge[], all: GNode[]): Graph {
  const index = new Map<string, number>();
  kept.forEach((n, i) => index.set(n.id, i));
  const remapped = edges.filter((e) => index.has(all[e.a].id) && index.has(all[e.b].id)).map((e) => ({ ...e, a: index.get(all[e.a].id)!, b: index.get(all[e.b].id)! }));
  const neighbours = kept.map(() => new Set<number>());
  for (const e of remapped) {
    neighbours[e.a].add(e.b);
    neighbours[e.b].add(e.a);
  }
  return { nodes: kept, edges: remapped, index, neighbours };
}

/** The note and everything within `depth` links of it — Obsidian's local graph. */
export function localGraph(g: Graph, id: string, depth: number): Graph {
  const start = g.index.get(id);
  if (start === undefined) return reindex([], [], g.nodes);
  const keep = new Set([start]);
  let frontier = [start];
  for (let d = 0; d < depth; d++) {
    const next: number[] = [];
    for (const i of frontier) for (const j of g.neighbours[i]) if (!keep.has(j)) (keep.add(j), next.push(j));
    frontier = next;
  }
  return reindex(g.nodes.filter((_, i) => keep.has(i)), g.edges, g.nodes);
}

/** Where each subject's cluster gathers: evenly round a circle. */
export function anchors(groups: string[], radius: number): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  groups.forEach((g, i) => {
    const a = (i / Math.max(1, groups.length)) * Math.PI * 2 - Math.PI / 2;
    out.set(g, { x: radius * Math.cos(a), y: radius * Math.sin(a) });
  });
  return out;
}

/** One step of the simulation; returns how much moved, so it can settle and stop. */
export function tick(g: Graph, alpha: number, anchor: Map<string, { x: number; y: number }>): number {
  const { nodes, edges } = g;
  const n = nodes.length;
  // Repulsion between every pair: fine for the few hundred notes a vault has.
  for (let i = 0; i < n; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        dx = (i % 7) - 3 || 1;
        dy = (j % 5) - 2 || 1;
        d2 = dx * dx + dy * dy;
      }
      if (d2 > 160_000) continue;
      const f = (900 * alpha) / d2;
      const fx = dx * f;
      const fy = dy * f;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }
  // Links pull to a natural length.
  for (const e of edges) {
    const a = nodes[e.a];
    const b = nodes[e.b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    // Branches are shorter than links, so a folder's notes gather round it.
    const f = ((d - (e.tree ? 34 : 46)) / d) * 0.06 * alpha;
    a.vx += dx * f;
    a.vy += dy * f;
    b.vx -= dx * f;
    b.vy -= dy * f;
  }
  let moved = 0;
  for (const p of nodes) {
    const home = anchor.get(p.group) ?? { x: 0, y: 0 };
    p.vx += (home.x - p.x) * 0.012 * alpha;
    p.vy += (home.y - p.y) * 0.012 * alpha;
    if (p.fixed) {
      p.vx = p.vy = 0;
      continue;
    }
    p.vx *= 0.6;
    p.vy *= 0.6;
    p.x += p.vx;
    p.y += p.vy;
    moved += Math.abs(p.vx) + Math.abs(p.vy);
  }
  return moved / Math.max(1, n);
}
