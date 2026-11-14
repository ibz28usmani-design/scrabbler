/** Obsidian vaults: export every note as Markdown in its folder, and import a vault from a zip. */
import JSZip from 'jszip';
import TurndownService from 'turndown';
// @ts-ignore: the plugin ships without types
import { gfm } from 'turndown-plugin-gfm';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { db, newNote, uid } from './db';
import { LAYOUTS } from './layouts';
import { inkSvg } from './ink';
import { noteText, tagsOf } from './ui';

const safe = (s: string) => (s || 'Untitled').replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim().slice(0, 80) || 'Untitled';

export async function exportVault(): Promise<Blob> {
  const zip = new JSZip(), td = new TurndownService({
    headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced',
    // Equations are empty elements carrying their LaTeX; write them the way Obsidian reads them.
    blankReplacement: (_c: string, node: any) => { const latex = node.getAttribute?.('data-latex'); return latex ? (node.getAttribute('data-type') === 'block-math' ? '\n\n$$' + latex + '$$\n\n' : '$' + latex + '$') : node.isBlock ? '\n\n' : ''; },
  });
  td.use(gfm);
  const folders = new Map((await db.folders.toArray()).map(f => [f.id, f.name])), used = new Set<string>();
  for (const n of await db.notes.filter(x => !x.deleted).toArray()) {
    let path = `${safe(folders.get(n.folder) || 'Notes')}/${safe(n.title)}`;
    while (used.has(path)) path += ' 2';
    used.add(path);
    const L = LAYOUTS[n.layout] || LAYOUTS.free, tags = tagsOf(noteText(n));
    let md = `---\ntitle: ${JSON.stringify(n.title)}\ncreated: ${new Date(n.created).toISOString()}\nupdated: ${new Date(n.updated).toISOString()}\nlayout: ${n.layout}\npaper: ${n.paper}${tags.length ? `\ntags: [${tags.join(', ')}]` : ''}${n.url ? `\nsource: ${n.url}` : ''}\n---\n\n`;
    for (const r of L.regions) { const html = n.content[r.id]; if (html) md += (r.label ? `## ${r.label}\n\n` : '') + td.turndown(html) + '\n\n'; }
    if (n.ink.length) { const name = path.split('/').pop() + '.svg'; zip.file(path + '.svg', inkSvg(n.ink)); md += `![[${name}]]\n`; }
    zip.file(path + '.md', md);
  }
  return zip.generateAsync({ type: 'blob' });
}

export async function importVault(file: Blob): Promise<number> {
  const zip = await JSZip.loadAsync(file), folders = await db.folders.toArray();
  let count = 0;
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !path.endsWith('.md') || path.includes('/.')) continue;
    let md = await entry.async('string'), created = Date.now();
    const parts = path.split('/'), name = parts.pop()!.replace(/\.md$/, '');
    let title = name;
    const fm = md.match(/^---\n([\s\S]*?)\n---\n?/);
    if (fm) {
      md = md.slice(fm[0].length);
      const t = fm[1].match(/^title:\s*(.+)$/m)?.[1], c = Date.parse(fm[1].match(/^created:\s*(.+)$/m)?.[1] || '');
      if (t) { try { title = JSON.parse(t); } catch { title = t; } }
      if (c) created = c;
    }
    const attr = (l: string) => l.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    md = md.replace(/\$\$([^$]+)\$\$/g, (_m, l) => '<div data-type="block-math" data-latex="' + attr(l.trim()) + '"></div>')
      .replace(/\$([^\s$](?:[^$\n]*[^\s$])?)\$/g, (_m, l) => '<span data-type="inline-math" data-latex="' + attr(l) + '"></span>');
    const fname = parts.length ? parts[parts.length - 1] : 'Notes';
    let folder = folders.find(f => f.name.toLowerCase() === fname.toLowerCase());
    if (!folder) { folder = { id: uid(), name: fname, color: '#1f8a70' }; folders.push(folder); await db.folders.add(folder); }
    await db.notes.add(newNote({ title, folder: folder.id, created, content: { body: DOMPurify.sanitize(await marked.parse(md)) } }));
    count++;
  }
  return count;
}
