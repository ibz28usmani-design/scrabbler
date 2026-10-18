/**
 * Obsidian-style linking, worked out from a note's own content: the notes it
 * links to ([[…]] links and @ mentions), its #tags, and any [[Title]] written
 * as plain text — typed, or read off a sketch by handwriting recognition.
 *
 * Stored on the note itself (`links`, `tags`, both multi-entry indexes), so
 * backlinks are one index lookup rather than a walk of every note.
 */

export interface NoteIndex {
  /** Ids of the notes this one links to. */
  links: string[];
  /** Lower-case tags without the #, nested ones kept whole ("law/contract"). */
  tags: string[];
  /** [[Titles]] written as text that no note answered to yet. */
  unresolved: string[];
}

// A tag starts with a letter, so "#1" or a colour like "#fff" in prose is not one.
const TAG_RE = /(^|[\s(])#([\p{L}_][\p{L}\p{N}_/-]*)/gu;
const WIKI_RE = /\[\[([^\[\]|#]+)(?:#[^\[\]|]*)?(?:\|[^\[\]]*)?\]\]/g;

export const normTitle = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Every [[Title]] in some text, as written. */
export function wikiTitles(text: string): string[] {
  return [...text.matchAll(WIKI_RE)].map((m) => m[1].trim()).filter(Boolean);
}

export function tagsIn(text: string): string[] {
  return [...text.matchAll(TAG_RE)].map((m) => m[2].toLowerCase().replace(/\/+$/, ''));
}

/** Text a sketch's handwriting was read as — searchable and linkable like typed text. */
export function sketchTexts(content: unknown): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'drawing' && typeof n.attrs?.ocr === 'string' && n.attrs.ocr.trim()) out.push(n.attrs.ocr);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(content);
  return out;
}

function linkedIds(content: unknown): string[] {
  const out: string[] = [];
  if (typeof content === 'string') {
    for (const m of content.matchAll(/data-note="([^"]+)"/g)) out.push(m[1]);
    return out;
  }
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'noteLink' && typeof n.attrs?.id === 'string' && n.attrs.id) out.push(n.attrs.id);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(content);
  return out;
}

/**
 * The note's links and tags. `titles` maps a normalised title to a note id,
 * so a [[Title]] written by hand can still find the note it names.
 */
export function indexNote(note: { id: string; content: unknown; text?: string }, titles: Map<string, string>): NoteIndex {
  const text = [note.text ?? '', ...sketchTexts(note.content)].join('\n');
  const links = new Set(linkedIds(note.content));
  const unresolved: string[] = [];
  for (const t of wikiTitles(text)) {
    const id = titles.get(normTitle(t));
    if (id) links.add(id);
    else unresolved.push(t);
  }
  links.delete(note.id);
  return { links: [...links], tags: [...new Set(tagsIn(text))], unresolved };
}

/** Normalised title → id, the newest note winning a tie as Obsidian's resolver does. */
export function titleMap(notes: { id: string; title: string; updatedAt: number; deletedAt?: number }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of [...notes].sort((a, b) => a.updatedAt - b.updatedAt)) {
    if (n.deletedAt || !n.title.trim()) continue;
    map.set(normTitle(n.title), n.id);
  }
  return map;
}

/**
 * Notes that mention this one's title in plain text without linking it —
 * Obsidian's "unlinked mentions". Whole words only, and not the note itself.
 */
export function mentionsTitle(text: string, title: string): boolean {
  const t = title.trim();
  if (t.length < 3) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

/**
 * Turns the first plain-text mention of `title` in a TipTap document into a
 * link to the note — Obsidian's "Link" on an unlinked mention. Returns null
 * when there is nothing to link (or the content is HTML, not a document).
 */
export function linkFirstMention(content: unknown, title: string, targetId: string): unknown | null {
  if (!content || typeof content !== 'object') return null;
  const t = title.trim();
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${esc})($|[^\\p{L}\\p{N}])`, 'iu');
  let done = false;
  const walk = (n: any): any => {
    if (done || !n || typeof n !== 'object' || !Array.isArray(n.content)) return n;
    const out: any[] = [];
    for (const child of n.content) {
      if (!done && child.type === 'text' && typeof child.text === 'string' && !(child.marks ?? []).some((m: any) => m.type === 'link' || m.type === 'code')) {
        const m = re.exec(child.text);
        if (m) {
          const at = m.index + m[1].length;
          const before = child.text.slice(0, at);
          const after = child.text.slice(at + m[2].length);
          if (before) out.push({ ...child, text: before });
          out.push({ type: 'noteLink', attrs: { id: targetId, title: t } });
          if (after) out.push({ ...child, text: after });
          done = true;
          continue;
        }
      }
      out.push(walk(child));
    }
    return { ...n, content: out };
  };
  const next = walk(content);
  return done ? next : null;
}
