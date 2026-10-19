/**
 * Sharing a note or a deck with someone who doesn't use Scrabbler: a
 * self-contained, read-only web page. It can go as a file through the share
 * sheet (no server needed), or be published at a link on your push server
 * that you can update or take down.
 */
import DOMPurify from 'dompurify';
import { db, handwrittenPage, type Card, type Deck, type ID, type Note, type Share } from '../db';
import { escapeHtml } from './markdown';
import { clozeBack, clozeFront } from './study';
import { getSettings } from './settings';

const PAGE_CSS = `
  :root { color-scheme: light dark; --bg: #f7f3e8; --ink: #1b1a17; --muted: #6b665b; --line: #d8d1c2; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1c1a17; --ink: #ebe5d8; --muted: #a39d90; --line: #3a362f; } }
  * { box-sizing: border-box; }
  body { font-family: "Times New Roman", Tinos, Times, Georgia, serif; max-width: 46rem; margin: 0 auto; padding: 2.5rem 1rem 4rem; color: var(--ink); background: var(--bg); font-size: 18px; line-height: 1.55; }
  h1 { font-size: 2.2em; line-height: 1.1; margin: .2em 0 .5em; padding-bottom: .25em; border-bottom: 4px solid var(--ink); }
  h2 { font-size: 1.45em; margin: 1.2em 0 .4em; } h3 { font-size: 1.1em; text-transform: uppercase; letter-spacing: .06em; }
  p { margin: .45em 0; } ul.tasks { list-style: none; padding-left: .3em; }
  blockquote { margin: 1em 0; padding: .1em 0 .1em 1em; border-left: 3px solid var(--ink); font-style: italic; }
  pre { background: rgba(127,127,127,.12); padding: .8em 1em; overflow-x: auto; font-size: .85em; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; display: block; overflow-x: auto; }
  th, td { border: 1px solid var(--ink); padding: .35em .6em; text-align: left; vertical-align: top; }
  hr { border: 0; border-top: 2px solid var(--ink); margin: 1.6em 0; }
  img, svg { max-width: 100%; height: auto; } figure.sketch { margin: 1em 0; border: 1px solid var(--line); background: #fff; }
  a { color: inherit; }
  .cards { list-style: none; padding: 0; margin: 0; }
  .cards li { border: 1px solid var(--ink); margin: 0 0 12px; }
  details { padding: 14px 16px; } summary { cursor: pointer; font-weight: 700; list-style: none; } summary::-webkit-details-marker { display: none; }
  summary::after { content: "Show answer"; display: block; margin-top: 8px; font-weight: 400; font-size: .8em; color: var(--muted); text-decoration: underline; }
  details[open] summary::after { content: "Hide answer"; }
  .answer { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--line); }
  .answer mark { background: #f6dc7c; color: #1b1a17; padding: 0 .15em; }
  .options { margin: 8px 0 0; padding-left: 1.2em; }
  footer { margin-top: 3rem; padding-top: .6rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .8em; font-family: system-ui, sans-serif; }
`;

/** A whole page: title, body (sanitised), and a line saying where it came from. */
export function pageHtml(title: string, body: string, now = new Date()): string {
  // The server also forbids every script and outside request on these pages.
  const clean = DOMPurify.sanitize(body, { USE_PROFILES: { html: true, svg: true }, FORBID_TAGS: ['style', 'form', 'button', 'iframe'] });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
${clean}
<footer>Shared from Scrabbler · ${escapeHtml(now.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))} · read-only</footer>
</body>
</html>
`;
}

export async function notePage(note: Note): Promise<{ title: string; html: string }> {
  const { noteBlocks, noteTitle } = await import('./export');
  const { blocksToHtml } = await import('./export/text');
  const ink = handwrittenPage(note);
  if (ink) {
    const { inkSvg } = await import('./export/inkSvg');
    const { contentBottom } = await import('./ink');
    const title = noteTitle(note);
    const svg = inkSvg({ strokes: ink.strokes as never, paper: ink.paper }, 0, Math.max(400, contentBottom(ink.strokes as never) + 60), { template: true });
    return { title, html: pageHtml(title, `<h1>${escapeHtml(title)}</h1><figure class="sketch">${svg}</figure>`) };
  }
  const blocks = await noteBlocks(note);
  const title = noteTitle(note, blocks);
  return { title, html: pageHtml(title, blocksToHtml(blocks)) };
}

/** A deck as cards that turn over without any script: the answer is a <details>. */
export function deckBody(deck: Pick<Deck, 'name'>, cards: Card[]): string {
  const item = (c: Card) => {
    const front = c.type === 'cloze' ? clozeFront(c.front) : c.front;
    const answer =
      c.type === 'cloze'
        ? escapeHtml(clozeBack(c.front)).replace(/⟦([\s\S]*?)⟧/g, '<mark>$1</mark>')
        : c.type === 'mcq' && c.options
          ? escapeHtml(c.options[c.answer ?? 0] ?? c.back)
          : c.type === 'tf'
            ? c.answer === 1
              ? 'True'
              : 'False'
            : escapeHtml(c.back);
    const options = c.type === 'mcq' && c.options?.length ? `<ol class="options" type="A">${c.options.map((o) => `<li>${escapeHtml(o)}</li>`).join('')}</ol>` : '';
    const extra = c.type === 'cloze' && c.back ? `<p>${escapeHtml(c.back)}</p>` : '';
    const why = c.explanation ? `<p><em>${escapeHtml(c.explanation)}</em></p>` : '';
    return `<li><details><summary>${escapeHtml(front)}${options}</summary><div class="answer">${answer}${extra}${why}</div></details></li>`;
  };
  const live = cards.filter((c) => !c.suspended);
  return `<h1>${escapeHtml(deck.name)}</h1><p>${live.length} card${live.length === 1 ? '' : 's'}. Try each one before you open it.</p><ul class="cards">${live.map(item).join('')}</ul>`;
}

export async function deckPage(deckId: ID): Promise<{ title: string; html: string }> {
  const deck = await db.decks.get(deckId);
  if (!deck) throw new Error('That deck is no longer here.');
  const cards = (await db.cards.where('deckId').equals(deckId).toArray()).sort((a, b) => a.createdAt - b.createdAt);
  return { title: deck.name, html: pageHtml(deck.name, deckBody(deck, cards)) };
}

async function pageFor(kind: Share['kind'], refId: ID) {
  if (kind === 'deck') return deckPage(refId);
  const note = await db.notes.get(refId);
  if (!note) throw new Error('That note is no longer here.');
  return notePage(note);
}

/** Sends the page as a file through the share sheet (or downloads it). */
export async function shareAsFile(kind: Share['kind'], refId: ID): Promise<void> {
  const { title, html } = await pageFor(kind, refId);
  const name = `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Shared'}.html`;
  const file = new File([html], name, { type: 'text/html' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const { download } = await import('./backup');
  download(file, name);
}

function serverCall(path: string, body: unknown) {
  const s = getSettings();
  const base = s.pushUrl.trim().replace(/\/+$/, '');
  if (!base || !s.pushPassword) throw new Error('Publishing a link uses your push server: set it up in Settings → Notifications, with a D1 database for sync and sharing.');
  return fetch(`${base}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${s.pushPassword}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Your server answered ${res.status}.`);
    return data;
  });
}

/** A hard-to-guess id for a link: 16 random bytes, URL-safe. */
export function linkId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Publishes (or republishes, at the same link) a read-only page. */
export async function publish(kind: Share['kind'], refId: ID): Promise<Share> {
  const existing = await db.shares.where('refId').equals(refId).first();
  const { title, html } = await pageFor(kind, refId);
  const id = existing?.id ?? linkId();
  const { url } = await serverCall('/share/put', { id, title, html });
  const now = Date.now();
  const share: Share = { id, kind, refId, title, url, createdAt: existing?.createdAt ?? now, updatedAt: now };
  await db.shares.put(share);
  return share;
}

export async function unpublish(id: ID): Promise<void> {
  await serverCall('/share/delete', { id });
  await db.shares.delete(id);
}

