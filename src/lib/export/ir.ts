/**
 * A small, format-neutral document model. Typed notes (TipTap JSON) are
 * converted to this once, and every exporter — PDF, Word, OpenDocument, RTF,
 * HTML, Markdown, text — renders from it, so they all agree on content.
 */
import type { Stroke } from '../ink';

export interface Run {
  text: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  code?: boolean;
  mark?: string;
  href?: string;
  /** A hard line break inside a paragraph. */
  br?: boolean;
}

export type Align = 'left' | 'center' | 'right' | 'justify';

export interface ListItem {
  runs: Run[];
  checked?: boolean;
  children: Block[];
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; runs: Run[]; align?: Align }
  | { type: 'paragraph'; runs: Run[]; align?: Align }
  | { type: 'list'; style: 'bullet' | 'ordered' | 'task'; start?: number; items: ListItem[] }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'code'; text: string }
  | { type: 'hr' }
  | { type: 'table'; rows: { header: boolean; cells: Run[][] }[] }
  | { type: 'image'; src: string }
  | { type: 'drawing'; strokes: Stroke[]; height: number };

interface JNode {
  type?: string;
  attrs?: Record<string, any>;
  content?: JNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, any> }[];
}

function runsOf(nodes: JNode[] | undefined): Run[] {
  const out: Run[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out.push({ text: '', br: true });
      continue;
    }
    if (n.type !== 'text' || !n.text) continue;
    const r: Run = { text: n.text };
    for (const m of n.marks ?? []) {
      if (m.type === 'bold') r.b = true;
      else if (m.type === 'italic') r.i = true;
      else if (m.type === 'underline') r.u = true;
      else if (m.type === 'strike') r.s = true;
      else if (m.type === 'code') r.code = true;
      else if (m.type === 'highlight') r.mark = m.attrs?.color || '#fde68a';
      else if (m.type === 'link') r.href = m.attrs?.href;
    }
    out.push(r);
  }
  return out;
}

/** All inline runs of a node's descendant paragraphs, joined by line breaks. */
function flatRuns(node: JNode): Run[] {
  const paras = (node.content ?? []).filter((c) => c.type === 'paragraph' || c.type === 'heading');
  const out: Run[] = [];
  paras.forEach((p, i) => {
    if (i) out.push({ text: '', br: true });
    out.push(...runsOf(p.content));
  });
  return out;
}

function listItems(node: JNode): ListItem[] {
  return (node.content ?? []).map((li) => {
    const kids = li.content ?? [];
    const firstPara = kids.find((k) => k.type === 'paragraph');
    const rest = kids.filter((k) => k !== firstPara);
    return {
      runs: firstPara ? runsOf(firstPara.content) : [],
      checked: li.type === 'taskItem' ? !!li.attrs?.checked : undefined,
      children: toBlocks({ content: rest }),
    };
  });
}

export function toBlocks(doc: JNode): Block[] {
  const out: Block[] = [];
  for (const n of doc.content ?? []) {
    const align = (n.attrs?.textAlign as Align | undefined) ?? undefined;
    switch (n.type) {
      case 'heading':
        out.push({ type: 'heading', level: Math.min(3, Math.max(1, Number(n.attrs?.level) || 1)) as 1 | 2 | 3, runs: runsOf(n.content), align });
        break;
      case 'paragraph':
        out.push({ type: 'paragraph', runs: runsOf(n.content), align });
        break;
      case 'bulletList':
        out.push({ type: 'list', style: 'bullet', items: listItems(n) });
        break;
      case 'orderedList':
        out.push({ type: 'list', style: 'ordered', start: Number(n.attrs?.start) || 1, items: listItems(n) });
        break;
      case 'taskList':
        out.push({ type: 'list', style: 'task', items: listItems(n) });
        break;
      case 'blockquote':
        out.push({ type: 'quote', blocks: toBlocks(n) });
        break;
      case 'codeBlock':
        out.push({ type: 'code', text: (n.content ?? []).map((c) => c.text ?? '').join('') });
        break;
      case 'horizontalRule':
        out.push({ type: 'hr' });
        break;
      case 'table':
        out.push({
          type: 'table',
          rows: (n.content ?? []).map((row) => ({
            header: (row.content ?? []).every((c) => c.type === 'tableHeader'),
            cells: (row.content ?? []).map((cell) => flatRuns(cell)),
          })),
        });
        break;
      case 'image':
        if (n.attrs?.src) out.push({ type: 'image', src: n.attrs.src });
        break;
      case 'drawing':
        if (Array.isArray(n.attrs?.strokes) && n.attrs!.strokes.length) out.push({ type: 'drawing', strokes: n.attrs!.strokes, height: Number(n.attrs!.height) || 420 });
        break;
      default:
        if (n.content) out.push(...toBlocks(n));
    }
  }
  return out;
}

export const plainOf = (runs: Run[]) => runs.map((r) => (r.br ? '\n' : r.text)).join('');

/** The first heading or line — used as a document title. */
export function titleOf(blocks: Block[], fallback: string): string {
  for (const b of blocks) {
    if ((b.type === 'heading' || b.type === 'paragraph') && plainOf(b.runs).trim()) return plainOf(b.runs).trim().slice(0, 120);
  }
  return fallback;
}

// ---------------------------------------------------------------- binary helpers

export function dataUrlBytes(src: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  const mime = m[1];
  const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return { bytes, mime };
}

/** Pixel size of a PNG or JPEG, read from its header. */
export function imageSize(bytes: Uint8Array): { width: number; height: number; kind: 'png' | 'jpg' } | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20), kind: 'png' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], kind: 'jpg' };
      }
      i += 2 + len;
    }
  }
  return null;
}

export function safeFileName(name: string, fallback = 'Note'): string {
  const clean = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return clean || fallback;
}
