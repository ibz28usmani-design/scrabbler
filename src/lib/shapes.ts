/**
 * Shape recognition, as in Apple Notes: draw a line, circle, triangle or box,
 * hold the Pencil still at the end, and the wobbly stroke becomes a clean one.
 * Points are flattened x,y,pressure triples in page units.
 */

type Pt = [number, number];

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function pointsOf(p: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < p.length; i += 3) out.push([p[i], p[i + 1]]);
  return out;
}

function pathLength(pts: Pt[]) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1], pts[i]);
  return n;
}

/** Distance from p to the segment a–b. */
function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer–Douglas–Peucker: the corners of a hand-drawn polyline. */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  let max = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) {
      max = d;
      at = i;
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, at + 1), eps).slice(0, -1), ...simplify(pts.slice(at), eps)];
}

/** Evenly spaced points along a polyline, so the pen renders it smoothly. */
function densify(corners: Pt[], step = 6): Pt[] {
  const out: Pt[] = [corners[0]];
  for (let i = 1; i < corners.length; i++) {
    const [a, b] = [corners[i - 1], corners[i]];
    const n = Math.max(1, Math.round(dist(a, b) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

function flatten(pts: Pt[], pressure: number): number[] {
  return pts.flatMap(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, pressure]);
}

export type ShapeKind = 'line' | 'ellipse' | 'triangle' | 'rectangle' | 'polygon';

/** The clean shape a stroke was meant to be, or null when it's just writing. */
export function recognizeShape(p: number[]): { kind: ShapeKind; p: number[] } | null {
  const pts = pointsOf(p);
  if (pts.length < 6) return null;
  const pressure = p.filter((_, i) => i % 3 === 2).reduce((a, b) => a + b, 0) / pts.length;
  const len = pathLength(pts);
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const diag = Math.hypot(box.x1 - box.x0, box.y1 - box.y0);
  if (diag < 24) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];

  // Straight enough: a line from end to end.
  if (dist(first, last) / len > 0.92) return { kind: 'line', p: flatten(densify([first, last]), pressure) };

  const closed = dist(first, last) < Math.max(0.22 * diag, 18);
  if (!closed) return null;

  // Corners first: a box drawn with rounded corners still has four of them.
  const corners = simplify(pts, diag * 0.07);
  // A closed path repeats its start at the end; drop that and any near-duplicate.
  const ring = corners.slice(0, -1).filter((c, i, all) => i === 0 || dist(c, all[i - 1]) > diag * 0.08);
  if (ring.length === 3 || ring.length === 4) {
    if (ring.length === 4) {
      const angles = ring.map((c, i) => {
        const a = ring[(i + 3) % 4];
        const b = ring[(i + 1) % 4];
        const v1 = [a[0] - c[0], a[1] - c[1]];
        const v2 = [b[0] - c[0], b[1] - c[1]];
        return Math.abs((Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]) * 180) / Math.PI);
      });
      // Near-square corners: tidy to an upright rectangle when it's nearly level.
      if (angles.every((a) => Math.abs(a - 90) < 22)) {
        const tilt = (Math.atan2(ring[1][1] - ring[0][1], ring[1][0] - ring[0][0]) * 180) / Math.PI;
        const level = Math.abs(((tilt + 45) % 90) - 45) < 12;
        const rect: Pt[] = level
          ? [
              [box.x0, box.y0],
              [box.x1, box.y0],
              [box.x1, box.y1],
              [box.x0, box.y1],
            ]
          : ring;
        return { kind: 'rectangle', p: flatten(densify([...rect, rect[0]]), pressure) };
      }
    }
    // Only a real polygon if its sides carry the path; otherwise it's a round shape.
    const perim = pathLength([...ring, ring[0]]);
    if (perim / len > 0.86) return { kind: ring.length === 3 ? 'triangle' : 'polygon', p: flatten(densify([...ring, ring[0]]), pressure) };
  }

  // Round: every point near the ellipse that fits the box.
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const rx = (box.x1 - box.x0) / 2;
  const ry = (box.y1 - box.y0) / 2;
  if (rx < 8 || ry < 8) return null;
  const off = pts.map(([x, y]) => Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1));
  if (off.reduce((a, b) => a + b, 0) / off.length < 0.13) {
    // Start where the pen started, going the way it went.
    const a0 = Math.atan2((first[1] - cy) / ry, (first[0] - cx) / rx);
    const turn = Math.sign((pts[3][0] - cx) * (pts[0][1] - cy) - (pts[3][1] - cy) * (pts[0][0] - cx)) || 1;
    const n = Math.max(24, Math.round((Math.PI * (rx + ry)) / 6));
    const ring2: Pt[] = Array.from({ length: n + 1 }, (_, i) => {
      const a = a0 - turn * ((i / n) * Math.PI * 2);
      return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    });
    return { kind: 'ellipse', p: flatten(ring2, pressure) };
  }
  return null;
}
