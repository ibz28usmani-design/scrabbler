import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, deleteFolder, uid, type Folder } from '../db';
import { nav, openModal, useNav } from '../lib/nav';
import { computeStreak, deckCounts } from '../lib/study';
import { useSettings } from '../lib/settings';
import { confirmDialog, Menu, promptDialog } from './ui';
import { ICards, IFlame, IFolder, IGear, IMore, IPlus, ISearch, ITrash, IX } from './Icons';

const EMOJIS = ['🗒️', '📚', '🧪', '🧠', '💼', '🎓', '🧬', '📐', '🌍', '💡', '🎨', '🩺', '⚖️', '💻', '🎵', '✈️', '🏠', '❤️'];

export function Sidebar() {
  const { view, folderId, query } = useNav();
  const { dailyGoal } = useSettings();
  const folders = useLiveQuery(() => db.folders.orderBy('order').toArray(), []) ?? [];
  const counts = useLiveQuery(async () => {
    const notes = await db.notes.toArray();
    const map = new Map<string, number>();
    let deleted = 0;
    for (const n of notes) {
      if (n.deletedAt) deleted++;
      else map.set(n.folderId, (map.get(n.folderId) ?? 0) + 1);
    }
    return { map, deleted };
  }, []);
  const due = useLiveQuery(async () => deckCounts(await db.cards.toArray()), []);
  const streak = useLiveQuery(() => computeStreak(dailyGoal), [dailyGoal]);
  const [menuFor, setMenuFor] = useState<{ folder: Folder; el: HTMLElement } | null>(null);
  const [emojiFor, setEmojiFor] = useState<{ folder: Folder; el: HTMLElement } | null>(null);
  const [q, setQ] = useState(query);

  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim()) nav({ view: 'search', query: q, pane: 'list', drawer: false });
      else if (view === 'search') nav({ view: 'folder', query: '' });
    }, 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const newFolder = async () => {
    const name = await promptDialog('New Folder', '', 'Folder name');
    if (!name) return;
    const id = uid();
    await db.folders.add({ id, name, emoji: EMOJIS[folders.length % EMOJIS.length], createdAt: Date.now(), order: folders.length, notesAsSources: true });
    nav({ view: 'folder', folderId: id, noteId: null, pane: 'list', drawer: false });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <span className="brand-mark">✦</span> Scrabbler
        </div>
        <button className="icon-btn" onClick={() => openModal({ type: 'settings' })} aria-label="Settings">
          <IGear />
        </button>
      </div>
      <div className="search">
        <ISearch size={16} />
        <input placeholder="Search all notes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        {q && (
          <button className="icon-btn small" onClick={() => setQ('')} aria-label="Clear search">
            <IX size={14} />
          </button>
        )}
      </div>

      <nav className="side-scroll">
        <div className="side-section">Study</div>
        <button className={`side-row study-row ${view === 'study' ? 'on' : ''}`} onClick={() => nav({ view: 'study', deckId: null, session: null, pane: 'list', drawer: false })}>
          <ICards className="side-icon" />
          <span className="side-name">Flashcards & Quizzes</span>
          {streak && streak.days > 0 && (
            <span className="streak-pill" title={`${streak.days}-day streak`}>
              <IFlame size={13} /> {streak.days}
            </span>
          )}
          {!!due?.due && <span className="badge">{due.due}</span>}
        </button>

        <div className="side-section">
          Folders
          <button className="icon-btn small" onClick={newFolder} aria-label="New folder">
            <IPlus size={16} />
          </button>
        </div>
        {folders.map((f) => (
          <div key={f.id} className={`side-row ${view === 'folder' && folderId === f.id ? 'on' : ''}`}>
            <button className="side-main" onClick={() => nav({ view: 'folder', folderId: f.id, noteId: null, pane: 'list', drawer: false })}>
              <span className="side-emoji">{f.emoji || <IFolder />}</span>
              <span className="side-name">{f.name}</span>
              <span className="side-count">{counts?.map.get(f.id) ?? 0}</span>
            </button>
            <button className="icon-btn small side-more" onClick={(e) => setMenuFor({ folder: f, el: e.currentTarget })} aria-label={`${f.name} options`}>
              <IMore size={16} />
            </button>
          </div>
        ))}
        <button className="side-row new-folder" onClick={newFolder}>
          <IPlus className="side-icon" size={18} />
          <span className="side-name">New Folder</span>
        </button>

        <div className="side-section" />
        <button className={`side-row ${view === 'deleted' ? 'on' : ''}`} onClick={() => nav({ view: 'deleted', noteId: null, pane: 'list', drawer: false })}>
          <ITrash className="side-icon" size={18} />
          <span className="side-name">Recently Deleted</span>
          <span className="side-count">{counts?.deleted ?? 0}</span>
        </button>
      </nav>

      {menuFor && (
        <Menu
          anchor={menuFor.el}
          onClose={() => setMenuFor(null)}
          items={[
            {
              label: 'Rename…',
              onClick: async () => {
                const name = await promptDialog('Rename Folder', menuFor.folder.name);
                if (name) db.folders.update(menuFor.folder.id, { name });
              },
            },
            { label: 'Change icon…', onClick: () => setEmojiFor(menuFor) },
            {
              label: menuFor.folder.notesAsSources ? '✓ Use notes as AI sources' : 'Use notes as AI sources',
              onClick: () => db.folders.update(menuFor.folder.id, { notesAsSources: !menuFor.folder.notesAsSources }),
            },
            { divider: true, label: '' },
            {
              label: 'Delete folder',
              danger: true,
              disabled: folders.length <= 1,
              onClick: async () => {
                if (!(await confirmDialog(`Delete “${menuFor.folder.name}”? Its notes move to Recently Deleted; its sources, chats and studio items are removed.`))) return;
                await deleteFolder(menuFor.folder.id);
                const first = folders.find((f) => f.id !== menuFor.folder.id);
                nav({ folderId: first?.id ?? null, noteId: null });
              },
            },
          ]}
        />
      )}
      {emojiFor && (
        <Menu
          anchor={emojiFor.el}
          onClose={() => setEmojiFor(null)}
          items={EMOJIS.map((e) => ({ label: <span className="emoji-pick">{e}</span>, onClick: () => db.folders.update(emojiFor.folder.id, { emoji: e }) }))}
        />
      )}
    </aside>
  );
}
