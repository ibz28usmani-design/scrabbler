/** Renders handwritten notes to images, page by page (for transcription and PNG/JPEG export). */
import type { InkDoc } from '../db';
import { bbox, contentBottom, intersects, paintStroke, W, type Stroke } from './ink';
import { drawTemplate, PAGE_H, templateColors, type Paper } from './paper';

export interface PageRange {
  index: number;
  y0: number;
  y1: number;
}

/** Page bands (A4 proportions) that actually contain ink. Always at least one. */
export function inkPages(doc: Pick<InkDoc, 'strokes'>, onlyInked = true): PageRange[] {
  const strokes = doc.strokes as Stroke[];
  const count = Math.max(1, Math.ceil(contentBottom(strokes) / PAGE_H));
  const pages: PageRange[] = [];
  for (let i = 0; i < count; i++) {
    const y0 = i * PAGE_H;
    const y1 = y0 + PAGE_H;
    if (!onlyInked || strokes.some((s) => intersects(bbox(s), { x0: 0, y0, x1: W, y1 }))) pages.push({ index: i, y0, y1 });
  }
  return pages.length ? pages : [{ index: 0, y0: 0, y1: PAGE_H }];
}

export interface RenderOptions {
  scale?: number;
  /** Draw the paper template (lines, grid, Cornell guides). */
  template?: boolean;
  /** Paper colour; null leaves it transparent (PNG only). */
  background?: string | null;
  type?: 'image/png' | 'image/jpeg';
  quality?: number;
}

export function renderInkRange(doc: Pick<InkDoc, 'strokes' | 'paper'>, y0: number, y1: number, o: RenderOptions = {}): HTMLCanvasElement {
  // Stay well inside iPad Safari's canvas area limit (~16.7M px).
  const want = o.scale ?? 2;
  const maxScale = Math.sqrt(14_000_000 / (W * (y1 - y0)));
  const scale = Math.min(want, maxScale);
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale);
  c.height = Math.round((y1 - y0) * scale);
  const ctx = c.getContext('2d')!;
  if (o.background !== null) {
    ctx.fillStyle = o.background ?? '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.setTransform(scale, 0, 0, scale, 0, -y0 * scale);
  if (o.template !== false) drawTemplate(ctx, doc.paper as Paper, y0, y1, templateColors(false), scale);
  const view = { x0: 0, y0, x1: W, y1 };
  for (const st of doc.strokes as Stroke[]) if (intersects(bbox(st), view)) paintStroke(ctx, st, false);
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg' = 'image/png', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render the image.'))), type, quality));
}

export async function renderInkPages(doc: Pick<InkDoc, 'strokes' | 'paper'>, o: RenderOptions = {}): Promise<Blob[]> {
  const out: Blob[] = [];
  for (const p of inkPages(doc)) out.push(await canvasToBlob(renderInkRange(doc, p.y0, p.y1, o), o.type, o.quality));
  return out;
}
