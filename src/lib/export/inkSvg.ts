/** Vector SVG for handwriting: the paper template plus every stroke as a filled path. */
import { bbox, displayColor, intersects, svgPath, W, type Stroke } from '../ink';
import { LABEL_SIZE, PRINT_WIDTH, templateColors, templateFor, type Paper } from '../paper';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Splits "rgba(r,g,b,a)" into an rgb colour and an opacity, for SVG and PDF. */
export function splitRgba(c: string): { rgb: string; a: number } {
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return { rgb: c, a: 1 };
  const [r, g, b, a = '1'] = m[1].split(',').map((x) => x.trim());
  return { rgb: `rgb(${r},${g},${b})`, a: Number(a) };
}

export interface InkSvgOptions {
  template?: boolean;
  /** Paper colour; null leaves it transparent. */
  background?: string | null;
}

export function inkSvg(doc: { strokes: Stroke[]; paper: Paper | string }, y0: number, y1: number, o: InkSvgOptions = {}): string {
  const h = Math.max(1, y1 - y0);
  const parts: string[] = [];
  if (o.background !== null) parts.push(`<rect x="0" y="0" width="${W}" height="${h}" fill="${o.background ?? '#ffffff'}"/>`);
  if (o.template !== false && doc.paper !== 'blank') {
    const colors = templateColors(false);
    const t = templateFor(doc.paper as Paper, y0, y1);
    for (const l of t.lines) {
      const { rgb, a } = splitRgba(colors[l.w]);
      parts.push(`<line x1="${l.x0}" y1="${l.y0 - y0}" x2="${l.x1}" y2="${l.y1 - y0}" stroke="${rgb}" stroke-opacity="${a}" stroke-width="${PRINT_WIDTH[l.w]}"/>`);
    }
    const { rgb, a } = splitRgba(colors.label);
    for (const lb of t.labels) {
      const anchor = lb.align === 'right' ? 'end' : lb.align === 'center' ? 'middle' : 'start';
      parts.push(
        `<text x="${lb.x}" y="${lb.y - y0}" fill="${rgb}" fill-opacity="${a}" font-family="Tinos, 'Times New Roman', serif" font-weight="700" font-size="${LABEL_SIZE}" letter-spacing="2" text-anchor="${anchor}">${esc(lb.text)}</text>`,
      );
    }
  }
  const view = { x0: 0, y0, x1: W, y1 };
  for (const st of doc.strokes) {
    if (!intersects(bbox(st), view)) continue;
    const d = svgPath(st, 0, -y0);
    if (!d) continue;
    const opacity = st.t === 'marker' ? ' fill-opacity="0.34"' : st.t === 'pencil' ? ' fill-opacity="0.85"' : '';
    const blend = st.t === 'marker' ? ' style="mix-blend-mode:multiply"' : '';
    parts.push(`<path d="${d}" fill="${esc(displayColor(st.c, false))}"${opacity}${blend}/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}">${parts.join('')}</svg>`;
}
