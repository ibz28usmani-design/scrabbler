/**
 * Obsidian vaults in and out. iPadOS gives a web app no folder on disk to
 * keep a live vault in, so the vault travels as a zip: Markdown files in
 * your folder tree, [[links]] between them, #tags and properties in each
 * file's frontmatter, sketches as SVG files beside them. Unzip it into an
 * Obsidian vault and it opens as one; zip a vault and Scrabbler takes it in.
 */
import { db, uid, type Folder, type Note } from '../db';
import { contentBottom } from './ink';
import { folderPath, folderSubject } from './folders';
import { noteBlocks, noteTitle } from './export';
import { safeFileName } from './export/ir';
import { toMarkdown } from './export/text';
import { inkSvg } from './export/inkSvg';
import { PAGE_H, type Paper } from './paper';
import { normTitle } from './links';

const ATTACH = '_attachments';

function yamlString(s: string) {
  return /^[\w ./-]+$/.test(s) && !/^(true|false|null|yes|no|\d.*)$/i.test(s) ? s : JSON.stringify(s);
}

/** A file's properties, as Obsidian reads them. */
export function frontmatter(props: Record<string, string | string[] | undefined>): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || (Array.isArray(v) && !v.length)) continue;
    if (Array.isArray(v)) lines.push(`${k}:`, ...v.map((x) => `  - ${yamlString(x)}`));
    else lines.push(`${k}: ${yamlString(v)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

/** Splits frontmatter off a Markdown file: the simple YAML Obsidian writes. */
export function parseFrontmatter(md: string): { props: Record<string, string | string[]>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { props: {}, body: md };
  const props: Record<string, string | string[]> = {};
  let key = '';
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) {
      const prev = props[key];
      props[key] = [...(Array.isArray(prev) ? prev : prev ? [prev] : []), unquote(item[1])];
      continue;
    }
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    const v = kv[2].trim();
    if (v.startsWith('[') && v.endsWith(']'))
      props[key] = v
        .slice(1, -1)
        .split(',')
        .map((x) => unquote(x.trim()))
        .filter(Boolean);
    else if (v) props[key] = unquote(v);
  }
  return { props, body: md.slice(m[0].length) };
}

function unquote(s: string) {
  if (/^".*"$/.test(s)) {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.slice(1, -1);
    }
  }
  return s.replace(/^'(.*)'$/, '$1');
}

/** A name not yet taken in its directory: "Offer", then "Offer 2". */
function claim(taken: Set<string>, dir: string, name: string) {
  let n = name;
  for (let i = 2; taken.has(`${dir}/${n}`.toLowerCase()); i++) n = `${name} ${i}`;
  taken.add(`${dir}/${n}`.toLowerCase());
  return n;
}

export async function exportVault(): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const folders = await db.folders.toArray();
  const subjects = await db.subjects.toArray();
  const notes = (await db.notes.toArray()).filter((n) => !n.deletedAt);
  const taken = new Set<string>();
  const dirOf = (folderId: string) =>
    folderPath(folders, folderId)
      .map((f) => safeFileName(f.name, 'Folder'))
      .join('/');
  // Names first, so a link written before its note is filed still points right.
  const fileName = new Map<string, string>();
  for (const n of notes) fileName.set(n.id, claim(taken, dirOf(n.folderId), safeFileName(noteTitle(n), 'Untitled')));
  for (const n of notes) {
    const dir = dirOf(n.folderId);
    const name = fileName.get(n.id)!;
    const blocks = await noteBlocks(n);
    // Obsidian titles a note by its file name; don't repeat it as a heading.
    const first = blocks[0];
    if (first?.type === 'heading' && first.level === 1 && first.runs.map((r) => r.text).join('').trim() === noteTitle(n)) blocks.shift();
    let sketches = 0;
    const md = toMarkdown(blocks, 0, {
      sketch: (b) => {
        const file = `${name} sketch ${++sketches}.svg`;
        const bottom = Math.max(contentBottom(b.strokes) + 40, Math.min(b.height, PAGE_H));
        zip.file(`${ATTACH}/${file}`, inkSvg({ strokes: b.strokes, paper: (b.paper as Paper) ?? n.paper ?? 'blank' }, 0, bottom, { background: '#ffffff', template: true }));
        const words = b.ocr?.trim() ? `\n\n> [!quote] Handwriting\n${b.ocr.trim().split('\n').map((l) => `> ${l}`).join('\n')}` : '';
        return `![[${file}]]${words}`;
      },
    });
    const subject = subjects.find((s) => s.id === folderSubject(folders, n.folderId))?.name;
    const head = frontmatter({
      created: new Date(n.createdAt).toISOString(),
      updated: new Date(n.updatedAt).toISOString(),
      subject,
      tags: n.tags,
      type: n.kind === 'lecture' ? 'lecture' : undefined,
      scrabbler: n.id,
    });
    zip.file(`${dir ? `${dir}/` : ''}${name}.md`, head + md);
  }
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE' });
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

/**
 * Swaps [[links]] for placeholders the Markdown parser leaves alone, so they
 * can become real note links once every note has an id.
 */
export function protectWikiLinks(md: string): { md: string; links: { target: string; label: string }[] } {
  const links: { target: string; label: string }[] = [];
  const out = md.replace(/(?<!!)\[\[([^\[\]|#]+)(?:#[^\[\]|]*)?(?:\|([^\[\]]*))?\]\]/g, (_m, target: string, alias?: string) => {
    links.push({ target: target.trim(), label: (alias ?? target).trim() });
    return `WIKILINK${links.length - 1}X`;
  });
  return { md: out, links };
}

export interface VaultImport {
  notes: number;
  folders: number;
}

/** Takes in a zipped Obsidian vault as a folder of its own. Nothing already here is touched. */
export async function importVault(file: File): Promise<VaultImport> {
  const { default: JSZip } = await import('jszip');
  const { mdToEditorHtml } = await import('./markdown');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)(\.obsidian|\.trash|__MACOSX)\//.test(f.name) && !/(^|\/)\./.test(f.name));
  const mdFiles = entries.filter((f) => f.name.toLowerCase().endsWith('.md'));
  if (!mdFiles.length) throw new Error('There are no Markdown notes in that zip.');
  // Images by bare name, as Obsidian resolves ![[image.png]].
  const images = new Map(entries.filter((f) => IMAGE.test(f.name)).map((f) => [f.name.split('/').pop()!.toLowerCase(), f]));

  const now = Date.now();
  const folders: Folder[] = [];
  const order = await db.folders.count();
  const root: Folder = { id: uid(), name: safeFileName(file.name.replace(/\.zip$/i, ''), 'Vault'), emoji: '🗃️', createdAt: now, order, notesAsSources: true };
  folders.push(root);
  const dirs = new Map<string, string>([['', root.id]]);
  const folderFor = (dir: string): string => {
    if (dirs.has(dir)) return dirs.get(dir)!;
    const parts = dir.split('/');
    const parentId = folderFor(parts.slice(0, -1).join('/'));
    const f: Folder = { id: uid(), name: parts[parts.length - 1], emoji: '📁', createdAt: now, order: folders.length, notesAsSources: true, parentId };
    folders.push(f);
    dirs.set(dir, f.id);
    return f.id;
  };
  // A vault zipped with its own top folder: that folder is the vault.
  const tops = new Set(mdFiles.map((f) => (f.name.includes('/') ? f.name.split('/')[0] : '')));
  const strip = tops.size === 1 && !tops.has('') ? `${[...tops][0]}/` : '';

  const parsed = await Promise.all(
    mdFiles.map(async (f) => {
      const path = f.name.slice(strip.length);
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      const title = path.split('/').pop()!.replace(/\.md$/i, '');
      const { props, body } = parseFrontmatter(await f.async('string'));
      return { id: uid(), dir, title, props, body };
    }),
  );
  const ids = new Map(parsed.map((p) => [normTitle(p.title), p.id]));

  const notes: Note[] = [];
  for (const p of parsed) {
    // Embedded images come in as pictures; other embeds stay as links.
    let body = p.body;
    for (const m of [...body.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)]) {
      const img = images.get(m[1].trim().split('/').pop()!.toLowerCase());
      if (!img) continue;
      const ext = img.name.split('.').pop()!.toLowerCase();
      const data = await img.async('base64');
      body = body.replace(m[0], `![${m[1]}](data:${MIME[ext]};base64,${data})`);
    }
    body = body.replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '[[$1]]');
    const tags = p.props.tags ? (Array.isArray(p.props.tags) ? p.props.tags : String(p.props.tags).split(/[\s,]+/)).map((t) => t.replace(/^#/, '')).filter(Boolean) : [];
    if (tags.length) body += `\n\n${tags.map((t) => `#${t}`).join(' ')}`;
    const { md, links } = protectWikiLinks(body);
    let html = `<h1>${escape(p.title)}</h1>${mdToEditorHtml(md)}`;
    html = html.replace(/WIKILINK(\d+)X/g, (_m, i) => {
      const l = links[Number(i)];
      const id = ids.get(normTitle(l.target));
      return id ? `<span data-note="${id}">${escape(l.label)}</span>` : escape(`[[${l.target}]]`);
    });
    const text = new DOMParser().parseFromString(html, 'text/html').body.innerText || p.title;
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const created = Date.parse(String(p.props.created ?? '')) || now;
    const updated = Date.parse(String(p.props.updated ?? '')) || now;
    notes.push({
      id: p.id,
      folderId: folderFor(p.dir),
      title: p.title,
      snippet: lines.slice(1, 3).join(' ').slice(0, 160),
      content: html,
      text,
      pinned: false,
      createdAt: created,
      updatedAt: updated,
      kind: 'note',
    });
  }
  await db.transaction('rw', db.folders, db.notes, async () => {
    await db.folders.bulkAdd(folders);
    await db.notes.bulkAdd(notes);
  });
  const { reindexAll } = await import('./notes');
  await reindexAll();
  return { notes: notes.length, folders: folders.length };
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
