import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, deleteFolder, uid, type Folder } from '../db';
import { nav, openModal, useNav } from '../lib/nav';
import { computeStreak, deckCounts } from '../lib/study';
import { updateSettings, useSettings } from '../lib/settings';
import { useDark } from '../lib/theme';
import { confirmDialog, Menu, promptDialog } from './ui';
import { ICalendar, ICards, IChecklist, IChevD, IChevR, IFlame, IGear, IGraph, IMoon, IMore, IPlus, ISearch, ISun, ITimer, ITrash, ITutor, IX } from './Icons';
import { canNest, folderTree, visibleRows } from '../lib/folders';
import { foldersChanged } from '../lib/studyTime';
import { useRevisionSummary } from './RevisionView';
import { AppIcon, FOLDER_ICONS } from './AppIcon';
import { IconPicker } from './IconPicker';
import { NextClass } from './NextClass';
import { inSmartList } from '../lib/reminders';
import { dateIn } from '../lib/timetable';


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
  const [iconFor, setIconFor] = useState<{ folder: Folder; el: HTMLElement } | null>(null);
  const [subjectFor, setSubjectFor] = useState<{ folder: Folder; el: HTMLElement } | null>(null);
  const [moveFor, setMoveFor] = useState<{ folder: Folder; el: HTMLElement } | null>(null);
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  const rows = visibleRows(folderTree(folders));
  const hasChildren = new Set(folders.map((f) => f.parentId).filter(Boolean));
  const revision = useRevisionSummary();
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

  const newFolder = async (parent?: Folder) => {
    const name = await promptDialog(parent ? `New Folder in ${parent.name}` : 'New Folder', '', 'Folder name');
    if (!name) return;
    const id = uid();
    await db.folders.add({ id, name, icon: 'folder', createdAt: Date.now(), order: folders.length, notesAsSources: true, ...(parent ? { parentId: parent.id } : {}) });
    if (parent?.collapsed) await db.folders.update(parent.id, { collapsed: false });
    foldersChanged();
    nav({ view: 'folder', folderId: id, noteId: null, pane: 'list', drawer: false });
  };
  const subjectName = (id?: string) => subjects.find((x) => x.id === id);

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
        <button className={`side-row study-row ${view === 'revision' ? 'on' : ''}`} onClick={() => nav({ view: 'revision', pane: 'list', drawer: false })}>
          <ITimer className="side-icon" />
          <span className="side-name">Revision</span>
          {revision && revision.bestStreak > 0 && (
            <span className="streak-pill" title={`Longest subject streak running: ${revision.bestStreak} days`}>
              <IFlame size={13} /> {revision.bestStreak}
            </span>
          )}
          {revision?.timerOn && <span className="rec-dot" title="Revision timer running" />}
        </button>
        <button className={`side-row study-row ${view === 'tutor' ? 'on' : ''}`} onClick={() => nav({ view: 'tutor', pane: 'list', drawer: false })}>
          <ITutor className="side-icon" />
          <span className="side-name">Tutor</span>
        </button>
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
          <span className="side-section-actions">
            <button className={`icon-btn small ${view === 'graph' ? 'on' : ''}`} onClick={() => nav({ view: 'graph', graphFocus: null, pane: 'list', drawer: false })} aria-label="Graph view" title="Graph view">
              <IGraph size={16} />
            </button>
            <button className="icon-btn small" onClick={() => newFolder()} aria-label="New folder">
              <IPlus size={16} />
            </button>
          </span>
        </div>
        {rows.map(({ folder: f, depth }) => {
          const sub = f.subjectId ? subjectName(f.subjectId) : undefined;
          return (
            <div key={f.id} className={`side-row folder-row ${view === 'folder' && folderId === f.id ? 'on' : ''}`} style={{ paddingLeft: 4 + depth * 16 }}>
              {hasChildren.has(f.id) ? (
                <button className="icon-btn small fold-toggle" onClick={() => db.folders.update(f.id, { collapsed: !f.collapsed })} aria-label={f.collapsed ? `Show folders in ${f.name}` : `Hide folders in ${f.name}`} aria-expanded={!f.collapsed}>
                  {f.collapsed ? <IChevR size={13} /> : <IChevD size={13} />}
                </button>
              ) : (
                <span className="fold-toggle" />
              )}
              <button className="side-main" onClick={() => nav({ view: 'folder', folderId: f.id, noteId: null, pane: 'list', drawer: false })}>
                <span className="side-emoji">
                  <AppIcon name={f.icon ?? f.emoji} />
                </span>
                <span className="side-name">{f.name}</span>
                {sub && <span className="subject-tick" style={{ background: sub.color }} title={`Counts toward ${sub.name}`} />}
                <span className="side-count">{counts?.map.get(f.id) ?? 0}</span>
              </button>
              <button className="icon-btn small side-more" onClick={(e) => setMenuFor({ folder: f, el: e.currentTarget })} aria-label={`${f.name} options`}>
                <IMore size={16} />
              </button>
            </div>
          );
        })}
        <button className="side-row new-folder" onClick={() => newFolder()}>
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
            { label: 'Change icon…', onClick: () => setIconFor(menuFor) },
            { label: 'New folder inside…', onClick: () => newFolder(menuFor.folder) },
            { label: 'Move into…', onClick: () => setMoveFor(menuFor) },
            {
              label: `Subject: ${subjectName(menuFor.folder.subjectId)?.name ?? (menuFor.folder.parentId ? 'same as folder above' : 'none')}…`,
              onClick: () => setSubjectFor(menuFor),
            },
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
      {subjectFor && (
        <Menu
          anchor={subjectFor.el}
          onClose={() => setSubjectFor(null)}
          items={[
            ...subjects.map((x) => ({
              label: `${subjectFor.folder.subjectId === x.id ? '✓ ' : ''}${x.name}`,
              onClick: async () => {
                await db.folders.update(subjectFor.folder.id, { subjectId: x.id });
                foldersChanged();
              },
            })),
            { divider: true, label: '' },
            {
              label: `${subjectFor.folder.subjectId ? '' : '✓ '}${subjectFor.folder.parentId ? 'Same as the folder above' : 'No subject'}`,
              onClick: async () => {
                await db.folders.update(subjectFor.folder.id, { subjectId: undefined });
                foldersChanged();
              },
            },
          ]}
        />
      )}
      {moveFor && (
        <Menu
          anchor={moveFor.el}
          onClose={() => setMoveFor(null)}
          items={[
            {
              label: 'Top level',
              disabled: !moveFor.folder.parentId,
              onClick: async () => {
                await db.folders.update(moveFor.folder.id, { parentId: undefined });
                foldersChanged();
              },
            },
            { divider: true, label: '' },
            ...visibleRows(folderTree(folders.map((f) => ({ ...f, collapsed: false })))).map(({ folder: f, depth }) => ({
              label: `${'\u2003'.repeat(depth)}${f.name}`,
              icon: <AppIcon name={f.icon ?? f.emoji} size={17} />,
              disabled: f.id === moveFor.folder.parentId || !canNest(folders, moveFor.folder.id, f.id),
              onClick: async () => {
                await db.folders.update(moveFor.folder.id, { parentId: f.id });
                foldersChanged();
              },
            })),
          ]}
        />
      )}
      {iconFor && <IconPicker anchor={iconFor.el} icons={FOLDER_ICONS} onClose={() => setIconFor(null)} onPick={(icon) => db.folders.update(iconFor.folder.id, { icon })} />}
    </aside>
  );
}
