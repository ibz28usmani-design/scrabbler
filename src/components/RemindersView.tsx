/**
 * Reminders, laid out like Apple's Reminders app: smart lists up top (Today,
 * Scheduled, All, Flagged, Completed), your lists below, and the selected list
 * on the right — tap the circle to complete, ⓘ for details, "New Reminder" to
 * add. Scrabbler adds a subject and a kind of work (homework, essay, exam…).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db, uid } from '../db';
import { nav, toggleSidebar } from '../lib/nav';
import { useNow, useTimetable } from '../lib/calendarData';
import { addDays, dateIn, weekday, type Subject } from '../lib/timetable';
import {
  byDue,
  dueLabel,
  groupScheduled,
  groupToday,
  inSmartList,
  LIST_COLORS,
  nextDue,
  parseQuickDue,
  priorityMarks,
  REMINDER_TYPES,
  REPEATS,
  typeInfo,
  type Group,
  type Priority,
  type Reminder,
  type ReminderList,
  type ReminderType,
  type Repeat,
  type SmartList,
} from '../lib/reminders';
import { confirmDialog, Menu, Modal, useMenu } from './ui';
import { IChevL, IMore, IPlus, ISearch, ISidebar, IX } from './Icons';

// ------------------------------------------------------------------ data

async function firstListId() {
  return (await db.reminderLists.orderBy('order').first())?.id ?? '';
}

export async function addReminder(p: Partial<Reminder> & { title: string }): Promise<Reminder> {
  const listId = p.listId || (await firstListId());
  const last = await db.reminders.where('listId').equals(listId).toArray();
  const now = Date.now();
  const r: Reminder = { flagged: false, priority: 0, completed: false, ...p, id: uid(), listId, order: last.reduce((m, x) => Math.max(m, x.order), 0) + 1, createdAt: now, updatedAt: now };
  await db.reminders.add(r);
  return r;
}

export const updateReminder = (id: string, patch: Partial<Reminder>) =>
  // A date picked by hand starts the repeat afresh from its own day.
  db.reminders.update(id, { ...('due' in patch && !('repeatDay' in patch) ? { repeatDay: undefined } : {}), ...patch, updatedAt: Date.now() });

/** Completing a repeating reminder brings the next one in, as Apple's does. */
export async function toggleComplete(r: Reminder) {
  if (r.completed) return updateReminder(r.id, { completed: false, completedAt: undefined });
  await updateReminder(r.id, { completed: true, completedAt: Date.now() });
  if (r.repeat && r.due) {
    const { id: _id, completedAt: _c, ...rest } = r;
    const repeatDay = r.repeatDay ?? Number(r.due.slice(8));
    await addReminder({ ...rest, completed: false, due: nextDue(r.due, r.repeat, repeatDay), repeatDay });
  }
}

// ------------------------------------------------------------------ icons

const Glyph = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d={d} />
  </svg>
);
const FLAG = 'M5 3h1.6v1.2C8 3.5 9.6 3.3 11.5 4c2 .8 3.6 1 6.5-.3V13c-2.9 1.3-4.5 1.1-6.5.3-1.9-.7-3.5-.5-4.9.2V21H5z';
const TRAY = 'M4 4h16l2 9v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6zm1.6 2-1.4 6.5h4.6a3.2 3.2 0 0 0 6.4 0h4.6L18.4 6z';
const CHECK = 'M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L21 7.5l-1.4-1.4z';
const CAL = 'M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2zm-2 7v10h14V9z';
const LIST = 'M4 6.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zM9 5.5h11v2H9zM4 12a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm5-1h11v2H9zm-5 6.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zM9 16.5h11v2H9z';

const SMART: { id: SmartList; title: string; icon: (today: string) => ReactNode }[] = [
  { id: 'today', title: 'Today', icon: (t) => <span className="smart-date">{Number(t.slice(8))}</span> },
  { id: 'scheduled', title: 'Scheduled', icon: () => <Glyph d={CAL} /> },
  { id: 'all', title: 'All', icon: () => <Glyph d={TRAY} /> },
  { id: 'flagged', title: 'Flagged', icon: () => <Glyph d={FLAG} /> },
  { id: 'completed', title: 'Completed', icon: () => <Glyph d={CHECK} /> },
];

type Selection = { kind: 'smart'; id: SmartList } | { kind: 'list'; id: string } | { kind: 'subject'; id: string };
const SEL_KEY = 'scrabbler.reminders.selection';

function loadSelection(): Selection {
  try {
    const s = JSON.parse(localStorage.getItem(SEL_KEY) || 'null');
    if (s && typeof s.id === 'string') return s;
  } catch {
    /* ignore */
  }
  return { kind: 'smart', id: 'today' };
}

// ------------------------------------------------------------------ screen

export function RemindersView({ narrow, showSidebarToggle }: { narrow: boolean; showSidebarToggle: boolean }) {
  const lists = useLiveQuery(() => db.reminderLists.orderBy('order').toArray(), []) ?? [];
  const reminders = useLiveQuery(() => db.reminders.toArray(), []) ?? [];
  const subjects = useTimetable()?.subjects ?? [];
  const now = useNow(60000);
  const today = dateIn(now);
  const [sel, setSelState] = useState<Selection>(loadSelection);
  const [showMain, setShowMain] = useState(false);
  const [query, setQuery] = useState('');
  const [editingList, setEditingList] = useState<ReminderList | 'new' | null>(null);

  const setSel = (s: Selection) => {
    setSelState(s);
    setQuery('');
    setShowMain(true);
    try {
      localStorage.setItem(SEL_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  };

  // A deleted list falls back to Today.
  useEffect(() => {
    if (sel.kind === 'list' && lists.length && !lists.some((l) => l.id === sel.id)) setSelState({ kind: 'smart', id: 'today' });
  }, [lists, sel]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of SMART) c[s.id] = reminders.filter((r) => inSmartList(r, s.id, today)).length;
    for (const l of lists) c[l.id] = reminders.filter((r) => r.listId === l.id && !r.completed).length;
    for (const s of subjects) c[`subject:${s.id}`] = reminders.filter((r) => r.subjectId === s.id && !r.completed).length;
    return c;
  }, [reminders, lists, subjects, today]);

  const side = (
    <div className="rem-side">
      <div className="rem-search">
        <ISearch size={15} />
        <input placeholder="Search" value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value) setShowMain(true); }} aria-label="Search reminders" />
        {query && (
          <button className="icon-btn small" onClick={() => setQuery('')} aria-label="Clear search">
            <IX size={13} />
          </button>
        )}
      </div>
      <div className="smart-grid">
        {SMART.map((s) => (
          <button key={s.id} className={`smart-card ${sel.kind === 'smart' && sel.id === s.id && !query ? 'on' : ''}`} onClick={() => setSel({ kind: 'smart', id: s.id })}>
            <span className="smart-icon">
              {s.icon(today)}
            </span>
            <span className="smart-count">{s.id === 'completed' ? '' : counts[s.id]}</span>
            <span className="smart-title">{s.title}</span>
          </button>
        ))}
      </div>
      <div className="rem-section">My Lists</div>
      <div className="rem-lists">
        {lists.map((l) => (
          <button key={l.id} className={`rem-list-row ${sel.kind === 'list' && sel.id === l.id && !query ? 'on' : ''}`} onClick={() => setSel({ kind: 'list', id: l.id })}>
            <span className="list-dot" style={{ background: l.color }}>
              <Glyph d={LIST} size={14} />
            </span>
            <span className="rem-list-name">{l.name}</span>
            <span className="rem-list-count">{counts[l.id] || ''}</span>
          </button>
        ))}
      </div>
      {subjects.length > 0 && (
        <>
          <div className="rem-section">Subjects</div>
          <div className="subject-chips">
            {subjects.map((s) => (
              <button key={s.id} className={`subject-chip ${sel.kind === 'subject' && sel.id === s.id && !query ? 'on' : ''}`} style={{ ['--subject' as string]: s.color }} onClick={() => setSel({ kind: 'subject', id: s.id })}>
                {s.short ?? s.name}
                {counts[`subject:${s.id}`] ? <b>{counts[`subject:${s.id}`]}</b> : null}
              </button>
            ))}
          </div>
        </>
      )}
      <button className="rem-add-list" onClick={() => setEditingList('new')}>
        Add List
      </button>
    </div>
  );

  const main = <ListPane sel={sel} query={query} lists={lists} reminders={reminders} subjects={subjects} today={today} narrow={narrow} onBack={() => setShowMain(false)} onEditList={setEditingList} />;

  return (
    <div className="study reminders">
      <div className="study-head">
        {narrow ? (
          showMain ? (
            <button className="icon-btn accent" onClick={() => setShowMain(false)}>
              <IChevL /> <span className="back-label">Lists</span>
            </button>
          ) : (
            <button className="icon-btn accent" onClick={() => nav({ pane: 'sidebar' })}>
              <IChevL /> <span className="back-label">Folders</span>
            </button>
          )
        ) : (
          showSidebarToggle && (
            <button className="icon-btn" onClick={toggleSidebar} aria-label="Toggle sidebar">
              <ISidebar />
            </button>
          )
        )}
        <h1>Reminders</h1>
      </div>
      <div className={`rem-body ${narrow ? 'narrow' : ''}`}>
        {(!narrow || !showMain) && side}
        {(!narrow || showMain) && main}
      </div>
      {editingList && <ListEditor list={editingList === 'new' ? null : editingList} count={lists.length} onClose={() => setEditingList(null)} onCreated={(id) => setSel({ kind: 'list', id })} />}
    </div>
  );
}

// ------------------------------------------------------------------ the list on the right

function ListPane({ sel, query, lists, reminders, subjects, today, onEditList }: { sel: Selection; query: string; lists: ReminderList[]; reminders: Reminder[]; subjects: Subject[]; today: string; narrow: boolean; onBack: () => void; onEditList: (l: ReminderList) => void }) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [lingering, setLingering] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [menuAnchor, openMenu, closeMenu] = useMenu();
  const listById = (id: string) => lists.find((l) => l.id === id);
  const list = sel.kind === 'list' ? listById(sel.id) : undefined;
  const smart = sel.kind === 'smart' ? SMART.find((s) => s.id === sel.id) : undefined;
  const subject = sel.kind === 'subject' ? subjects.find((s) => s.id === sel.id) : undefined;
  const title = query ? `Results for “${query}”` : (list?.name ?? smart?.title ?? subject?.name ?? 'Reminders');
  // Titles stay in ink, as everywhere else in the app; a list's or subject's colour marks it with a dot.
  const color = list?.color ?? subject?.color;

  useEffect(() => {
    setAdding(false);
    setShowCompleted(false);
  }, [sel.kind, sel.id]);

  // Just-completed reminders stay a moment before leaving, as in Apple's app.
  const complete = async (r: Reminder) => {
    if (!r.completed) {
      setLingering((s) => new Set(s).add(r.id));
      setTimeout(() => setLingering((s) => { const n = new Set(s); n.delete(r.id); return n; }), 1600);
    }
    await toggleComplete(r);
  };

  const visible = (r: Reminder) => !r.completed || showCompleted || lingering.has(r.id) || (sel.kind === 'smart' && sel.id === 'completed');
  let items: Reminder[];
  if (query) {
    const q = query.toLowerCase();
    items = reminders.filter((r) => `${r.title} ${r.notes ?? ''}`.toLowerCase().includes(q) && visible(r));
  } else if (sel.kind === 'smart') {
    items = reminders.filter((r) => inSmartList(r, sel.id, today) || (lingering.has(r.id) && inSmartList({ ...r, completed: false }, sel.id, today)));
    if (sel.id !== 'completed' && showCompleted) items = items.concat(reminders.filter((r) => r.completed && !items.includes(r) && inSmartList({ ...r, completed: false }, sel.id, today)));
  } else if (sel.kind === 'list') items = reminders.filter((r) => r.listId === sel.id && visible(r));
  else items = reminders.filter((r) => r.subjectId === sel.id && visible(r));

  let groups: Group<Reminder>[];
  if (!query && sel.kind === 'smart' && sel.id === 'today') groups = groupToday(items, today);
  else if (!query && sel.kind === 'smart' && sel.id === 'scheduled') groups = groupScheduled(items, today);
  else if (!query && sel.kind === 'smart' && (sel.id === 'all' || sel.id === 'completed'))
    groups = lists
      .map((l) => ({ key: l.id, title: l.name, items: items.filter((r) => r.listId === l.id).sort(sel.id === 'completed' ? (a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) : byManual) }))
      .filter((g) => g.items.length);
  else groups = [{ key: 'all', title: '', items: [...items].sort(sel.kind === 'list' ? byManual : byDue) }];

  // What a new reminder made here starts with.
  const defaults: Partial<Reminder> =
    sel.kind === 'list' ? { listId: sel.id } : sel.kind === 'subject' ? { subjectId: sel.id } : sel.id === 'today' || sel.id === 'scheduled' ? { due: today } : sel.id === 'flagged' ? { flagged: true } : {};
  const canAdd = !(sel.kind === 'smart' && sel.id === 'completed') && !query;
  const done = items.filter((r) => r.completed).length;

  return (
    <div className="rem-main">
      <div className="rem-title-row">
        <h2 className="rem-title">
          {color && <span className="rem-title-dot" style={{ background: color }} />}
          {title}
        </h2>
        {!query && sel.kind === 'smart' && sel.id !== 'completed' && <span className="rem-title-count">{items.filter((r) => !r.completed).length}</span>}
        <span className="spacer" />
        {!query && (
          <button className="icon-btn" onClick={(e) => openMenu(e.currentTarget)} aria-label="List options">
            <IMore />
          </button>
        )}
      </div>
      <div className="rem-scroll">
        {groups.map((g) => (
          <div key={g.key} className="rem-group">
            {g.title && (
              <div className={`rem-group-title ${g.key === 'overdue' ? 'late' : ''}`}>
                {sel.kind === 'smart' && (sel.id === 'all' || sel.id === 'completed') && <span className="rem-title-dot small" style={{ background: listById(g.key)?.color }} />}
                {g.title}
              </div>
            )}
            {g.items.map((r) => (
              <ReminderRow key={r.id} r={r} list={listById(r.listId)} subjects={subjects} today={today} showList={sel.kind !== 'list'} onComplete={() => complete(r)} onInfo={() => setInfo(r.id)} />
            ))}
          </div>
        ))}
        {!groups.length && !adding && <div className="rem-empty">{query ? 'No results' : sel.kind === 'smart' && sel.id === 'completed' ? 'No completed reminders' : 'No reminders'}</div>}
        {adding && <NewReminderRow defaults={defaults} subjects={subjects} today={today} onDone={() => setAdding(false)} />}
      </div>
      {canAdd && !adding && (
        <button className="rem-new" onClick={() => setAdding(true)}>
          <span className="rem-new-plus">
            <IPlus size={14} />
          </span>
          New Reminder
        </button>
      )}
      {menuAnchor && (
        <Menu
          anchor={menuAnchor}
          align="right"
          onClose={closeMenu}
          items={[
            ...(sel.kind === 'smart' && sel.id === 'completed'
              ? []
              : [{ label: showCompleted ? 'Hide Completed' : 'Show Completed', hint: done ? String(done) : undefined, onClick: () => setShowCompleted(!showCompleted) }]),
            ...(sel.kind === 'smart' && sel.id === 'completed'
              ? [
                  {
                    label: 'Clear All Completed…',
                    danger: true,
                    onClick: async () => {
                      const ids = reminders.filter((r) => r.completed).map((r) => r.id);
                      if (ids.length && (await confirmDialog(`Delete ${ids.length} completed reminder${ids.length === 1 ? '' : 's'}?`))) await db.reminders.bulkDelete(ids);
                    },
                  },
                ]
              : []),
            ...(list
              ? [
                  { divider: true, label: '' },
                  { label: 'Show List Info', onClick: () => onEditList(list) },
                  {
                    label: 'Delete List…',
                    danger: true,
                    disabled: lists.length <= 1,
                    onClick: async () => {
                      const n = reminders.filter((r) => r.listId === list.id).length;
                      if (!(await confirmDialog(`Delete “${list.name}”${n ? ` and its ${n} reminder${n === 1 ? '' : 's'}` : ''}?`))) return;
                      await db.transaction('rw', db.reminders, db.reminderLists, async () => {
                        await db.reminders.where('listId').equals(list.id).delete();
                        await db.reminderLists.delete(list.id);
                      });
                    },
                  },
                ]
              : []),
          ]}
        />
      )}
      {info && <ReminderDetails id={info} lists={lists} subjects={subjects} onClose={() => setInfo(null)} />}
    </div>
  );
}

const byManual = (a: Reminder, b: Reminder) => a.order - b.order;

// ------------------------------------------------------------------ one reminder

function ReminderRow({ r, list, subjects, today, showList, onComplete, onInfo }: { r: Reminder; list?: ReminderList; subjects: Subject[]; today: string; showList: boolean; onComplete: () => void; onInfo: () => void }) {
  const [title, setTitle] = useState(r.title);
  const [swipe, setSwipe] = useState(0);
  const drag = useRef<{ x: number; y: number; base: number; active: boolean } | null>(null);
  useEffect(() => setTitle(r.title), [r.title]);
  const due = dueLabel(r, today);
  const subject = subjects.find((s) => s.id === r.subjectId);
  const kind = typeInfo(r.type);

  const commit = () => {
    const t = title.trim();
    if (!t) return setTitle(r.title);
    if (t !== r.title) updateReminder(r.id, { title: t });
  };

  // Swipe left (touch) for Flag and Delete, like Apple's.
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    drag.current = { x: e.clientX, y: e.clientY, base: swipe, active: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.active && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(e.clientY - d.y)) d.active = true;
    if (d.active) setSwipe(Math.max(-150, Math.min(0, d.base + dx)));
  };
  const onUp = () => {
    if (drag.current?.active) setSwipe((s) => (s < -60 ? -150 : 0));
    drag.current = null;
  };

  return (
    <div className="rem-row-wrap">
      <div className="rem-actions" aria-hidden={swipe === 0}>
        <button className="rem-act flag" onClick={() => (setSwipe(0), updateReminder(r.id, { flagged: !r.flagged }))}>
          {r.flagged ? 'Unflag' : 'Flag'}
        </button>
        <button className="rem-act delete" onClick={() => db.reminders.delete(r.id)}>
          Delete
        </button>
      </div>
      <div className={`rem-row ${r.completed ? 'done' : ''}`} style={{ transform: swipe ? `translateX(${swipe}px)` : undefined }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <button className={`rem-circle ${r.completed ? 'on' : ''}`} onClick={onComplete} aria-label={r.completed ? `Mark “${r.title}” as not completed` : `Complete “${r.title}”`} />
        <div className="rem-text">
          <div className="rem-line">
            {r.priority > 0 && <span className="rem-priority">{priorityMarks(r.priority)}</span>}
            <input className="rem-input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} aria-label="Reminder" />
          </div>
          {r.notes && <div className="rem-notes">{r.notes}</div>}
          {(due || subject || kind || r.repeat || (showList && list)) && (
            <div className="rem-meta">
              {due && <span className={due.overdue ? 'late' : ''}>{due.text}</span>}
              {r.repeat && <span title="Repeats">↻ {REPEATS.find((x) => x.id === r.repeat)?.label}</span>}
              {subject && (
                <span className="rem-subject" style={{ ['--subject' as string]: subject.color }}>
                  {subject.short ?? subject.name}
                </span>
              )}
              {kind && (
                <span className="rem-type">
                  {kind.emoji} {kind.label}
                </span>
              )}
              {showList && list && (
                <span className="rem-list-tag" style={{ ['--list' as string]: list.color }}>
                  {list.name}
                </span>
              )}
            </div>
          )}
        </div>
        {r.flagged && (
          <span className="rem-flag">
            <Glyph d={FLAG} size={16} />
          </span>
        )}
        <button className="rem-info" onClick={onInfo} aria-label={`Details for “${r.title}”`}>
          i
        </button>
      </div>
    </div>
  );
}

/** The row you type a new reminder into, with Apple's quick toolbar under it. */
function NewReminderRow({ defaults, subjects, today, onDone }: { defaults: Partial<Reminder>; subjects: Subject[]; today: string; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState<string | undefined>(defaults.due);
  const [subjectId, setSubjectId] = useState<string | undefined>(defaults.subjectId);
  const [type, setType] = useState<ReminderType | undefined>();
  const [flagged, setFlagged] = useState(!!defaults.flagged);
  const input = useRef<HTMLInputElement>(null);
  const [dateAnchor, openDate, closeDate] = useMenu();
  const [subjAnchor, openSubj, closeSubj] = useMenu();
  const [typeAnchor, openType, closeType] = useMenu();
  useEffect(() => input.current?.focus(), []);

  const save = async (keepGoing: boolean) => {
    if (!title.trim()) return onDone();
    const parsed = parseQuickDue(title, today);
    await addReminder({ ...defaults, title: parsed.title, due: parsed.due ?? due, time: parsed.time, subjectId, type, flagged });
    setTitle('');
    setDue(defaults.due);
    setSubjectId(defaults.subjectId);
    setType(undefined);
    setFlagged(!!defaults.flagged);
    if (!keepGoing) onDone();
    else input.current?.focus();
  };

  const weekend = (() => {
    let k = today;
    while (weekday(k) !== 6) k = addDays(k, 1);
    return k;
  })();
  const subject = subjects.find((s) => s.id === subjectId);
  const kind = typeInfo(type);

  return (
    <div className="rem-row new">
      <span className="rem-circle" />
      <div className="rem-text">
        <input
          ref={input}
          className="rem-input"
          placeholder="New Reminder — try “Law essay friday 4pm”"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              save(true);
            }
            if (e.key === 'Escape') onDone();
          }}
          onBlur={(e) => {
            // Taps on the quick toolbar keep the row open.
            if (!(e.relatedTarget as HTMLElement | null)?.closest('.quickbar') && !document.querySelector('.menu')) save(false);
          }}
        />
        <div className="quickbar">
          <button className={`quick ${due ? 'on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={(e) => openDate(e.currentTarget)}>
            📅 {due ? dueLabel({ due } as Reminder, today)?.text : 'Date'}
          </button>
          <button className={`quick ${subject ? 'on' : ''}`} style={subject ? { ['--subject' as string]: subject.color } : undefined} onMouseDown={(e) => e.preventDefault()} onClick={(e) => openSubj(e.currentTarget)}>
            {subject ? <span className="quick-dot" /> : '📚'} {subject?.short ?? subject?.name ?? 'Subject'}
          </button>
          <button className={`quick ${kind ? 'on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={(e) => openType(e.currentTarget)}>
            {kind ? `${kind.emoji} ${kind.label}` : '🏷 Type'}
          </button>
          <button className={`quick ${flagged ? 'on flag' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setFlagged(!flagged)} aria-pressed={flagged}>
            ⚑ Flag
          </button>
        </div>
      </div>
      {dateAnchor && (
        <Menu
          anchor={dateAnchor}
          onClose={() => (closeDate(), input.current?.focus())}
          items={[
            { label: 'Today', hint: dueLabel({ due: today } as Reminder, today)?.text, onClick: () => setDue(today) },
            { label: 'Tomorrow', onClick: () => setDue(addDays(today, 1)) },
            { label: 'This Weekend', onClick: () => setDue(weekend) },
            { label: 'Next Week', onClick: () => setDue(addDays(today, 8 - weekday(today))) },
            ...(due ? [{ divider: true, label: '' }, { label: 'No Date', onClick: () => setDue(undefined) }] : []),
          ]}
        />
      )}
      {subjAnchor && (
        <Menu
          anchor={subjAnchor}
          onClose={() => (closeSubj(), input.current?.focus())}
          items={[{ label: 'No subject', onClick: () => setSubjectId(undefined) }, { divider: true, label: '' }, ...subjects.map((s) => ({ label: <span className="menu-subject" style={{ ['--subject' as string]: s.color }}>{s.name}</span>, onClick: () => setSubjectId(s.id) }))]}
        />
      )}
      {typeAnchor && (
        <Menu
          anchor={typeAnchor}
          onClose={() => (closeType(), input.current?.focus())}
          items={[{ label: 'No type', onClick: () => setType(undefined) }, { divider: true, label: '' }, ...REMINDER_TYPES.map((t) => ({ label: `${t.emoji} ${t.label}`, onClick: () => setType(t.id) }))]}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ details sheet

function ReminderDetails({ id, lists, subjects, onClose }: { id: string; lists: ReminderList[]; subjects: Subject[]; onClose: () => void }) {
  const r = useLiveQuery(async () => (await db.reminders.get(id)) ?? null, [id]);
  const [title, setTitle] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  // Deleted elsewhere (or swiped away): close.
  useEffect(() => {
    if (r === null) onClose();
  }, [r, onClose]);
  if (!r) return null;
  const set = (patch: Partial<Reminder>) => updateReminder(r.id, patch);
  const today = dateIn(Date.now());
  const close = () => {
    const patch: Partial<Reminder> = {};
    if (title !== null && title.trim()) patch.title = title.trim();
    if (notes !== null) patch.notes = notes || undefined;
    if (url !== null) patch.url = url.trim() || undefined;
    if (Object.keys(patch).length) set(patch);
    onClose();
  };

  return (
    <Modal title="Details" onClose={close} className="rem-details">
      <div className="ios-group">
        <input className="ios-field title" value={title ?? r.title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        <textarea className="ios-field" rows={2} placeholder="Notes" value={notes ?? r.notes ?? ''} onChange={(e) => setNotes(e.target.value)} />
        <input className="ios-field" placeholder="URL" inputMode="url" value={url ?? r.url ?? ''} onChange={(e) => setUrl(e.target.value)} />
      </div>

      <div className="ios-group">
        <div className="ios-row">
          <span className="ios-icon">
            <Glyph d={CAL} size={15} />
          </span>
          <span className="ios-label">
            Date
            {r.due && <small>{dueLabel(r, today)?.text.split(',')[0]}</small>}
          </span>
          <Toggle on={!!r.due} onChange={(on) => set(on ? { due: today } : { due: undefined, time: undefined, repeat: undefined, early: undefined })} label="Date" />
        </div>
        {r.due && <input className="ios-field picker" type="date" value={r.due} onChange={(e) => e.target.value && set({ due: e.target.value })} aria-label="Due date" />}
        <div className="ios-row">
          <span className="ios-icon">
            🕑
          </span>
          <span className="ios-label">
            Time
            {r.time && <small>{r.time}</small>}
          </span>
          <Toggle on={!!r.time} onChange={(on) => set(on ? { time: '09:00', due: r.due ?? today } : { time: undefined, early: undefined })} label="Time" />
        </div>
        {r.time && <input className="ios-field picker" type="time" value={r.time} onChange={(e) => e.target.value && set({ time: e.target.value })} aria-label="Due time" />}
        {r.due && (
          <label className="ios-row">
            <span className="ios-icon">
              ↻
            </span>
            <span className="ios-label">Repeat</span>
            <select className="ios-select" value={r.repeat ?? ''} onChange={(e) => set({ repeat: (e.target.value || undefined) as Repeat | undefined })}>
              <option value="">Never</option>
              {REPEATS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {r.time && (
          <label className="ios-row">
            <span className="ios-icon">
              ⏱
            </span>
            <span className="ios-label">Early Reminder</span>
            <select className="ios-select" value={r.early ?? 0} onChange={(e) => set({ early: Number(e.target.value) || undefined })}>
              {[0, 5, 15, 30, 60, 120, 1440].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? 'None' : m < 60 ? `${m} minutes before` : m === 1440 ? '1 day before' : `${m / 60} hour${m > 60 ? 's' : ''} before`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="ios-group">
        <label className="ios-row">
          <span className="ios-icon">
            📚
          </span>
          <span className="ios-label">Subject</span>
          <select className="ios-select" value={r.subjectId ?? ''} onChange={(e) => set({ subjectId: e.target.value || undefined })}>
            <option value="">None</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="type-picker" role="radiogroup" aria-label="Type">
          {REMINDER_TYPES.map((t) => (
            <button key={t.id} role="radio" aria-checked={r.type === t.id} className={`type-chip ${r.type === t.id ? 'on' : ''}`} onClick={() => set({ type: r.type === t.id ? undefined : t.id })}>
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ios-group">
        <div className="ios-row">
          <span className="ios-icon">
            <Glyph d={FLAG} size={15} />
          </span>
          <span className="ios-label">Flag</span>
          <Toggle on={r.flagged} onChange={(flagged) => set({ flagged })} label="Flag" />
        </div>
        <label className="ios-row">
          <span className="ios-label plain">Priority</span>
          <select className="ios-select" value={r.priority} onChange={(e) => set({ priority: Number(e.target.value) as Priority })}>
            <option value={0}>None</option>
            <option value={1}>Low</option>
            <option value={2}>Medium</option>
            <option value={3}>High</option>
          </select>
        </label>
        <label className="ios-row">
          <span className="ios-label plain">List</span>
          <select className="ios-select" value={r.listId} onChange={(e) => set({ listId: e.target.value })}>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        className="ios-delete"
        onClick={async () => {
          await db.reminders.delete(r.id);
          onClose();
        }}
      >
        Delete Reminder
      </button>
    </Modal>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={`ios-toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

function ListEditor({ list, count, onClose, onCreated }: { list: ReminderList | null; count: number; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(list?.name ?? '');
  const [color, setColor] = useState(list?.color ?? LIST_COLORS[(count + 5) % LIST_COLORS.length]);
  const save = async () => {
    if (!name.trim()) return;
    if (list) await db.reminderLists.update(list.id, { name: name.trim(), color });
    else {
      const id = uid();
      await db.reminderLists.add({ id, name: name.trim(), color, order: count, createdAt: Date.now() });
      onCreated(id);
    }
    onClose();
  };
  return (
    <Modal
      title={list ? 'List Info' : 'New List'}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>
            Done
          </button>
        </>
      }
    >
      <div className="list-editor">
        <span className="list-dot big" style={{ background: color }}>
          <Glyph d={LIST} size={30} />
        </span>
        <input className="input list-name" autoFocus value={name} placeholder="List Name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <div className="swatches">
          {LIST_COLORS.map((c) => (
            <button key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Colour ${c}`} />
          ))}
        </div>
      </div>
    </Modal>
  );
}
