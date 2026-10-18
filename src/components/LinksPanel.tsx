import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, type Note } from '../db';
import { linkFirstMention, mentionsTitle } from '../lib/links';
import { linksFor } from '../lib/notes';
import { nav } from '../lib/nav';
import { toast } from '../lib/events';
import { IChevD, IChevR, IGraph } from './Icons';

/** A line of the other note around where it mentions this one. */
function context(text: string, title: string): string {
  const i = text.toLowerCase().indexOf(title.toLowerCase());
  if (i < 0) return text.slice(0, 120);
  const start = Math.max(0, i - 50);
  return `${start ? '…' : ''}${text.slice(start, i + title.length + 70).replace(/\s+/g, ' ')}…`;
}

/**
 * Obsidian's foot of the page: the notes that link here, the ones that mention
 * this note's title without linking it (one tap links them), its tags, and a
 * way into its local graph.
 */
export function LinksPanel({ note }: { note: Note }) {
  const [showUnlinked, setShowUnlinked] = useState(false);
  const title = note.title.trim();
  const backlinks = useLiveQuery(async () => (await db.notes.where('links').equals(note.id).toArray()).filter((n) => !n.deletedAt && n.id !== note.id), [note.id]) ?? [];
  const unlinked =
    useLiveQuery(async () => {
      if (!showUnlinked || title.length < 3) return [];
      const linked = new Set(backlinks.map((n) => n.id));
      return (await db.notes.filter((n) => !n.deletedAt && n.id !== note.id && !linked.has(n.id) && mentionsTitle(n.text, title)).toArray()).slice(0, 30);
    }, [showUnlinked, title, backlinks.length]) ?? [];
  const outgoing = note.links?.length ?? 0;
  const tags = note.tags ?? [];
  if (!title && !backlinks.length && !tags.length) return null;

  const link = async (other: Note) => {
    const next = linkFirstMention(other.content, title, note.id);
    if (!next) return toast('That mention is in text that can’t take a link.', 'info');
    await db.notes.update(other.id, { content: next, ...(await linksFor({ id: other.id, content: next, text: other.text })), updatedAt: Date.now() });
    toast(`Linked “${other.title || 'Untitled'}”`, 'success');
  };

  const open = (n: Note) => nav({ view: 'folder', folderId: n.folderId, noteId: n.id, pane: 'editor' });

  return (
    <aside className="links-panel" contentEditable={false} aria-label="Links">
      <div className="links-head">
        <span className="links-kicker">Linked mentions</span>
        <span className="links-count">{backlinks.length}</span>
        <span className="spacer" />
        <span className="links-meta">
          {outgoing} outgoing{tags.length ? ' · ' : ''}
        </span>
        {tags.map((t) => (
          <button key={t} className="tag-chip" onClick={() => nav({ view: 'search', query: `#${t}`, pane: 'list' })}>
            #{t}
          </button>
        ))}
        <button className="chip" onClick={() => nav({ view: 'graph', graphFocus: note.id, pane: 'list' })} title="This note and its neighbours">
          <IGraph size={15} /> Local graph
        </button>
      </div>
      {backlinks.length === 0 ? (
        <p className="links-empty">No notes link here yet. Type [[ in another note to link it.</p>
      ) : (
        <ul className="links-list">
          {backlinks.map((n) => (
            <li key={n.id}>
              <button className="links-row" onClick={() => open(n)}>
                <span className="links-title">{n.title || 'Untitled'}</span>
                <span className="links-context">{context(n.text, title)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {title.length >= 3 && (
        <>
          <button className="links-toggle" onClick={() => setShowUnlinked((v) => !v)} aria-expanded={showUnlinked}>
            {showUnlinked ? <IChevD size={14} /> : <IChevR size={14} />} Unlinked mentions{showUnlinked ? ` (${unlinked.length})` : ''}
          </button>
          {showUnlinked && (
            <ul className="links-list">
              {unlinked.length === 0 && <li className="links-empty">No other note mentions “{title}”.</li>}
              {unlinked.map((n) => (
                <li key={n.id} className="links-unlinked">
                  <button className="links-row" onClick={() => open(n)}>
                    <span className="links-title">{n.title || 'Untitled'}</span>
                    <span className="links-context">{context(n.text, title)}</span>
                  </button>
                  <button className="btn small" onClick={() => link(n)}>
                    Link
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </aside>
  );
}
