/**
 * Paper templates for handwriting, expressed as pure geometry (lines and labels
 * in the 1000-unit logical space). The live canvas, PDF, SVG and PNG exports all
 * draw from this, so a template looks identical everywhere and repeats endlessly.
 */
import { W } from './ink';

/** `dots` survives only for sketches made before templates moved to handwritten notes. */
export type Paper = 'blank' | 'lines' | 'grid' | 'cornell' | 'dots';

/** Ruling pitch — the spacing of lined and grid paper. */
export const RULE = 32;
/** Page height used for Cornell sheets and for paginating exports (A4 proportions). */
export const PAGE_H = 1414;

const CORNELL_HEAD = 104;
const CORNELL_CUE_X = 290;
const CORNELL_SUMMARY_H = 250;
const MARGIN_X = 96;

export type LineWeight = 'rule' | 'major' | 'divider' | 'page';

export interface TemplateLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: LineWeight;
}

export interface TemplateLabel {
  x: number;
  y: number;
  text: string;
  align?: 'left' | 'right' | 'center';
}

export interface Template {
  lines: TemplateLine[];
  labels: TemplateLabel[];
}

/** Template primitives intersecting the vertical band [y0, y1]. */
export function templateFor(paper: Paper, y0: number, y1: number): Template {
  const lines: TemplateLine[] = [];
  const labels: TemplateLabel[] = [];
  const top = Math.max(0, y0);
  if (paper === 'lines') {
    const start = Math.max(RULE * 3, Math.ceil(top / RULE) * RULE);
    for (let y = start; y <= y1; y += RULE) lines.push({ x0: 0, y0: y, x1: W, y1: y, w: 'rule' });
    lines.push({ x0: MARGIN_X, y0: top, x1: MARGIN_X, y1, w: 'major' });
  } else if (paper === 'grid') {
    for (let y = Math.ceil(top / RULE) * RULE; y <= y1; y += RULE) lines.push({ x0: 0, y0: y, x1: W, y1: y, w: y % (RULE * 5) === 0 ? 'major' : 'rule' });
    for (let x = RULE; x < W; x += RULE) lines.push({ x0: x, y0: top, x1: x, y1, w: x % (RULE * 5) === 0 ? 'major' : 'rule' });
  } else if (paper === 'dots') {
    // Rendered as short dashes so every exporter can draw it with plain lines.
    for (let y = Math.ceil(top / RULE) * RULE; y <= y1; y += RULE)
      for (let x = RULE; x < W; x += RULE) lines.push({ x0: x - 0.8, y0: y, x1: x + 0.8, y1: y, w: 'major' });
  } else if (paper === 'cornell') {
    const first = Math.floor(top / PAGE_H);
    // The band's end is exclusive, so a band ending on a page boundary stops there.
    const last = Math.max(first, Math.ceil(y1 / PAGE_H) - 1);
    for (let p = first; p <= last; p++) {
      const pt = p * PAGE_H;
      const head = pt + CORNELL_HEAD;
      const summary = pt + PAGE_H - CORNELL_SUMMARY_H;
      const end = pt + PAGE_H;
      for (let y = head + RULE; y < end - 8; y += RULE) {
        if (Math.abs(y - summary) < 4) continue;
        lines.push({ x0: 0, y0: y, x1: W, y1: y, w: 'rule' });
      }
      lines.push({ x0: 0, y0: head, x1: W, y1: head, w: 'divider' });
      lines.push({ x0: CORNELL_CUE_X, y0: head, x1: CORNELL_CUE_X, y1: summary, w: 'divider' });
      lines.push({ x0: 0, y0: summary, x1: W, y1: summary, w: 'divider' });
      if (p > 0) lines.push({ x0: 0, y0: pt, x1: W, y1: pt, w: 'page' });
      labels.push({ x: 18, y: pt + 40, text: 'TOPIC' });
      labels.push({ x: W - 210, y: pt + 40, text: 'DATE' });
      labels.push({ x: 18, y: head + 22, text: 'CUES' });
      labels.push({ x: CORNELL_CUE_X + 18, y: head + 22, text: 'NOTES' });
      labels.push({ x: 18, y: summary + 22, text: 'SUMMARY' });
      labels.push({ x: W - 18, y: end - 14, text: String(p + 1), align: 'right' });
    }
  }
  return { lines, labels };
}

/**
 * Canvas height for a given content bottom. Endless: always a screenful of room
 * below the last stroke, and whole pages for Cornell so no sheet is cut off.
 */
export function endlessHeight(paper: Paper, contentBottom: number, viewport: number, current = 0): number {
  const wanted = Math.max(current, contentBottom + Math.max(viewport, 600), PAGE_H);
  const step = paper === 'cornell' ? PAGE_H : RULE * 10;
  return Math.ceil(wanted / step) * step;
}

export interface TemplateColors {
  rule: string;
  major: string;
  divider: string;
  page: string;
  label: string;
}

export function templateColors(dark: boolean): TemplateColors {
  return dark
    ? { rule: 'rgba(236,232,223,0.10)', major: 'rgba(236,232,223,0.19)', divider: 'rgba(236,232,223,0.42)', page: 'rgba(236,232,223,0.55)', label: 'rgba(236,232,223,0.5)' }
    : { rule: 'rgba(26,26,26,0.11)', major: 'rgba(26,26,26,0.2)', divider: 'rgba(26,26,26,0.55)', page: 'rgba(26,26,26,0.7)', label: 'rgba(26,26,26,0.5)' };
}

/** Stroke widths in logical units for print/export (screens use 1 device-independent px). */
export const PRINT_WIDTH: Record<LineWeight, number> = { rule: 0.9, major: 1.2, divider: 2, page: 3 };

export const LABEL_SIZE = 13;

/** Draws the template into a context already transformed to logical space. */
export function drawTemplate(ctx: CanvasRenderingContext2D, paper: Paper, y0: number, y1: number, colors: TemplateColors, pxPerUnit: number) {
  if (paper === 'blank') return;
  const t = templateFor(paper, y0, y1);
  const hair = 1 / pxPerUnit;
  for (const l of t.lines) {
    ctx.strokeStyle = colors[l.w];
    ctx.lineWidth = l.w === 'rule' ? hair : l.w === 'major' ? hair * 1.2 : l.w === 'divider' ? hair * 1.8 : hair * 2.6;
    ctx.beginPath();
    ctx.moveTo(l.x0, l.y0);
    ctx.lineTo(l.x1, l.y1);
    ctx.stroke();
  }
  if (t.labels.length) {
    ctx.fillStyle = colors.label;
    ctx.font = `700 ${LABEL_SIZE}px Tinos, "Times New Roman", serif`;
    for (const lb of t.labels) {
      ctx.textAlign = lb.align ?? 'left';
      // Letter-spaced small caps, like a printed form.
      ctx.fillText(lb.text.split('').join(' '), lb.x, lb.y);
    }
    ctx.textAlign = 'left';
  }
}

export interface HandwritingTemplate {
  paper: Paper;
  label: string;
  description: string;
}

/** Templates offered when starting a handwritten note. */
export const HANDWRITING_TEMPLATES: HandwritingTemplate[] = [
  { paper: 'blank', label: 'Plain', description: 'An open canvas' },
  { paper: 'lines', label: 'Lined', description: 'Ruled, with a margin' },
  { paper: 'grid', label: 'Square grid', description: 'Graph paper' },
  { paper: 'cornell', label: 'Cornell', description: 'Cues, notes & summary' },
];

export function paperLabel(paper: Paper): string {
  return HANDWRITING_TEMPLATES.find((t) => t.paper === paper)?.label ?? 'Dotted';
}

// ---- legacy inline sketches -------------------------------------------------

/** Cornell guides for inline sketches created before handwritten notes existed. */
export function cornellGuides(height: number) {
  return { cueX: 260, summaryY: Math.max(240, height - 170) };
}
