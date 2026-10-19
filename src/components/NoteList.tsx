import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { db, deleteNotesForever, type Note } from '../db';
import { nav, toggleSidebar, openModal, useNav } from '../lib/nav';
import { groupLabel, shortDate } from '../lib/dates';
import { createNote, createHandwrittenNote, restoreNote } from '../lib/notes';
import { HANDWRITING_TEMPLATES } from '../lib/paper';
import { confirmDialog, Empty, Menu, useMenu } from './ui';
import { ICompose, IHandwriting, IMic, IPin, ISidebar, ITrash, IChevL } from './Icons';
import { searchNotes, type Hit } from '../lib/search';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Marks every place any of the words appears. */
export function highlight(text: string, marks: string[]): ReactNode {
  const words = marks.filter(Boolean).sort((a, b) => b.length - a.length);
  if (!words.length || !text) return text;
  const re = new RegExp(`(${words.map(escapeRe).join('|')})`, 'gi');
  const parts = text.split(re);
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}

/** Rows are drawn this many at a time; more appear as the list scrolls to its end. */
const PAGE = 120;

/** Grows a count as a sentinel at the end of a list comes into view. */
function useMoreOnScroll(reset: unknown, total: number) {
  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => setShown(PAGE), [reset]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || shown >= total || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setShown((n) => n + PAGE), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, total]);
  return [shown, sentinel] as const;
}

export function NoteList({ narrow, showSidebarToggle }: { narrow: boolean; showSidebarToggle: boolean }) {
  const { view, folderId, noteId, query } = useNav();
  const [menu, setMenu] = useState<{ note: Note; el: HTMLElement } | null>(null);
  const [tplAnchor, openTpl, closeTpl] = useMenu();
  const folder = useLiveQuery(() => (folderId ? db.folders.get(folderId) : undefined), [folderId]);
  const listed =
    useLiveQuery(async () => {
      if (view === 'deleted') return (await db.notes.where('deletedAt').above(0).toArray()).sort((a, b) => b.deletedAt! - a.deletedAt!);
      if (view === 'search' || !folderId) return [];
      return (await db.notes.where('folderId').equals(folderId).toArray()).filter((n) => !n.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt);
    }, [view, folderId]) ?? [];
  const hits = useLiveQuery(() => (view === 'search' && query.trim() ? searchNotes(query) : Promise.resolve([] as Hit[])), [view, query]);
  const hitFor = new Map((hits ?? []).map((h) => [h.note.id, h]));
  const notes = view === 'search' ? (hits ?? []).map((h) => h.note) : listed;
  const folderNames = useLiveQuery(async () => (view === 'search' ? new Map((await db.folders.toArray()).map((f) => [f.id, f.name])) : null), [view]);
  const [shown, sentinel] = useMoreOnScroll(`${view}:${folderId}:${query}`, notes.length);

  const title = view === 'deleted' ? 'Recently Deleted' : view === 'search' ? 'Search' : folder?.name ?? 'Notes';

  const groups: { label: string; items: Note[] }[] = [];
  const pinned = view === 'folder' ? notes.filter((n) => n.pinned) : [];
  if (pinned.length) groups.push({ label: 'Pinned', items: pinned });
  let drawn = pinned.length;
  for (const n of notes) {
    if (view === 'folder' && n.pinned) continue;
    if (drawn++ >= shown) break;
    const label = view === 'deleted' ? 'Deleted notes are removed after 30 days' : view === 'search' ? `${notes.length} result${notes.length === 1 ? '' : 's'}` : groupLabel(n.updatedAt);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(n);
    else groups.push({ label, items: [n] });
  }

  const snippetFor = (n: Note) => {
    const hit = hitFor.get(n.id);
    if (hit) return highlight(hit.excerpt || n.snippet, hit.marks);
    return n.snippet || (n.kind === 'lecture' ? 'Lecture recording' : 'No additional text');
  };

  return (
    <section className={`list-pane${view === 'search' ? ' searching' : ''}`}>
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
            <button className="icon-btn" aria-label="New note to write by hand" title="New note to write by hand" onClick={(e) => openTpl(e.currentTarget)}>
              <IHandwriting />
            </button>
            <button className="icon-btn accent" onClick={() => createNote(folderId)} aria-label="New note" title="New typed note">
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
        {view === 'search' ? (
          <span className="search-help">
            Best matches first. Narrow with <code>tag:</code> <code>folder:</code> <code>subject:</code> <code>is:pinned</code> <code>is:lecture</code> <code>is:handwritten</code> or <code>"a phrase"</code>.
          </span>
        ) : (
          <>
            {notes.length} note{notes.length === 1 ? '' : 's'}
          </>
        )}
      </div>
      <div className="list-scroll">
        {notes.length === 0 && (
          <Empty title={view === 'search' ? 'No results' : view === 'deleted' ? 'Nothing here' : 'No notes yet'}>
            {view === 'folder' && 'Type a note, write one by hand with Apple Pencil, or record a lecture.'}
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
                  onClick={() => nav({ noteId: n.id, pane: 'editor', focusPanel: null, ...(view === 'search' ? { folderId: n.folderId } : {}) })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ note: n, el: e.currentTarget });
                  }}
                >
                  <div className="note-title">
                    {n.kind === 'lecture' && <IMic size={14} className="note-kind" />}
                    <span className="note-title-text">{hitFor.has(n.id) ? highlight(n.title || 'New Note', hitFor.get(n.id)!.marks) : n.title || 'New Note'}</span>
                  </div>
                  {view === 'search' && folderNames?.get(n.folderId) && <div className="note-folder">{folderNames.get(n.folderId)}</div>}
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
        {shown < notes.length && (
          <div ref={sentinel} className="list-more">
            <button className="btn small" onClick={() => sentinel.current?.scrollIntoView()}>
              Showing {shown} of {notes.length}
            </button>
          </div>
        )}
      </div>
      {tplAnchor && folderId && (
        <Menu
          anchor={tplAnchor}
          onClose={closeTpl}
          items={HANDWRITING_TEMPLATES.map((t) => ({
            label: t.label,
            hint: t.description,
            icon: <IHandwriting size={17} />,
            onClick: () => createHandwrittenNote(folderId, t.paper),
          }))}
        />
      )}
      {menu && (
        <Menu
          anchor={menu.el}
          onClose={() => setMenu(null)}
          items={
            view === 'deleted'
              ? [
                  { label: 'Recover', onClick: () => restoreNote(menu.note.id) },
                  {
                    label: 'Delete permanently',
                    danger: true,
                    onClick: async () => {
                      if (await confirmDialog('Delete this note for good? This can’t be undone.', 'Delete permanently')) await deleteNotesForever([menu.note.id]);
                    },
                  },
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
