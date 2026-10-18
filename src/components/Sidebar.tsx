import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, deleteFolder, uid, type Folder } from '../db';
import { nav, openModal, useNav } from '../lib/nav';
import { computeStreak, deckCounts } from '../lib/study';
import { updateSettings, useSettings } from '../lib/settings';
import { useDark } from '../lib/theme';
import { confirmDialog, Menu, promptDialog } from './ui';
import { ICalendar, ICards, IChecklist, IFlame, IFolder, IGear, IMoon, IMore, IPlus, ISearch, ISun, ITrash, IX } from './Icons';
import { NextClass } from './NextClass';
import { inSmartList } from '../lib/reminders';
import { dateIn } from '../lib/timetable';

const EMOJIS = ['🗒️', '📚', '🧪', '🧠', '💼', '🎓', '🧬', '📐', '🌍', '💡', '🎨', '🩺', '⚖️', '💻', '🎵', '✈️', '🏠', '❤️'];

export function Sidebar() {
  const { view, folderId, query } = useNav();
  const { dailyGoal } = useSettings();
  const dark = useDark();
  const folders = useLiveQuery(() => db.folders.orderBy('order').toArray(), []) ?? [];
  // From the indexes alone: this re-runs on every note save, and loading each
  // note's whole content and ink just to count them made typing heavy.
  const counts = useLiveQuery(async () => {
    const gone = new Set(await db.notes.where('deletedAt').above(0).primaryKeys());
    const map = new Map<string, number>();
    await db.notes.orderBy('folderId').eachKey((folderId, cursor) => {
      if (!gone.has(cursor.primaryKey as string)) map.set(folderId as string, (map.get(folderId as string) ?? 0) + 1);
    });
    return { map, deleted: gone.size };
  }, []);
  const due = useLiveQuery(async () => deckCounts(await db.cards.toArray()), []);
  const dueToday = useLiveQuery(async () => {
    const today = dateIn(Date.now());
    return (await db.reminders.toArray()).filter((r) => inSmartList(r, 'today', today)).length;
  }, []);
  const streak = useLiveQuery(() => computeStreak(dailyGoal), [dailyGoal]);
  const [menuFor, setMenuFor] = useState<{ folder: Folder; el: HTMLElement } | null>(null);
  const [emojiFor, setEmojiFor] = useState<{ folder: Folder; el: HTMLElement } | null>(null);
  const [q, setQ] = useState(query);
  // Leaving search another way (a folder, the calendar) leaves the box empty too.
  useEffect(() => {
    if (view !== 'search') setQ('');
  }, [view]);

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
        <div className="brand masthead">
          <span className="brand-name">Scrabbler</span>
        </div>
        <button
          className="icon-btn"
          onClick={() => updateSettings({ theme: dark ? 'light' : 'dark' })}
          aria-label={dark ? 'Paper (light) mode' : 'Charcoal (dark) mode'}
          title={dark ? 'Paper (light) mode' : 'Charcoal (dark) mode'}
        >
          {dark ? <ISun /> : <IMoon />}
        </button>
        <button className="icon-btn" onClick={() => openModal({ type: 'settings' })} aria-label="Settings">
          <IGear />
        </button>
        {/* The front page's dateline, between the rules under the nameplate. */}
        <div className="dateline">
          <span className="brand-tag">Notebook &amp; Study</span>
          <span>{new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
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

        <div className="side-section">Planner</div>
        <NextClass compact />
        <button className={`side-row ${view === 'calendar' ? 'on' : ''}`} onClick={() => nav({ view: 'calendar', pane: 'list', drawer: false })}>
          <ICalendar className="side-icon" />
          <span className="side-name">Calendar</span>
        </button>
        <button className={`side-row ${view === 'reminders' ? 'on' : ''}`} onClick={() => nav({ view: 'reminders', pane: 'list', drawer: false })}>
          <IChecklist className="side-icon" />
          <span className="side-name">Reminders</span>
          {!!dueToday && <span className="badge">{dueToday}</span>}
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
