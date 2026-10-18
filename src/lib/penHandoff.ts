/**
 * Apple Notes starts a drawing wherever the Pencil touches empty page. The
 * sketch can only be made once the Pencil is already down, and the browser
 * keeps sending that stroke to whatever it first touched, so the note collects
 * the points and hands them to the new sketch, which draws them as its own.
 */

export interface PenPoint {
  x: number;
  y: number;
  p: number;
}

interface Pending {
  id: number;
  points: PenPoint[];
  done: boolean;
}

let pending: Pending | null = null;
let claimant: ((points: PenPoint[], done: boolean) => void) | null = null;

const pointOf = (e: PointerEvent): PenPoint => ({ x: e.clientX, y: e.clientY, p: Math.max(0.05, e.pressure || 0.5) });

export function beginHandoff(e: PointerEvent) {
  pending = { id: e.pointerId, points: [pointOf(e)], done: false };
  claimant = null;
}

export function moveHandoff(e: PointerEvent) {
  if (!pending || pending.done || e.pointerId !== pending.id) return;
  const list: PointerEvent[] = e.getCoalescedEvents?.() ?? [];
  for (const ev of list.length ? list : [e]) pending.points.push(pointOf(ev));
  claimant?.(pending.points, false);
}

export function endHandoff(e: PointerEvent) {
  if (!pending || e.pointerId !== pending.id) return;
  pending.done = true;
  claimant?.(pending.points, true);
  if (claimant) pending = null;
}

export const handoffActive = () => !!pending && !pending.done;

/**
 * The new sketch takes the stroke in progress: `onPoints` gets every point so
 * far (in screen coordinates) and again as each arrives, with `done` once the
 * Pencil lifts.
 */
export function claimHandoff(onPoints: (points: PenPoint[], done: boolean) => void): () => void {
  if (!pending) return () => {};
  claimant = onPoints;
  onPoints(pending.points, pending.done);
  if (pending.done) pending = null;
  return () => {
    if (claimant === onPoints) claimant = null;
  };
}
