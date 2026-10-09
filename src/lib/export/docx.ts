/** Microsoft Word (.docx) export, built with the `docx` library from the shared IR. */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx';
import { type Align, type Block, dataUrlBytes, imageSize, plainOf, type Run } from './ir';

const FONT = 'Times New Roman';
const MONO = 'Courier New';
// Text width of an A4 page with ~2.3cm margins, in pixels at 96 dpi.
const MAX_PX = 600;

const ALIGN: Record<Align, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

export interface DocxImages {
  sketch?: (b: Extract<Block, { type: 'drawing' }>) => Uint8Array | null;
}

function runs(rs: Run[], extra: { bold?: boolean; italics?: boolean; allCaps?: boolean; color?: string } = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const r of rs) {
    if (r.br) {
      out.push(new TextRun({ text: '', break: 1 }));
      continue;
    }
    const opts = {
      text: r.text,
      bold: r.b || extra.bold,
      italics: r.i || extra.italics,
      underline: r.u || r.href ? {} : undefined,
      strike: r.s,
      allCaps: extra.allCaps,
      font: r.code ? MONO : undefined,
      color: r.href ? '1D3557' : extra.color,
      shading: r.mark ? { type: ShadingType.CLEAR, color: 'auto', fill: (r.mark.startsWith('#') ? r.mark.slice(1) : 'FDE68A').slice(0, 6).toUpperCase() } : r.code ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F3F1EC' } : undefined,
    };
    if (r.href) out.push(new ExternalHyperlink({ link: r.href, children: [new TextRun(opts)] }));
    else out.push(new TextRun(opts));
  }
  return out;
}

function picture(bytes: Uint8Array, maxPx = MAX_PX): Paragraph | null {
  const size = imageSize(bytes);
  if (!size) return null;
  const width = Math.min(maxPx, size.width);
  const height = Math.round((width * size.height) / size.width);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 160, line: 240, lineRule: LineRuleType.AUTO },
    children: [new ImageRun({ type: size.kind === 'png' ? 'png' : 'jpg', data: bytes, transformation: { width, height } })],
  });
}

class Builder {
  lists = 0;
  constructor(private images: DocxImages) {}

  blocks(blocks: Block[], level = 0, quote = false): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = [];
    const indent = level ? { left: 720 * level } : undefined;
    const q = quote ? { italics: true } : {};
    const qBorder = quote ? { border: { left: { style: BorderStyle.SINGLE, size: 18, color: '1A1A1A', space: 10 } } } : {};
    for (const b of blocks) {
      switch (b.type) {
        case 'heading':
          out.push(
            new Paragraph({
              heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][b.level - 1],
              alignment: b.align ? ALIGN[b.align] : undefined,
              children: runs(b.runs, { ...q, allCaps: b.level === 3 }),
              ...(b.level === 1 ? { border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: '1A1A1A', space: 4 } } } : {}),
            }),
          );
          break;
        case 'paragraph':
          out.push(new Paragraph({ indent, alignment: b.align ? ALIGN[b.align] : undefined, children: runs(b.runs, q), ...qBorder }));
          break;
        case 'list':
          out.push(...this.list(b, level, quote));
          break;
        case 'quote':
          out.push(...this.blocks(b.blocks, level + 1, true));
          break;
        case 'code':
          for (const line of b.text.split('\n'))
            out.push(
              new Paragraph({
                indent,
                spacing: { after: 0 },
                shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F3F1EC' },
                children: [new TextRun({ text: line || ' ', font: MONO, size: 19 })],
              }),
            );
          out.push(new Paragraph({ children: [] }));
          break;
        case 'hr':
          out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '1A1A1A', space: 1 } }, children: [] }));
          break;
        case 'table':
          out.push(this.table(b), new Paragraph({ children: [] }));
          break;
        case 'image': {
          const img = dataUrlBytes(b.src);
          const p = img && picture(img.bytes);
          if (p) out.push(p);
          break;
        }
        case 'drawing': {
          const png = this.images.sketch?.(b);
          const p = png && picture(png);
          out.push(p || new Paragraph({ children: [new TextRun({ text: '[sketch]', italics: true })] }));
          break;
        }
      }
    }
    return out;
  }

  list(b: Extract<Block, { type: 'list' }>, level: number, quote: boolean): Paragraph[] {
    const out: Paragraph[] = [];
    // Each ordered list gets its own numbering instance so it restarts at its start value.
    const instance = ++this.lists;
    b.items.forEach((it) => {
      const base: IParagraphOptions = { spacing: { after: 60 } };
      let p: Paragraph;
      if (b.style === 'task') {
        p = new Paragraph({
          ...base,
          indent: { left: 720 * (level + 1), hanging: 360 },
          children: [new TextRun({ text: it.checked ? '☑\t' : '☐\t' }), ...runs(it.runs, { italics: quote || undefined, color: it.checked ? '6E6B63' : undefined })],
        });
      } else if (b.style === 'ordered') {
        p = new Paragraph({ ...base, numbering: { reference: `ordered-${b.start ?? 1}`, level: Math.min(level, 8), instance }, children: runs(it.runs, quote ? { italics: true } : {}) });
      } else {
        p = new Paragraph({ ...base, numbering: { reference: 'bullets', level: Math.min(level, 8) }, children: runs(it.runs, quote ? { italics: true } : {}) });
      }
      out.push(p);
      out.push(...(this.blocks(it.children, level + 1, quote) as Paragraph[]));
    });
    return out;
  }

  table(b: Extract<Block, { type: 'table' }>): Table {
    const cols = Math.max(1, ...b.rows.map((r) => r.cells.length));
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: b.rows.map(
        (r) =>
          new TableRow({
            tableHeader: r.header,
            children: Array.from(
              { length: cols },
              (_, i) =>
                new TableCell({
                  width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE },
                  shading: r.header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F3F1EC' } : undefined,
                  margins: { top: 60, bottom: 60, left: 100, right: 100 },
                  children: [new Paragraph({ spacing: { after: 0 }, children: runs(r.cells[i] ?? [], { bold: r.header || undefined }) })],
                }),
            ),
          }),
      ),
    });
  }
}

/** Collects the distinct start values of ordered lists (each needs its own numbering definition). */
function orderedStarts(blocks: Block[], into = new Set<number>()): Set<number> {
  for (const b of blocks) {
    if (b.type === 'list') {
      if (b.style === 'ordered') into.add(b.start ?? 1);
      b.items.forEach((it) => orderedStarts(it.children, into));
    } else if (b.type === 'quote') orderedStarts(b.blocks, into);
  }
  return into;
}

const levels = (make: (lvl: number) => { format: (typeof LevelFormat)[keyof typeof LevelFormat]; text: string; start?: number }) =>
  Array.from({ length: 9 }, (_, lvl) => ({
    level: lvl,
    ...make(lvl),
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (lvl + 1), hanging: 360 } } },
  }));

export async function toDocx(blocks: Block[], title: string, images: DocxImages = {}): Promise<Blob> {
  const body = new Builder(images).blocks(blocks.length ? blocks : [{ type: 'paragraph', runs: [] }]);
  const bulletChars = ['•', '◦', '▪'];
  const orderedFormats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
  const doc = new Document({
    title,
    creator: 'Scrabbler',
    description: plainOf(blocks.find((b) => b.type === 'paragraph')?.runs ?? []).slice(0, 200),
    styles: {
      default: {
        document: { run: { font: FONT, size: 23, color: '1A1A1A' }, paragraph: { spacing: { after: 140, line: 300, lineRule: LineRuleType.AUTO } } },
        heading1: { run: { font: FONT, size: 46, bold: true, color: '1A1A1A' }, paragraph: { spacing: { before: 120, after: 200 }, keepNext: true } },
        heading2: { run: { font: FONT, size: 33, bold: true, color: '1A1A1A' }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true } },
        heading3: { run: { font: FONT, size: 25, bold: true, color: '1A1A1A' }, paragraph: { spacing: { before: 220, after: 100 }, keepNext: true } },
      },
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: levels((l) => ({ format: LevelFormat.BULLET, text: bulletChars[l % 3] })) },
        ...[...orderedStarts(blocks)].map((start) => ({
          reference: `ordered-${start}`,
          levels: levels((l) => ({ format: orderedFormats[l % 3], text: `%${l + 1}.`, start: l === 0 ? start : 1 })),
        })),
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1300, left: 1300, right: 1300 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: `${title}   ·   `, italics: true, size: 17, color: '6E6B63' }), new TextRun({ children: [PageNumber.CURRENT], size: 17, color: '6E6B63' })],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });
  return Packer.toBlob(doc);
}
