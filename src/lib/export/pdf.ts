/**
 * PDF export with pdf-lib. Typed notes are typeset as real, selectable text in
 * Tinos (metric-compatible with Times New Roman) with a light document layout;
 * handwriting is drawn as vector paths on its paper template, page by page.
 */
import { BlendMode, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { bbox, contentBottom, displayColor, intersects, svgPath, W, type Stroke } from '../ink';
import { LABEL_SIZE, PAGE_H, PRINT_WIDTH, templateColors, templateFor, type Paper } from '../paper';
import { type Block, dataUrlBytes, imageSize, plainOf, type Run } from './ir';
import { splitRgba } from './inkSvg';

export interface FontBytes {
  regular: Uint8Array;
  bold: Uint8Array;
  italic: Uint8Array;
  boldItalic: Uint8Array;
}

export async function loadFontBytes(): Promise<FontBytes> {
  const urls = await Promise.all([
    import('../../assets/fonts/Tinos-Regular.ttf?url'),
    import('../../assets/fonts/Tinos-Bold.ttf?url'),
    import('../../assets/fonts/Tinos-Italic.ttf?url'),
    import('../../assets/fonts/Tinos-BoldItalic.ttf?url'),
  ]);
  const [regular, bold, italic, boldItalic] = await Promise.all(urls.map(async (u) => new Uint8Array(await (await fetch(u.default)).arrayBuffer())));
  return { regular, bold, italic, boldItalic };
}

// A4 in points.
const PW = 595.28;
const PH = 841.89;
const M = 66;
const FOOT = 70;
const CW = PW - M * 2;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.43, 0.42, 0.39);
const SOFT = rgb(0.953, 0.945, 0.925);
const LINK = rgb(0.114, 0.208, 0.341);

export function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return INK;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function cssRgb(c: string): { color: RGB; opacity: number } {
  const { rgb: s, a } = splitRgba(c);
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(s.replace(/\s/g, ''));
  return { color: m ? rgb(+m[1] / 255, +m[2] / 255, +m[3] / 255) : hexToRgb(s), opacity: a };
}

interface Fonts {
  r: PDFFont;
  b: PDFFont;
  i: PDFFont;
  bi: PDFFont;
  mono: PDFFont;
}

async function embedFonts(pdf: PDFDocument, bytes: FontBytes): Promise<Fonts> {
  pdf.registerFontkit(fontkit);
  const [r, b, i, bi, mono] = await Promise.all([
    pdf.embedFont(bytes.regular, { subset: true }),
    pdf.embedFont(bytes.bold, { subset: true }),
    pdf.embedFont(bytes.italic, { subset: true }),
    pdf.embedFont(bytes.boldItalic, { subset: true }),
    pdf.embedFont(StandardFonts.Courier),
  ]);
  return { r, b, i, bi, mono };
}

/** Characters the bundled font cannot draw (e.g. Arabic, CJK) — reported to the user. */
export function unsupportedChars(text: string, regular: Uint8Array): string[] {
  const font = fontkit.create(regular as unknown as Buffer) as unknown as { hasGlyphForCodePoint(cp: number): boolean };
  const missing = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 || ch === '\n' || ch === '\t') continue;
    if (!font.hasGlyphForCodePoint(cp)) missing.add(ch);
  }
  return [...missing];
}

// ---------------------------------------------------------------- typed layout

interface Seg {
  text: string;
  font: PDFFont;
  size: number;
  w: number;
  run: Run;
}

interface Style {
  size: number;
  bold?: boolean;
  italic?: boolean;
  upper?: boolean;
  muted?: boolean;
}

const ASCII = /^[\x20-\x7e]*$/;

class Typesetter {
  page!: PDFPage;
  y = M;
  quote = 0;
  pages: PDFPage[] = [];

  constructor(
    private pdf: PDFDocument,
    private f: Fonts,
    private sketch?: (b: Extract<Block, { type: 'drawing' }>) => Promise<Uint8Array | null>,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage([PW, PH]);
    this.pages.push(this.page);
    this.y = M;
  }

  ensure(h: number) {
    if (this.y + h > PH - FOOT && this.y > M + 1) this.newPage();
  }

  fontFor(r: Run, s: Style): PDFFont {
    if (r.code && ASCII.test(r.text)) return this.f.mono;
    const b = r.b || s.bold;
    const i = r.i || s.italic;
    return b && i ? this.f.bi : b ? this.f.b : i ? this.f.i : this.f.r;
  }

  width(text: string, font: PDFFont, size: number) {
    try {
      return font.widthOfTextAtSize(text, size);
    } catch {
      return text.length * size * 0.5;
    }
  }

  /** Greedy word wrap across mixed-style runs. */
  wrap(runs: Run[], s: Style, maxW: number): Seg[][] {
    const lines: Seg[][] = [];
    let line: Seg[] = [];
    let w = 0;
    const push = () => {
      while (line.length && !line[line.length - 1].text.trim()) w -= line.pop()!.w;
      lines.push(line);
      line = [];
      w = 0;
    };
    for (const r of runs) {
      if (r.br) {
        push();
        continue;
      }
      const text = s.upper ? r.text.toUpperCase() : r.text;
      for (const tok of text.split(/(\s+)/)) {
        if (!tok) continue;
        const font = this.fontFor(r, s);
        const tw = this.width(tok, font, s.size);
        if (!tok.trim()) {
          if (!line.length) continue;
          line.push({ text: ' ', font, size: s.size, w: this.width(' ', font, s.size), run: r });
          w += line[line.length - 1].w;
          continue;
        }
        if (w + tw > maxW && line.length) push();
        if (tw > maxW) {
          // A single word wider than the column: break it by characters.
          let chunk = '';
          for (const ch of tok) {
            if (this.width(chunk + ch, font, s.size) > maxW && chunk) {
              line.push({ text: chunk, font, size: s.size, w: this.width(chunk, font, s.size), run: r });
              push();
              chunk = '';
            }
            chunk += ch;
          }
          if (chunk) {
            const cw = this.width(chunk, font, s.size);
            line.push({ text: chunk, font, size: s.size, w: cw, run: r });
            w += cw;
          }
          continue;
        }
        line.push({ text: tok, font, size: s.size, w: tw, run: r });
        w += tw;
      }
    }
    push();
    return lines;
  }

  drawLines(lines: Seg[][], x: number, maxW: number, s: Style, align: string = 'left') {
    const lh = s.size * 1.42;
    for (const line of lines) {
      this.ensure(lh);
      const lw = line.reduce((a, g) => a + g.w, 0);
      let cx = x + (align === 'center' ? (maxW - lw) / 2 : align === 'right' ? maxW - lw : 0);
      const base = PH - (this.y + s.size * 1.02);
      for (let q = 0; q < this.quote; q++) {
        this.page.drawLine({ start: { x: M + q * 14 - 8, y: PH - this.y }, end: { x: M + q * 14 - 8, y: PH - this.y - lh }, thickness: 1.6, color: INK });
      }
      for (const g of line) {
        if (g.run.mark && g.text.trim()) this.page.drawRectangle({ x: cx, y: base - s.size * 0.24, width: g.w, height: s.size * 1.18, color: hexToRgb(g.run.mark.startsWith('#') ? g.run.mark : '#fde68a'), opacity: 0.85 });
        if (g.run.code && g.text.trim()) this.page.drawRectangle({ x: cx - 1, y: base - s.size * 0.24, width: g.w + 2, height: s.size * 1.18, color: SOFT });
      }
      for (const g of line) {
        const color = g.run.href ? LINK : s.muted ? MUTED : INK;
        if (g.text.trim()) this.page.drawText(g.text, { x: cx, y: base, size: g.size, font: g.font, color });
        if ((g.run.u || g.run.href) && g.text.trim()) this.page.drawLine({ start: { x: cx, y: base - 1.6 }, end: { x: cx + g.w, y: base - 1.6 }, thickness: 0.6, color });
        if (g.run.s && g.text.trim()) this.page.drawLine({ start: { x: cx, y: base + s.size * 0.3 }, end: { x: cx + g.w, y: base + s.size * 0.3 }, thickness: 0.6, color });
        cx += g.w;
      }
      this.y += lh;
    }
  }

  text(runs: Run[], x: number, maxW: number, s: Style, align?: string) {
    this.drawLines(this.wrap(runs, s, maxW), x, maxW, s, align);
  }

  async blocks(blocks: Block[], indent = 0, italic = false) {
    const x = M + indent;
    const maxW = CW - indent;
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      switch (b.type) {
        case 'heading': {
          const size = { 1: 23, 2: 16.5, 3: 12.5 }[b.level];
          const before = this.y > M + 1 ? { 1: 18, 2: 14, 3: 10 }[b.level] : 0;
          // Keep a heading with at least a couple of lines of what follows it.
          this.ensure(before + size * 1.42 + 34);
          this.y += before;
          this.text(b.runs, x, maxW, { size, bold: true, upper: b.level === 3, italic }, b.align);
          if (b.level === 1) {
            this.page.drawLine({ start: { x, y: PH - this.y - 2 }, end: { x: x + maxW, y: PH - this.y - 2 }, thickness: 2.4, color: INK });
            this.y += 12;
          } else this.y += 4;
          break;
        }
        case 'paragraph':
          if (!plainOf(b.runs).trim()) this.y += 9;
          else this.text(b.runs, x, maxW, { size: 11.5, italic }, b.align);
          this.y += 5;
          break;
        case 'list':
          await this.list(b, indent, italic);
          this.y += 4;
          break;
        case 'quote':
          this.quote++;
          await this.blocks(b.blocks, indent + 14, true);
          this.quote--;
          this.y += 4;
          break;
        case 'code': {
          const size = 9.5;
          const lh = size * 1.42;
          const lines = b.text.split('\n').flatMap((l) => this.wrap([{ text: l || ' ', code: true }], { size }, maxW - 16));
          this.y += 4;
          for (const line of lines) {
            this.ensure(lh);
            this.page.drawRectangle({ x, y: PH - this.y - lh, width: maxW, height: lh, color: SOFT });
            let cx = x + 8;
            for (const g of line) {
              if (g.text.trim()) this.page.drawText(g.text, { x: cx, y: PH - (this.y + size * 1.05), size, font: g.font, color: INK });
              cx += g.w;
            }
            this.y += lh;
          }
          this.y += 8;
          break;
        }
        case 'hr':
          this.ensure(18);
          this.y += 8;
          this.page.drawLine({ start: { x, y: PH - this.y }, end: { x: x + maxW, y: PH - this.y }, thickness: 1.4, color: INK });
          this.y += 10;
          break;
        case 'table':
          this.table(b, x, maxW);
          break;
        case 'image':
          await this.image(b.src, x, maxW);
          break;
        case 'drawing':
          await this.drawing(b, x, maxW);
          break;
      }
    }
  }

  async list(b: Extract<Block, { type: 'list' }>, indent: number, italic: boolean) {
    const size = 11.5;
    for (let i = 0; i < b.items.length; i++) {
      const it = b.items[i];
      const x = M + indent + 18;
      const maxW = CW - indent - 18;
      this.ensure(size * 1.42);
      const top = this.y;
      const base = PH - (this.y + size * 1.02);
      if (b.style === 'task') {
        const bx = M + indent + 3;
        const by = base - 0.5;
        this.page.drawRectangle({ x: bx, y: by, width: 8.5, height: 8.5, borderColor: INK, borderWidth: 0.9 });
        if (it.checked) {
          this.page.drawLine({ start: { x: bx + 1.6, y: by + 4.4 }, end: { x: bx + 3.6, y: by + 2 }, thickness: 1.2, color: INK });
          this.page.drawLine({ start: { x: bx + 3.6, y: by + 2 }, end: { x: bx + 7.6, y: by + 7.4 }, thickness: 1.2, color: INK });
        }
      } else {
        const marker = b.style === 'ordered' ? `${(b.start ?? 1) + i}.` : '•';
        const mw = this.f.r.widthOfTextAtSize(marker, size);
        this.page.drawText(marker, { x: M + indent + 13 - mw, y: base, size, font: this.f.r, color: INK });
      }
      this.y = top;
      this.text(it.runs.length ? it.runs : [{ text: ' ' }], x, maxW, { size, italic, muted: b.style === 'task' && it.checked });
      this.y += 2;
      if (it.children.length) await this.blocks(it.children, indent + 18, italic);
    }
  }

  table(b: Extract<Block, { type: 'table' }>, x: number, maxW: number) {
    const cols = Math.max(1, ...b.rows.map((r) => r.cells.length));
    const colW = maxW / cols;
    const size = 10.5;
    const lh = size * 1.42;
    this.y += 4;
    for (const row of b.rows) {
      const cells = Array.from({ length: cols }, (_, i) => this.wrap(row.cells[i]?.length ? row.cells[i] : [{ text: ' ' }], { size, bold: row.header }, colW - 12));
      const rowH = Math.max(...cells.map((c) => c.length)) * lh + 8;
      this.ensure(rowH);
      const top = this.y;
      cells.forEach((lines, i) => {
        const cx = x + i * colW;
        this.page.drawRectangle({ x: cx, y: PH - top - rowH, width: colW, height: rowH, borderColor: INK, borderWidth: 0.7, color: row.header ? SOFT : undefined });
        this.y = top + 4;
        this.drawLines(lines, cx + 6, colW - 12, { size, bold: row.header });
      });
      this.y = top + rowH;
    }
    this.y += 10;
  }

  async image(src: string, x: number, maxW: number) {
    const data = dataUrlBytes(src);
    const size = data && imageSize(data.bytes);
    if (!data || !size) return;
    const img = size.kind === 'png' ? await this.pdf.embedPng(data.bytes) : await this.pdf.embedJpg(data.bytes);
    let w = Math.min(maxW, size.width * 0.75);
    let h = (w * size.height) / size.width;
    const maxH = PH - M - FOOT - 10;
    if (h > maxH) {
      w = (w * maxH) / h;
      h = maxH;
    }
    this.ensure(h + 10);
    this.page.drawImage(img, { x: x + (maxW - w) / 2, y: PH - this.y - h, width: w, height: h });
    this.y += h + 10;
  }

  async drawing(b: Extract<Block, { type: 'drawing' }>, x: number, maxW: number) {
    let s = maxW / W;
    const maxH = PH - M - FOOT - 10;
    if (b.height * s > maxH) s = maxH / b.height;
    const w = W * s;
    const h = b.height * s;
    this.ensure(h + 10);
    const left = x + (maxW - w) / 2;
    const top = PH - this.y;
    this.page.drawRectangle({ x: left, y: top - h, width: w, height: h, borderColor: rgb(0.85, 0.83, 0.79), borderWidth: 0.6 });
    for (const st of b.strokes) drawStroke(this.page, st, left, top, s);
    this.y += h + 10;
    void this.sketch;
  }

  footers(title: string) {
    const n = this.pages.length;
    this.pages.forEach((p, i) => {
      p.drawLine({ start: { x: M, y: 50 }, end: { x: PW - M, y: 50 }, thickness: 0.6, color: MUTED });
      let t = title;
      while (t.length > 4 && this.f.i.widthOfTextAtSize(t, 8.5) > CW - 60) t = t.slice(0, -2);
      if (t !== title) t = t.trimEnd() + '…';
      p.drawText(t, { x: M, y: 36, size: 8.5, font: this.f.i, color: MUTED });
      const label = `${i + 1} / ${n}`;
      p.drawText(label, { x: PW - M - this.f.r.widthOfTextAtSize(label, 8.5), y: 36, size: 8.5, font: this.f.r, color: MUTED });
    });
  }
}

function drawStroke(page: PDFPage, st: Stroke, x: number, y: number, s: number, dy = 0) {
  const d = svgPath(st, 0, dy);
  if (!d) return;
  page.drawSvgPath(d, {
    x,
    y,
    scale: s,
    color: hexToRgb(displayColor(st.c, false)),
    opacity: st.t === 'marker' ? 0.34 : st.t === 'pencil' ? 0.85 : 1,
    blendMode: st.t === 'marker' ? BlendMode.Multiply : undefined,
    borderWidth: 0,
  });
}

function meta(pdf: PDFDocument, title: string) {
  pdf.setTitle(title);
  pdf.setCreator('Scrabbler');
  pdf.setProducer('Scrabbler');
  pdf.setCreationDate(new Date());
  pdf.setModificationDate(new Date());
}

export async function typedPdf(blocks: Block[], title: string, fonts: FontBytes): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  meta(pdf, title);
  const f = await embedFonts(pdf, fonts);
  const ts = new Typesetter(pdf, f);
  await ts.blocks(blocks.length ? blocks : [{ type: 'paragraph', runs: [{ text: ' ' }] }]);
  ts.footers(title);
  return pdf.save();
}

// ---------------------------------------------------------------- handwriting

/** Each page is an A4 sheet of the note's paper, with ink drawn as vectors. */
export async function inkPdf(doc: { strokes: Stroke[]; paper: Paper | string }, title: string, fonts: FontBytes): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  meta(pdf, title);
  pdf.registerFontkit(fontkit);
  const labelFont = await pdf.embedFont(fonts.bold, { subset: true });
  const s = PW / W;
  const pageH = PAGE_H * s;
  const count = Math.max(1, Math.ceil(contentBottom(doc.strokes) / PAGE_H));
  const colors = templateColors(false);
  for (let p = 0; p < count; p++) {
    const page = pdf.addPage([PW, pageH]);
    const y0 = p * PAGE_H;
    const y1 = y0 + PAGE_H;
    if (doc.paper !== 'blank') {
      const t = templateFor(doc.paper as Paper, y0, y1);
      for (const l of t.lines) {
        if (l.w === 'page') continue; // each PDF page is already its own sheet
        const { color, opacity } = cssRgb(colors[l.w]);
        page.drawLine({
          start: { x: l.x0 * s, y: pageH - (l.y0 - y0) * s },
          end: { x: l.x1 * s, y: pageH - (l.y1 - y0) * s },
          thickness: PRINT_WIDTH[l.w] * s,
          color,
          opacity,
        });
      }
      const { color, opacity } = cssRgb(colors.label);
      const size = LABEL_SIZE * s;
      for (const lb of t.labels) {
        const spacing = 2 * s;
        const width = [...lb.text].reduce((a, ch) => a + labelFont.widthOfTextAtSize(ch, size) + spacing, -spacing);
        let cx = lb.align === 'right' ? lb.x * s - width : lb.x * s;
        for (const ch of lb.text) {
          page.drawText(ch, { x: cx, y: pageH - (lb.y - y0) * s, size, font: labelFont, color, opacity });
          cx += labelFont.widthOfTextAtSize(ch, size) + spacing;
        }
      }
    }
    const view = { x0: 0, y0, x1: W, y1 };
    for (const st of doc.strokes) if (intersects(bbox(st), view)) drawStroke(page, st, 0, pageH, s, -y0);
  }
  return pdf.save();
}
