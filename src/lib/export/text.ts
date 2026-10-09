/** Plain text, Markdown, standalone HTML and RTF writers. */
import { type Block, dataUrlBytes, imageSize, plainOf, type Run } from './ir';
import { inkSvg } from './inkSvg';

// ---------------------------------------------------------------- plain text

export function toText(blocks: Block[], depth = 0): string {
  const pad = '  '.repeat(depth);
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        out.push(plainOf(b.runs), '');
        break;
      case 'paragraph':
        out.push(pad + plainOf(b.runs), '');
        break;
      case 'list':
        b.items.forEach((it, i) => {
          const marker = b.style === 'task' ? (it.checked ? '[x] ' : '[ ] ') : b.style === 'ordered' ? `${(b.start ?? 1) + i}. ` : '• ';
          out.push(pad + marker + plainOf(it.runs));
          if (it.children.length) out.push(toText(it.children, depth + 1).trimEnd());
        });
        out.push('');
        break;
      case 'quote':
        out.push(
          toText(b.blocks)
            .trimEnd()
            .split('\n')
            .map((l) => `${pad}> ${l}`)
            .join('\n'),
          '',
        );
        break;
      case 'code':
        out.push(b.text, '');
        break;
      case 'hr':
        out.push('——————', '');
        break;
      case 'table':
        for (const r of b.rows) out.push(pad + r.cells.map(plainOf).join('\t'));
        out.push('');
        break;
      case 'image':
        out.push('[image]', '');
        break;
      case 'drawing':
        out.push('[sketch]', '');
        break;
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ---------------------------------------------------------------- markdown

function mdEscape(s: string) {
  return s.replace(/([\\`*_[\]#<>|])/g, '\\$1');
}

function mdRuns(runs: Run[]): string {
  return runs
    .map((r) => {
      if (r.br) return '  \n';
      if (r.code) return '`' + r.text.replace(/`/g, '\\`') + '`';
      let t = mdEscape(r.text);
      // Keep surrounding spaces outside emphasis markers, or Markdown ignores them.
      const lead = t.match(/^\s*/)![0];
      const trail = t.match(/\s*$/)![0];
      t = t.trim();
      if (!t) return lead + trail;
      if (r.s) t = `~~${t}~~`;
      if (r.i) t = `*${t}*`;
      if (r.b) t = `**${t}**`;
      if (r.mark) t = `==${t}==`;
      if (r.href) t = `[${t}](${r.href})`;
      return lead + t + trail;
    })
    .join('');
}

export function toMarkdown(blocks: Block[], depth = 0): string {
  const pad = '  '.repeat(depth);
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        out.push(`${'#'.repeat(b.level)} ${mdRuns(b.runs)}`, '');
        break;
      case 'paragraph':
        out.push(pad + mdRuns(b.runs), '');
        break;
      case 'list':
        b.items.forEach((it, i) => {
          const marker = b.style === 'task' ? `- [${it.checked ? 'x' : ' '}] ` : b.style === 'ordered' ? `${(b.start ?? 1) + i}. ` : '- ';
          out.push(pad + marker + mdRuns(it.runs));
          if (it.children.length) out.push(toMarkdown(it.children, depth + 1).trimEnd());
        });
        out.push('');
        break;
      case 'quote':
        out.push(
          toMarkdown(b.blocks)
            .trimEnd()
            .split('\n')
            .map((l) => `> ${l}`)
            .join('\n'),
          '',
        );
        break;
      case 'code':
        out.push('```', b.text, '```', '');
        break;
      case 'hr':
        out.push('---', '');
        break;
      case 'table': {
        if (!b.rows.length) break;
        const cols = Math.max(...b.rows.map((r) => r.cells.length));
        const row = (cells: Run[][]) => `| ${Array.from({ length: cols }, (_, i) => mdRuns(cells[i] ?? []).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`;
        out.push(row(b.rows[0].cells), `| ${Array(cols).fill('---').join(' | ')} |`, ...b.rows.slice(1).map((r) => row(r.cells)), '');
        break;
      }
      case 'image':
        out.push(b.src.startsWith('data:') ? '![image](embedded-image)' : `![image](${b.src})`, '');
        break;
      case 'drawing':
        out.push('*[sketch]*', '');
        break;
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ---------------------------------------------------------------- html

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function htmlRuns(runs: Run[]): string {
  return runs
    .map((r) => {
      if (r.br) return '<br>';
      let t = escapeHtml(r.text);
      if (r.code) t = `<code>${t}</code>`;
      if (r.s) t = `<s>${t}</s>`;
      if (r.u) t = `<u>${t}</u>`;
      if (r.i) t = `<em>${t}</em>`;
      if (r.b) t = `<strong>${t}</strong>`;
      if (r.mark) t = `<mark style="background:${escapeHtml(r.mark)}">${t}</mark>`;
      if (r.href) t = `<a href="${escapeHtml(r.href)}">${t}</a>`;
      return t;
    })
    .join('');
}

export function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      const style = 'align' in b && b.align && b.align !== 'left' ? ` style="text-align:${b.align}"` : '';
      switch (b.type) {
        case 'heading':
          return `<h${b.level}${style}>${htmlRuns(b.runs)}</h${b.level}>`;
        case 'paragraph':
          return `<p${style}>${htmlRuns(b.runs) || '<br>'}</p>`;
        case 'list': {
          const tag = b.style === 'ordered' ? 'ol' : 'ul';
          const start = b.style === 'ordered' && b.start && b.start !== 1 ? ` start="${b.start}"` : '';
          const items = b.items
            .map((it) => {
              const box = b.style === 'task' ? `<input type="checkbox" disabled${it.checked ? ' checked' : ''}> ` : '';
              return `<li${b.style === 'task' ? ' class="task"' : ''}>${box}${htmlRuns(it.runs)}${it.children.length ? blocksToHtml(it.children) : ''}</li>`;
            })
            .join('');
          return `<${tag}${start}${b.style === 'task' ? ' class="tasks"' : ''}>${items}</${tag}>`;
        }
        case 'quote':
          return `<blockquote>${blocksToHtml(b.blocks)}</blockquote>`;
        case 'code':
          return `<pre><code>${escapeHtml(b.text)}</code></pre>`;
        case 'hr':
          return '<hr>';
        case 'table':
          return `<table>${b.rows
            .map((r) => `<tr>${r.cells.map((c) => (r.header ? `<th>${htmlRuns(c)}</th>` : `<td>${htmlRuns(c)}</td>`)).join('')}</tr>`)
            .join('')}</table>`;
        case 'image':
          return `<p><img src="${escapeHtml(b.src)}" alt=""></p>`;
        case 'drawing':
          return `<figure class="sketch">${inkSvg({ strokes: b.strokes, paper: 'blank' }, 0, b.height, { background: null, template: false })}</figure>`;
      }
    })
    .join('\n');
}

export const DOCUMENT_CSS = `
  :root { color-scheme: light; }
  body { font-family: "Times New Roman", Tinos, Times, serif; max-width: 46rem; margin: 3rem auto; padding: 0 1.5rem; color: #1a1a1a; background: #fff; font-size: 17px; line-height: 1.55; }
  h1 { font-size: 2.3em; line-height: 1.1; margin: .2em 0 .5em; padding-bottom: .25em; border-bottom: 4px solid #1a1a1a; letter-spacing: -.01em; }
  h2 { font-size: 1.5em; margin: 1.2em 0 .4em; }
  h3 { font-size: 1.15em; margin: 1em 0 .3em; text-transform: uppercase; letter-spacing: .06em; }
  p { margin: .4em 0; }
  ul.tasks { list-style: none; padding-left: .3em; }
  li.task input { margin-right: .5em; }
  blockquote { margin: 1em 0; padding: .1em 0 .1em 1em; border-left: 3px solid #1a1a1a; font-style: italic; }
  pre { background: #f3f1ec; padding: .8em 1em; overflow-x: auto; font-size: .85em; }
  code { font-family: "Courier New", Courier, monospace; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #1a1a1a; padding: .35em .6em; text-align: left; vertical-align: top; }
  th { background: #f3f1ec; }
  hr { border: 0; border-top: 2px solid #1a1a1a; margin: 1.6em 0; }
  img, figure.sketch svg { max-width: 100%; height: auto; }
  figure.sketch { margin: 1em 0; border: 1px solid #ddd8cc; }
  mark { padding: 0 .1em; }
  a { color: #1d3557; }
`;

export function toHtml(blocks: Block[], title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="generator" content="Scrabbler">
<style>${DOCUMENT_CSS}</style>
</head>
<body>
${blocksToHtml(blocks)}
</body>
</html>
`;
}

// ---------------------------------------------------------------- rtf

/** Escapes text for RTF, encoding anything outside ASCII as \\uN? (UTF-16 units). */
export function rtfText(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
    else if (ch === '\n') out += '\\line ';
    else if (ch === '\t') out += '\\tab ';
    else if (code < 0x80) out += ch;
    else {
      // Astral characters become a surrogate pair, each written as a signed 16-bit value.
      for (const unit of code > 0xffff ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)] : [code]) {
        out += `\\u${unit > 0x7fff ? unit - 0x10000 : unit}?`;
      }
    }
  }
  return out;
}

function rtfRuns(runs: Run[]): string {
  return runs
    .map((r) => {
      if (r.br) return '\\line ';
      const fmt = [r.b && '\\b', r.i && '\\i', r.u && '\\ul', r.s && '\\strike', r.code && '\\f1', r.mark && '\\highlight2', r.href && '\\cf3\\ul'].filter(Boolean).join('');
      return fmt ? `{${fmt} ${rtfText(r.text)}}` : rtfText(r.text);
    })
    .join('');
}

const ALIGN_RTF: Record<string, string> = { center: '\\qc', right: '\\qr', justify: '\\qj', left: '\\ql' };

function hex(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
    if (i % 64 === 63) s += '\n';
  }
  return s;
}

function rtfPicture(bytes: Uint8Array): string {
  const size = imageSize(bytes);
  if (!size) return '';
  // Fit within ~6.3in of text width; RTF goal sizes are in twips (1/1440 in).
  const maxW = 9000;
  const wTw = Math.min(maxW, size.width * 15);
  const hTw = Math.round((wTw * size.height) / size.width);
  return `{\\pard\\sa160\\qc{\\pict\\${size.kind === 'png' ? 'pngblip' : 'jpegblip'}\\picw${size.width}\\pich${size.height}\\picwgoal${wTw}\\pichgoal${hTw}\n${hex(bytes)}}\\par}\n`;
}

export interface RtfImages {
  /** PNG bytes for sketches, rendered by the caller (needs a canvas). */
  sketch?: (b: Extract<Block, { type: 'drawing' }>) => Uint8Array | null;
}

function rtfBlocks(blocks: Block[], level = 0, images: RtfImages = {}): string {
  const li = 720 * level;
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'heading': {
          const size = { 1: 48, 2: 34, 3: 27 }[b.level];
          return `{\\pard\\sb${b.level === 1 ? 120 : 280}\\sa140\\keepn${ALIGN_RTF[b.align ?? 'left']}\\b\\fs${size} ${rtfRuns(b.runs)}\\par}\n${b.level === 1 ? '{\\pard\\brdrb\\brdrs\\brdrw40\\brsp20\\sa200\\par}\n' : ''}`;
        }
        case 'paragraph':
          return `{\\pard\\li${li}\\sa140${ALIGN_RTF[b.align ?? 'left']} ${rtfRuns(b.runs)}\\par}\n`;
        case 'list':
          return b.items
            .map((it, i) => {
              const marker = b.style === 'task' ? (it.checked ? '\\u9745?' : '\\u9744?') : b.style === 'ordered' ? `${(b.start ?? 1) + i}.` : '\\bullet';
              return `{\\pard\\li${li + 720}\\fi-360\\sa60 ${marker}\\tab ${rtfRuns(it.runs)}\\par}\n${rtfBlocks(it.children, level + 1, images)}`;
            })
            .join('');
        case 'quote':
          return `{\\i ${rtfBlocks(b.blocks, level + 1, images)}}`;
        case 'code':
          return `{\\pard\\li${li + 360}\\sa140\\f1\\fs20 ${rtfText(b.text)}\\par}\n`;
        case 'hr':
          return '{\\pard\\brdrb\\brdrs\\brdrw20\\brsp20\\sa200\\par}\n';
        case 'table': {
          const cols = Math.max(1, ...b.rows.map((r) => r.cells.length));
          const width = Math.floor(9000 / cols);
          const cellDefs = Array.from({ length: cols }, (_, i) => `\\clbrdrt\\brdrs\\clbrdrl\\brdrs\\clbrdrb\\brdrs\\clbrdrr\\brdrs\\cellx${width * (i + 1)}`).join('');
          return (
            b.rows
              .map((r) => `\\trowd\\trgaph108${cellDefs}\n${Array.from({ length: cols }, (_, i) => `\\pard\\intbl${r.header ? '\\b' : ''} ${rtfRuns(r.cells[i] ?? [])}${r.header ? '\\b0' : ''}\\cell`).join('')}\\row\n`)
              .join('') + '\\pard\\sa140\\par\n'
          );
        }
        case 'image': {
          const img = dataUrlBytes(b.src);
          return img ? rtfPicture(img.bytes) : '';
        }
        case 'drawing': {
          const png = images.sketch?.(b);
          return png ? rtfPicture(png) : '{\\pard\\i [sketch]\\par}\n';
        }
      }
    })
    .join('');
}

export function toRtf(blocks: Block[], title: string, images: RtfImages = {}): string {
  return (
    '{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1\n' +
    '{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fmodern\\fcharset0 Courier New;}}\n' +
    '{\\colortbl;\\red26\\green26\\blue26;\\red255\\green230\\blue120;\\red29\\green53\\blue87;}\n' +
    `{\\info{\\title ${rtfText(title)}}{\\doccomm Exported from Scrabbler}}\n` +
    '\\paperw11906\\paperh16838\\margl1300\\margr1300\\margt1300\\margb1300\n' +
    '\\f0\\fs23\\cf1\n' +
    rtfBlocks(blocks, 0, images) +
    '}\n'
  );
}
