import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { safeFileName, titleOf, toBlocks, type Block } from '../lib/export/ir';
import { rtfText, toHtml, toMarkdown, toRtf, toText } from '../lib/export/text';
import { inkSvg } from '../lib/export/inkSvg';
import { toOdt } from '../lib/export/odt';
import { inkPdf, typedPdf, unsupportedChars, type FontBytes } from '../lib/export/pdf';
import { endlessHeight, PAGE_H, RULE, templateFor } from '../lib/paper';
import { legacyInk } from '../db';
import type { Stroke } from '../lib/ink';

const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Contract law' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Offer ' },
        { type: 'text', text: 'and', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' acceptance', marks: [{ type: 'italic' }] },
      ],
    },
    {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read Carlill' }] }] },
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Brief Hadley' }] }] },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 3 },
      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Consideration' }] }] }],
    },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Case' }] }] }, { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Year' }] }] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Carlill' }] }] }, { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1893' }] }] }] },
      ],
    },
    { type: 'drawing', attrs: { strokes: [{ t: 'pen', c: '#1f1f1f', s: 3, p: [10, 10, 0.5, 60, 40, 0.5, 120, 20, 0.5] }], height: 200 } },
  ],
};

function fonts(): FontBytes {
  const f = (n: string) => new Uint8Array(readFileSync(`src/assets/fonts/Tinos-${n}.ttf`));
  return { regular: f('Regular'), bold: f('Bold'), italic: f('Italic'), boldItalic: f('BoldItalic') };
}

describe('export IR', () => {
  const blocks = toBlocks(doc);

  it('keeps structure and inline marks', () => {
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'table', 'drawing']);
    const p = blocks[1] as Extract<Block, { type: 'paragraph' }>;
    expect(p.runs.find((r) => r.text === 'and')?.b).toBe(true);
    const tasks = blocks[2] as Extract<Block, { type: 'list' }>;
    expect(tasks.style).toBe('task');
    expect(tasks.items.map((i) => i.checked)).toEqual([true, false]);
    expect((blocks[3] as Extract<Block, { type: 'list' }>).start).toBe(3);
    expect(titleOf(blocks, 'x')).toBe('Contract law');
  });

  it('writes Markdown, text, HTML and RTF', () => {
    const md = toMarkdown(blocks);
    expect(md).toContain('# Contract law');
    expect(md).toContain('Offer **and** *acceptance*');
    expect(md).toContain('- [x] Read Carlill');
    expect(md).toContain('3. Consideration');
    expect(md).toMatch(/\| Case \| Year \|/);
    expect(toText(blocks)).toContain('Read Carlill');
    const html = toHtml(blocks, 'Contract law');
    expect(html).toContain('<h1>Contract law</h1>');
    expect(html).toContain('<svg');
    const rtf = toRtf(blocks, 'Contract law');
    expect(rtf.startsWith('{\\rtf1')).toBe(true);
    expect(rtf).toContain('Carlill');
    expect(rtfText('café “x” 😀')).toBe('caf\\u233? \\u8220?x\\u8221? \\u-10179?\\u-8704?');
  });

  it('makes safe file names', () => {
    expect(safeFileName('a/b: c?')).toBe('a b c');
    expect(safeFileName('   ')).toBe('Note');
  });
});

describe('binary exports', () => {
  const blocks = toBlocks(doc);

  it('typesets a PDF with selectable text', async () => {
    const bytes = await typedPdf(blocks, 'Contract law', fonts());
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe('Contract law');
    expect(Math.round(pdf.getPage(0).getWidth())).toBe(595);
  });

  it('paginates long documents', async () => {
    const many: Block[] = Array.from({ length: 160 }, (_, i) => ({ type: 'paragraph', runs: [{ text: `Paragraph ${i} about consideration and estoppel.` }] }));
    const pdf = await PDFDocument.load(await typedPdf(many, 'Long', fonts()));
    expect(pdf.getPageCount()).toBeGreaterThan(2);
  });

  it('reports characters the PDF font lacks', () => {
    expect(unsupportedChars('Hello é', fonts().regular)).toEqual([]);
    expect(unsupportedChars('漢字', fonts().regular).length).toBe(2);
  });

  it('draws handwriting as vector pages', async () => {
    const strokes: Stroke[] = [
      { t: 'pen', c: '#1f1f1f', s: 3, p: [100, 200, 0.5, 300, 260, 0.6, 500, 220, 0.5] },
      { t: 'marker', c: '#ffd60a', s: 8, p: [100, PAGE_H + 300, 0.5, 400, PAGE_H + 300, 0.5] },
    ];
    const pdf = await PDFDocument.load(await inkPdf({ strokes, paper: 'cornell' }, 'Ink', fonts()));
    expect(pdf.getPageCount()).toBe(2);
  });

  it('builds a valid OpenDocument package', async () => {
    const blob = await toOdt(blocks, 'Contract law');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files);
    expect(names[0]).toBe('mimetype');
    expect(await zip.file('mimetype')!.async('string')).toBe('application/vnd.oasis.opendocument.text');
    const content = await zip.file('content.xml')!.async('string');
    expect(content).toContain('Carlill');
    expect(content).toContain('text:list');
    expect(names).toContain('META-INF/manifest.xml');
  });
});

describe('paper templates', () => {
  it('repeats lined paper endlessly', () => {
    const far = templateFor('lines', 50_000, 50_400);
    const rules = far.lines.filter((l) => l.w === 'rule');
    expect(rules.length).toBeGreaterThan(10);
    expect(rules.every((l) => l.y0 % RULE === 0)).toBe(true);
  });

  it('gives every Cornell page its own sections', () => {
    const t = templateFor('cornell', 0, PAGE_H * 3);
    expect(t.labels.filter((l) => l.text === 'SUMMARY')).toHaveLength(3);
    expect(t.lines.filter((l) => l.w === 'page')).toHaveLength(2);
  });

  it('grows the canvas past the last stroke, in whole pages for Cornell', () => {
    const h = endlessHeight('cornell', 2000, 900);
    expect(h % PAGE_H).toBe(0);
    expect(h).toBeGreaterThanOrEqual(2900);
    expect(endlessHeight('lines', 100, 900)).toBeGreaterThanOrEqual(1000);
  });

  it('exports SVG with the template and ink', () => {
    const svg = inkSvg({ strokes: [{ t: 'pen', c: '#1f1f1f', s: 3, p: [10, 10, 0.5, 80, 60, 0.5] }], paper: 'grid' }, 0, 400);
    expect(svg).toContain('<line');
    expect(svg).toContain('<path');
  });
});

describe('legacy handwritten notes', () => {
  it('converts heading + single drawing into an ink note', () => {
    const ink = legacyInk({
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Cornell notes' }] },
        { type: 'drawing', attrs: { paper: 'cornell', strokes: [], height: 1414 } },
        { type: 'paragraph' },
      ],
    });
    expect(ink).toEqual({ paper: 'cornell', strokes: [], height: 1414 });
  });

  it('leaves real typed notes alone', () => {
    expect(legacyInk(doc)).toBeNull();
  });
});
