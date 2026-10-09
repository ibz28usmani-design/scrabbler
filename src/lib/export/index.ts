/**
 * One entry point for saving notes to the device. Typed notes are converted to
 * the shared IR once and handed to each writer; handwriting is exported as
 * vector (PDF, SVG) or raster (PNG, JPEG) pages on its paper.
 */
import { generateJSON } from '@tiptap/core';
import type { InkDoc, Note } from '../../db';
import { contentBottom, type Stroke } from '../ink';
import { editorExtensions } from '../../components/editorExtensions';
import { canvasToBlob, inkPages, renderInkRange } from '../inkRender';
import { PAGE_H, type Paper } from '../paper';
import { type Block, dataUrlBytes, plainOf, safeFileName, titleOf, toBlocks } from './ir';
import { toHtml, toMarkdown, toRtf, toText } from './text';
import { inkSvg } from './inkSvg';
import type { OutFile } from './save';

export type TypedFormat = 'pdf' | 'docx' | 'odt' | 'rtf' | 'html' | 'md' | 'txt' | 'json';
export type InkFormat = 'pdf' | 'png' | 'jpg' | 'svg' | 'json';
export type ExportFormat = TypedFormat | InkFormat;

export interface FormatInfo {
  id: ExportFormat;
  label: string;
  ext: string;
  detail: string;
}

export const TYPED_FORMATS: FormatInfo[] = [
  { id: 'pdf', label: 'PDF', ext: 'pdf', detail: 'Typeset A4, selectable text' },
  { id: 'docx', label: 'Word', ext: 'docx', detail: 'Microsoft Word, Pages, Google Docs' },
  { id: 'odt', label: 'OpenDocument', ext: 'odt', detail: 'LibreOffice, Pages, Google Docs' },
  { id: 'rtf', label: 'Rich Text', ext: 'rtf', detail: 'TextEdit, WordPad, any word processor' },
  { id: 'html', label: 'Web page', ext: 'html', detail: 'Opens in any browser' },
  { id: 'md', label: 'Markdown', ext: 'md', detail: 'Obsidian, Notion, GitHub' },
  { id: 'txt', label: 'Plain text', ext: 'txt', detail: 'Words only, no formatting' },
  { id: 'json', label: 'Scrabbler', ext: 'json', detail: 'Lossless backup of this note' },
];

export const INK_FORMATS: FormatInfo[] = [
  { id: 'pdf', label: 'PDF', ext: 'pdf', detail: 'Vector A4 pages on your paper' },
  { id: 'png', label: 'PNG', ext: 'png', detail: 'Sharp image, one per page' },
  { id: 'jpg', label: 'JPEG', ext: 'jpg', detail: 'Smaller image, one per page' },
  { id: 'svg', label: 'SVG', ext: 'svg', detail: 'Scalable vector, whole canvas' },
  { id: 'json', label: 'Scrabbler', ext: 'json', detail: 'Lossless backup of the strokes' },
];

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  html: 'text/html',
  md: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
};

const blobOf = (data: BlobPart, ext: string) => new Blob([data], { type: `${MIME[ext]}${ext.match(/^(html|md|txt|json|svg|rtf)$/) ? ';charset=utf-8' : ''}` });

/** The note's TipTap JSON, whether it is stored as JSON or (older/AI notes) as HTML. */
export async function noteDoc(note: Note): Promise<unknown> {
  const c = note.content;
  if (c && typeof c === 'object') return c;
  const html = typeof c === 'string' ? c : '';
  return generateJSON(html || '<p></p>', editorExtensions);
}

export async function noteBlocks(note: Note): Promise<Block[]> {
  const blocks = toBlocks((await noteDoc(note)) as never);
  // As in Apple Notes, a note's first line is its title: export it as one.
  const first = blocks.findIndex((b) => b.type !== 'paragraph' || plainOf(b.runs).trim());
  const b = blocks[first];
  if (b?.type === 'paragraph') blocks[first] = { type: 'heading', level: 1, runs: b.runs.map((r) => ({ ...r, b: undefined })), align: b.align };
  return blocks.slice(Math.max(0, first));
}

export function noteTitle(note: Note, blocks?: Block[]): string {
  return note.title?.trim() || (blocks ? titleOf(blocks, '') : '') || (note.kind === 'ink' ? 'Handwritten note' : 'Untitled note');
}

/** A sketch embedded in a typed note, rasterised for formats without vector support. */
function sketchPng(b: Extract<Block, { type: 'drawing' }>): Uint8Array | null {
  try {
    const c = renderInkRange({ strokes: b.strokes, paper: 'blank' }, 0, b.height, { scale: 1.5, template: false });
    return dataUrlBytes(c.toDataURL('image/png'))?.bytes ?? null;
  } catch {
    return null;
  }
}

export interface ExportResult {
  files: OutFile[];
  /** Something the user should know (e.g. characters the PDF font lacks). */
  warning?: string;
}

function backupJson(note: Note, doc?: unknown): string {
  const { id: _id, folderId: _f, audioBlobId: _a, ...rest } = note;
  return JSON.stringify({ format: 'scrabbler-note', version: 1, exportedAt: new Date().toISOString(), note: { ...rest, content: doc ?? note.content } }, null, 2);
}

export async function exportNote(note: Note, format: ExportFormat): Promise<ExportResult> {
  if (note.kind === 'ink') return exportInk(note, format as InkFormat);
  const blocks = await noteBlocks(note);
  const title = noteTitle(note, blocks);
  const base = safeFileName(title);
  const one = (data: BlobPart, ext: string, warning?: string): ExportResult => ({ files: [{ name: `${base}.${ext}`, blob: blobOf(data, ext) }], warning });

  switch (format as TypedFormat) {
    case 'pdf': {
      const { loadFontBytes, typedPdf, unsupportedChars } = await import('./pdf');
      const fonts = await loadFontBytes();
      const missing = unsupportedChars(toText(blocks), fonts.regular);
      const bytes = await typedPdf(blocks, title, fonts);
      return one(
        bytes as BlobPart,
        'pdf',
        missing.length ? `The PDF font can't draw ${missing.slice(0, 8).join(' ')}${missing.length > 8 ? '…' : ''}. Use Print → Save as PDF to keep those characters.` : undefined,
      );
    }
    case 'docx': {
      const { toDocx } = await import('./docx');
      return { files: [{ name: `${base}.docx`, blob: await toDocx(blocks, title, { sketch: sketchPng }) }] };
    }
    case 'odt': {
      const { toOdt } = await import('./odt');
      return { files: [{ name: `${base}.odt`, blob: await toOdt(blocks, title, { sketch: sketchPng }) }] };
    }
    case 'rtf':
      return one(toRtf(blocks, title, { sketch: sketchPng }), 'rtf');
    case 'html':
      return one(toHtml(blocks, title), 'html');
    case 'md':
      return one(toMarkdown(blocks), 'md');
    case 'txt':
      return one(toText(blocks), 'txt');
    case 'json':
      return one(backupJson(note, await noteDoc(note)), 'json');
  }
}

async function exportInk(note: Note, format: InkFormat): Promise<ExportResult> {
  const ink: InkDoc = note.ink ?? { paper: 'blank', strokes: [], height: PAGE_H };
  const doc = { strokes: ink.strokes as Stroke[], paper: ink.paper as Paper };
  const title = noteTitle(note);
  const base = safeFileName(title, 'Handwritten note');
  switch (format) {
    case 'pdf': {
      const { inkPdf, loadFontBytes } = await import('./pdf');
      const bytes = await inkPdf(doc, title, await loadFontBytes());
      return { files: [{ name: `${base}.pdf`, blob: blobOf(bytes as BlobPart, 'pdf') }] };
    }
    case 'svg': {
      const pages = Math.max(1, Math.ceil(contentBottom(doc.strokes) / PAGE_H));
      const svg = inkSvg(doc, 0, pages * PAGE_H, { template: true, background: '#ffffff' });
      return { files: [{ name: `${base}.svg`, blob: blobOf(`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`, 'svg') }] };
    }
    case 'png':
    case 'jpg': {
      const type = format === 'png' ? 'image/png' : 'image/jpeg';
      const pages = inkPages(doc, false);
      const files: OutFile[] = [];
      for (const p of pages) {
        const blob = await canvasToBlob(renderInkRange(doc, p.y0, p.y1, { scale: 2, template: true, background: '#ffffff' }), type, 0.9);
        files.push({ name: pages.length > 1 ? `${base} — page ${p.index + 1}.${format}` : `${base}.${format}`, blob });
      }
      if (files.length <= 1) return { files };
      // Several pages travel better as one archive (one tap in the share sheet).
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const f of files) zip.file(f.name, f.blob);
      return { files: [{ name: `${base} (${files.length} pages).zip`, blob: await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' }) }] };
    }
    case 'json':
      return { files: [{ name: `${base}.json`, blob: blobOf(backupJson(note), 'json') }] };
  }
}

/** Standalone, print-ready HTML of a typed note (for the system print dialog). */
export async function printableHtml(note: Note): Promise<string> {
  const blocks = await noteBlocks(note);
  return toHtml(blocks, noteTitle(note, blocks));
}
