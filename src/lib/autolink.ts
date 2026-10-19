/**
 * Links new lecture notes into the notes you already have: the first time
 * the notes mention another note's title, that mention becomes a link to it,
 * so the graph grows without your doing anything.
 */
import { escapeHtml } from './markdown';

export interface LinkTarget {
  id: string;
  title: string;
}

/** Titles too generic to mean one note. */
const GENERIC = new Set(['notes', 'note', 'new note', 'untitled', 'lecture', 'summary', 'introduction', 'overview', 'revision', 'todo', 'ideas', 'questions', 'reading']);

export const MAX_AUTOLINKS = 25;

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');

/** Titles worth linking: long enough, not generic, longest first so "Contract law" wins over "Contract". */
export function linkable(targets: LinkTarget[], selfId: string): LinkTarget[] {
  const seen = new Set<string>();
  return targets
    .filter((t) => t.id !== selfId)
    .map((t) => ({ id: t.id, title: t.title.trim() }))
    .filter((t) => t.title.length >= 4 && !GENERIC.has(t.title.toLowerCase()) && !/^\d+$/.test(t.title))
    .sort((a, b) => b.title.length - a.title.length)
    .filter((t) => {
      const k = t.title.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

// Inline code, links and images, raw HTML tags and existing [[links]] are left as they are.
const PROTECTED = /(`[^`]*`|!?\[[^\]]*\]\([^)]*\)|<[^>]+>|\[\[[^\]]*\]\])/;

/**
 * Turns the first mention of each title in some Markdown into a link to that
 * note (an inline span the editor reads as a note link). The note's own
 * title line, code blocks, inline code and existing links are skipped.
 */
export function autoLinkMarkdown(md: string, targets: LinkTarget[], selfId: string, max = MAX_AUTOLINKS): { md: string; linked: string[] } {
  const todo = linkable(targets, selfId);
  if (!todo.length) return { md, linked: [] };
  const res = todo.map((t) => ({ t, re: new RegExp(`(^|[^\\p{L}\\p{N}])(${escRe(t.title)})(?=$|[^\\p{L}\\p{N}])`, 'iu') }));
  const linked: string[] = [];
  const done = new Set<string>();
  let fenced = false;
  let titleSkipped = false;
  const lines = md.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return line;
    }
    if (fenced || linked.length >= max) return line;
    if (!titleSkipped && /^#\s/.test(line)) {
      titleSkipped = true;
      return line;
    }
    const parts = line.split(PROTECTED);
    for (let i = 0; i < parts.length; i += 2) {
      for (const { t, re } of res) {
        if (done.has(t.id) || linked.length >= max) continue;
        const m = re.exec(parts[i]);
        if (!m) continue;
        const at = m.index + m[1].length;
        // The link's own text is protected from shorter titles that come after it.
        const span = `<span data-note="${escapeHtml(t.id)}">${escapeHtml(m[2])}</span>`;
        parts.splice(i, 1, parts[i].slice(0, at), span, parts[i].slice(at + m[2].length));
        done.add(t.id);
        linked.push(t.id);
      }
    }
    return parts.join('');
  });
  return { md: lines.join('\n'), linked };
}
