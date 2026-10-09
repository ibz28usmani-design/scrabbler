import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, deleteNotesForever, type Note } from '../db';
import { nav, toggleSidebar, openModal, useNav } from '../lib/nav';
import { groupLabel, shortDate } from '../lib/dates';
import { createNote, restoreNote } from '../lib/notes';
import { confirmDialog, Empty, Menu } from './ui';
import { ICompose, IMic, IPencil, IPin, ISidebar, ITrash, IChevL } from './Icons';

function highlight(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function NoteList({ narrow, showSidebarToggle }: { narrow: boolean; showSidebarToggle: boolean }) {
  const { view, folderId, noteId, query } = useNav();
  const [menu, setMenu] = useState<{ note: Note; el: HTMLElement } | null>(null);
  const folder = useLiveQuery(() => (folderId ? db.folders.get(folderId) : undefined), [folderId]);
  const notes =
    useLiveQuery(async () => {
      if (view === 'deleted') return (await db.notes.where('deletedAt').above(0).toArray()).sort((a, b) => b.deletedAt! - a.deletedAt!);
      if (view === 'search') {
        const q = query.toLowerCase().trim();
        const all = await db.notes.toArray();
        return all.filter((n) => !n.deletedAt && (n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q))).sort((a, b) => b.updatedAt - a.updatedAt);
      }
      if (!folderId) return [];
      return (await db.notes.where('folderId').equals(folderId).toArray()).filter((n) => !n.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
    }, [view, folderId, query]) ?? [];

  const title = view === 'deleted' ? 'Recently Deleted' : view === 'search' ? 'Search' : folder?.name ?? 'Notes';

  const groups: { label: string; items: Note[] }[] = [];
  const pinned = view === 'folder' ? notes.filter((n) => n.pinned) : [];
  if (pinned.length) groups.push({ label: 'Pinned', items: pinned });
  for (const n of notes) {
    if (view === 'folder' && n.pinned) continue;
    const label = view === 'deleted' ? 'Deleted notes are removed after 30 days' : view === 'search' ? `${notes.length} result${notes.length === 1 ? '' : 's'}` : groupLabel(n.updatedAt);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(n);
    else groups.push({ label, items: [n] });
  }

  const snippetFor = (n: Note) => {
    if (view === 'search' && query) {
      const i = n.text.toLowerCase().indexOf(query.toLowerCase());
      if (i >= 0) return highlight(n.text.slice(Math.max(0, i - 30), i + 90), query);
    }
    return n.snippet || (n.kind === 'lecture' ? 'Lecture recording' : 'No additional text');
  };

  return (
    <section className="list-pane">
      <div className="list-head">
        {narrow ? (
          <button className="icon-btn accent" onClick={() => nav({ pane: 'sidebar' })} aria-label="Folders">
            <IChevL /> <span className="back-label">Folders</span>
          </button>
        ) : (
          showSidebarToggle && (
            <button className="icon-btn" onClick={toggleSidebar} aria-label="Toggle sidebar">
              <ISidebar />
            </button>
          )
        )}
        <span className="spacer" />
        {view === 'folder' && folderId && (
          <>
            <button className="icon-btn rec" onClick={() => openModal({ type: 'recorder', folderId })} aria-label="Record lecture" title="Record lecture">
              <IMic />
            </button>
            <button
              className="icon-btn"
              aria-label="New handwritten note"
              title="New handwritten note"
              onClick={() => createNote(folderId, { content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Handwritten note' }] }, { type: 'drawing', attrs: { paper: 'lines', height: 1200, autoActive: true } }, { type: 'paragraph' }] }, title: 'Handwritten note' })}
            >
              <IPencil />
            </button>
            <button className="icon-btn accent" onClick={() => createNote(folderId)} aria-label="New note" title="New note">
              <ICompose />
            </button>
          </>
        )}
        {view === 'deleted' && notes.length > 0 && (
          <button
            className="btn small danger"
            onClick={async () => {
              if (await confirmDialog(`Permanently delete ${notes.length} note${notes.length === 1 ? '' : 's'}? This can't be undone.`, 'Delete All')) {
                await deleteNotesForever(notes.map((n) => n.id));
                nav({ noteId: null });
              }
            }}
          >
            Delete All
          </button>
        )}
      </div>
      <h1 className="list-title">{title}</h1>
      <div className="list-sub">
        {notes.length} note{notes.length === 1 ? '' : 's'}
      </div>
      <div className="list-scroll">
        {notes.length === 0 && (
          <Empty title={view === 'search' ? 'No results' : view === 'deleted' ? 'Nothing here' : 'No notes yet'}>
            {view === 'folder' && 'Tap the compose button, draw with Apple Pencil, or record a lecture.'}
          </Empty>
        )}
        {groups.map((g) => (
          <div key={g.label} className="list-group">
            <div className="list-group-label">
              {g.label === 'Pinned' && <IPin size={13} />} {g.label}
            </div>
            <div className="list-card">
              {g.items.map((n) => (
                <button
                  key={n.id}
                  className={`note-row ${n.id === noteId ? 'on' : ''}`}
                  onClick={() => nav({ noteId: n.id, pane: 'editor', ...(view === 'search' ? { folderId: n.folderId } : {}) })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ note: n, el: e.currentTarget });
                  }}
                >
                  <div className="note-title">
                    {n.kind === 'lecture' && <IMic size={14} className="note-kind" />}
                    {n.title || 'New Note'}
                  </div>
                  <div className="note-meta">
                    <span className="note-date">{shortDate(view === 'deleted' ? n.deletedAt! : n.updatedAt)}</span>
                    <span className="note-snippet">{snippetFor(n)}</span>
                  </div>
                  {(n.status === 'transcribing' || n.status === 'writing') && <div className="note-processing">✦ {n.status === 'transcribing' ? 'Transcribing…' : 'Writing notes…'}</div>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {menu && (
        <Menu
          anchor={menu.el}
          onClose={() => setMenu(null)}
          items={
            view === 'deleted'
              ? [
                  { label: 'Recover', onClick: () => restoreNote(menu.note.id) },
                  { label: 'Delete permanently', danger: true, onClick: () => deleteNotesForever([menu.note.id]) },
                ]
              : [
                  { label: menu.note.pinned ? 'Unpin' : 'Pin', icon: <IPin size={17} />, onClick: () => db.notes.update(menu.note.id, { pinned: !menu.note.pinned }) },
                  {
                    label: 'Delete',
                    icon: <ITrash size={17} />,
                    danger: true,
                    onClick: async () => {
                      await db.notes.update(menu.note.id, { deletedAt: Date.now() });
                      if (noteId === menu.note.id) nav({ noteId: null });
                    },
                  },
                ]
          }
        />
      )}
    </section>
  );
}
