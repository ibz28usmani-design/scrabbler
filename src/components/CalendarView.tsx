/**
 * The calendar: an illustrated poster and a hand-ruled grid for each month,
 * your timetable by week, and what's on each day — classes, breaks and
 * reminders. The timetable and term dates are edited here too.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db, getMeta, setMeta, uid } from '../db';
import { nav, toggleSidebar } from '../lib/nav';
import { saveTermCalendar, useNow, useTimetable, type Timetable } from '../lib/calendarData';
import { addDays, classesBetween, dateIn, dayStatus, toMinutes, weekday, ymd, zonedTime, type ClassTime, type DateSpan, type Lesson, type Subject, type TermCalendar } from '../lib/timetable';
import { dayTitle, REMINDER_TYPES, type Reminder, type ReminderType } from '../lib/reminders';
import { SYMONDS_CALENDAR_URL } from '../lib/symonds';
import { toast } from '../lib/events';
import { MonthPoster, MONTH_NAMES } from './MonthArt';
import { NextClass } from './NextClass';
import { confirmDialog, DraftInput, Menu, Modal, Segmented, useMenu } from './ui';
import { IChevL, IChevR, IMore, ISidebar } from './Icons';
import { addReminder, toggleComplete } from './RemindersView';

const DAY_HEADS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const subjectOf = (tt: Timetable, id?: string) => tt.subjects.find((s) => s.id === id);

/** Monday of the week a date falls in. */
const mondayOf = (key: string) => addDays(key, 1 - weekday(key));

export function CalendarView({ narrow, showSidebarToggle }: { narrow: boolean; showSidebarToggle: boolean }) {
  const tt = useTimetable();
  const reminders = useLiveQuery(() => db.reminders.toArray(), []) ?? [];
  const now = useNow(60000);
  const today = dateIn(now);
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [cursor, setCursor] = useState(today);
  const [day, setDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<null | 'timetable' | 'terms'>(null);
  const [menuAnchor, openMenu, closeMenu] = useMenu();

  if (!tt) return null;
  const [y, m] = cursor.split('-').map(Number);
  const step = (dir: -1 | 1) => setCursor(mode === 'month' ? ymd(y, m + dir, 1) : addDays(mondayOf(cursor), 7 * dir));
  const unconfirmed = [...tt.calendar.terms, ...tt.calendar.closures].filter((s) => s.confirmed === false);

  return (
    <div className="study calendar">
      <div className="study-head">
        {narrow ? (
          <button className="icon-btn accent" onClick={() => nav({ pane: 'sidebar' })}>
            <IChevL /> <span className="back-label">Folders</span>
          </button>
        ) : (
          showSidebarToggle && (
            <button className="icon-btn" onClick={toggleSidebar} aria-label="Toggle sidebar">
              <ISidebar />
            </button>
          )
        )}
        <h1>Calendar</h1>
        <span className="spacer" />
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'month', label: 'Month' },
            { value: 'week', label: 'Week' },
          ]}
        />
        <button className="icon-btn" onClick={(e) => openMenu(e.currentTarget)} aria-label="Calendar options">
          <IMore />
        </button>
      </div>
      <div className="study-scroll cal-scroll">
        <NextClass />
        {unconfirmed.length > 0 && (
          <button className="cal-warning" onClick={() => setEditing('terms')}>
            {unconfirmed.length} term {unconfirmed.length === 1 ? 'date is' : 'dates are'} still a best guess ({unconfirmed.map((u) => u.name).join(', ')}). Check them against the college calendar →
          </button>
        )}
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => step(-1)} aria-label={mode === 'month' ? 'Previous month' : 'Previous week'}>
            <IChevL />
          </button>
          <button className="btn small" onClick={() => setCursor(today)}>
            Today
          </button>
          <button className="icon-btn" onClick={() => step(1)} aria-label={mode === 'month' ? 'Next month' : 'Next week'}>
            <IChevR />
          </button>
          {mode === 'week' && <span className="cal-range">{weekLabel(mondayOf(cursor))}</span>}
        </div>
        {mode === 'month' ? (
          <MonthView tt={tt} year={y} month={m} today={today} reminders={reminders} narrow={narrow} onDay={setDay} />
        ) : (
          <WeekView tt={tt} monday={mondayOf(cursor)} today={today} now={now} reminders={reminders} onDay={setDay} />
        )}
      </div>

      {menuAnchor && (
        <Menu
          anchor={menuAnchor}
          align="right"
          onClose={closeMenu}
          items={[
            { label: 'Edit timetable…', onClick: () => setEditing('timetable') },
            { label: 'Term dates…', onClick: () => setEditing('terms') },
            { divider: true, label: '' },
            { label: 'Notification settings…', onClick: () => nav({ modal: { type: 'settings' } }) },
          ]}
        />
      )}
      {day && <DayDetail tt={tt} day={day} today={today} reminders={reminders} onClose={() => setDay(null)} />}
      {editing === 'timetable' && <TimetableEditor tt={tt} onClose={() => setEditing(null)} />}
      {editing === 'terms' && <TermsEditor calendar={tt.calendar} onClose={() => setEditing(null)} />}
    </div>
  );
}

function weekLabel(monday: string) {
  const fri = addDays(monday, 4);
  const [, m1, d1] = monday.split('-').map(Number);
  const [y2, m2, d2] = fri.split('-').map(Number);
  return `${d1}${m1 === m2 ? '' : ` ${MONTH_NAMES[m1 - 1].slice(0, 3)}`} – ${d2} ${MONTH_NAMES[m2 - 1].slice(0, 3)} ${y2}`;
}

/** Classes grouped by date for a span of days. */
function classesByDate(tt: Timetable, from: string, days: number) {
  const map = new Map<string, ClassTime[]>();
  for (const c of classesBetween(tt.lessons, tt.calendar, zonedTime(from, '00:00'), zonedTime(addDays(from, days), '00:00'))) {
    map.set(c.date, [...(map.get(c.date) ?? []), c]);
  }
  return map;
}

function dueByDate(reminders: Reminder[]) {
  const map = new Map<string, Reminder[]>();
  for (const r of reminders) if (r.due && !r.completed) map.set(r.due, [...(map.get(r.due) ?? []), r]);
  return map;
}

// ------------------------------------------------------------------ month

function MonthView({ tt, year, month, today, reminders, narrow, onDay }: { tt: Timetable; year: number; month: number; today: string; reminders: Reminder[]; narrow: boolean; onDay: (d: string) => void }) {
  const first = ymd(year, month, 1);
  const lead = weekday(first) - 1;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const trail = (7 - ((lead + days) % 7)) % 7;
  const classes = useMemo(() => classesByDate(tt, first, days), [tt, first, days]);
  const due = dueByDate(reminders);
  const notesKey = `monthNotes:${first.slice(0, 7)}`;
  const savedNotes = useLiveQuery(() => getMeta<string>(notesKey, ''), [notesKey]);
  const [notes, setNotes] = useState<string | null>(null);
  useEffect(() => setNotes(null), [notesKey]);

  // Mad Sun's "NOTES:" box sits in the empty cells before the 1st (or after the last day).
  const notesSpan = lead >= 2 ? lead : trail >= 2 ? trail : 0;
  const notesCell = (key: string) => (
    <div key={key} className="cal-cell notes" style={{ gridColumn: `span ${notesSpan}` }}>
      <span className="notes-label">Notes:</span>
      <textarea
        aria-label={`Notes for ${MONTH_NAMES[month - 1]}`}
        value={notes ?? savedNotes ?? ''}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== null && setMeta(notesKey, notes)}
      />
    </div>
  );

  const cells = [];
  if (lead >= 2) cells.push(notesCell('notes-start'));
  else for (let i = 0; i < lead; i++) cells.push(<div key={`l${i}`} className="cal-cell blank" />);
  let lastLabel = '';
  for (let d = 1; d <= days; d++) {
    const key = ymd(year, month, d);
    const status = dayStatus(key, tt.calendar);
    const cls = classes.get(key) ?? [];
    const rs = due.get(key) ?? [];
    const off = status.kind === 'closure' || status.kind === 'holiday';
    const showLabel = off && status.label && (status.label !== lastLabel || weekday(key) === 1);
    lastLabel = off ? (status.label ?? '') : '';
    cells.push(
      <button key={key} className={`cal-cell day ${status.kind} ${key === today ? 'today' : ''} ${key < today ? 'past' : ''}`} onClick={() => onDay(key)} aria-label={`${dayTitle(key, today)}${status.label ? `, ${status.label}` : ''}${cls.length ? `, ${cls.length} classes` : ''}${rs.length ? `, ${rs.length} reminders` : ''}`}>
        <span className="cal-num">{d}</span>
        {showLabel && <span className="cal-off">{status.label}</span>}
        <span className="cal-items">
          {narrow ? (
            <span className="cal-dots">
              {cls.map((c) => (
                <i key={c.lesson.id} style={{ background: subjectOf(tt, c.lesson.subjectId)?.color }} />
              ))}
            </span>
          ) : (
            <>
              {cls.slice(0, 3).map((c) => {
                const s = subjectOf(tt, c.lesson.subjectId);
                return (
                  <span key={c.lesson.id} className="cal-class" style={{ ['--subject' as string]: s?.color }}>
                    {s?.short ?? s?.name}
                  </span>
                );
              })}
              {cls.length > 3 && <span className="cal-more">+{cls.length - 3}</span>}
            </>
          )}
          {rs.slice(0, narrow ? 1 : 2).map((r) => (
            <span key={r.id} className={`cal-rem ${key < today ? 'late' : ''}`}>
              {narrow ? '•' : `○ ${r.title}`}
            </span>
          ))}
          {rs.length > (narrow ? 1 : 2) && <span className="cal-more">+{rs.length - (narrow ? 1 : 2)}</span>}
        </span>
      </button>,
    );
  }
  if (lead < 2 && trail >= 2) cells.push(notesCell('notes-end'));
  else for (let i = 0; i < trail; i++) cells.push(<div key={`t${i}`} className="cal-cell blank" />);

  return (
    // Keyed by month so a new month prints in afresh rather than swapping in place.
    <div className="month" key={`${year}-${month}`}>
      <MonthPoster year={year} month={month} />
      <div className="cal-grid">
        {DAY_HEADS.map((d) => (
          <div key={d} className="cal-head">
            {d}
          </div>
        ))}
        {cells}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ week

function WeekView({ tt, monday, today, now, reminders, onDay }: { tt: Timetable; monday: string; today: string; now: number; reminders: Reminder[]; onDay: (d: string) => void }) {
  const classes = useMemo(() => classesByDate(tt, monday, 5), [tt, monday]);
  const due = dueByDate(reminders);
  const starts = tt.lessons.map((l) => toMinutes(l.start));
  const ends = tt.lessons.map((l) => toMinutes(l.end));
  const top = Math.min(9 * 60, ...starts);
  const bottom = Math.max(16 * 60 + 40, ...ends);
  const scale = 1.25;
  const marks = [...new Set([...tt.lessons.map((l) => l.start), ...tt.lessons.map((l) => l.end)])].sort();
  const nowMin = dateIn(now) >= monday && dateIn(now) <= addDays(monday, 4) ? (now - zonedTime(dateIn(now), '00:00')) / 60000 : -1;

  return (
    <div className="week">
      <div className="week-grid" style={{ ['--h' as string]: `${(bottom - top) * scale}px` }}>
        <div className="week-axis">
          {marks.map((t) => (
            <span key={t} style={{ top: (toMinutes(t) - top) * scale }}>
              {t.replace(/^0/, '')}
            </span>
          ))}
        </div>
        {[0, 1, 2, 3, 4].map((i) => {
          const key = addDays(monday, i);
          const status = dayStatus(key, tt.calendar);
          const rs = due.get(key) ?? [];
          return (
            <div key={key} className={`week-col ${key === today ? 'today' : ''} ${status.kind}`}>
              <button className="week-day" onClick={() => onDay(key)}>
                <span>{DAY_HEADS[i]}</span> <b>{Number(key.slice(8))}</b>
                {rs.length > 0 && <span className="week-due">{rs.length} due</span>}
              </button>
              <div className="week-body">
                {(status.kind === 'closure' || status.kind === 'holiday') && <div className="week-off">{status.label ?? 'No classes'}</div>}
                {(classes.get(key) ?? []).map((c) => {
                  const s = subjectOf(tt, c.lesson.subjectId);
                  const y = (toMinutes(c.lesson.start) - top) * scale;
                  const h = (toMinutes(c.lesson.end) - toMinutes(c.lesson.start)) * scale;
                  return (
                    <button key={c.lesson.id} className="week-class" style={{ top: y, height: h, ['--subject' as string]: s?.color }} onClick={() => onDay(key)}>
                      <span className="week-time">
                        {c.lesson.start} – {c.lesson.end}
                      </span>
                      <span className="week-name">{s?.name}</span>
                      {h >= 80 && <span className="week-meta">{c.lesson.room}</span>}
                      {h >= 100 && <span className="week-meta">{c.lesson.teacher}</span>}
                    </button>
                  );
                })}
                {key === today && nowMin >= top && nowMin <= bottom && <div className="week-now" style={{ top: (nowMin - top) * scale }} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ one day

function DayDetail({ tt, day, today, reminders, onClose }: { tt: Timetable; day: string; today: string; reminders: Reminder[]; onClose: () => void }) {
  const status = dayStatus(day, tt.calendar);
  const classes = classesByDate(tt, day, 1).get(day) ?? [];
  const dueHere = reminders.filter((r) => r.due === day).sort((a, b) => Number(a.completed) - Number(b.completed) || (a.time ?? '').localeCompare(b.time ?? ''));
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [type, setType] = useState<ReminderType | ''>('');

  const add = async () => {
    if (!title.trim()) return;
    await addReminder({ title: title.trim(), due: day, subjectId: subjectId || undefined, type: type || undefined });
    setTitle('');
    toast('Reminder added', 'success');
  };

  const [y, m, d] = day.split('-').map(Number);
  return (
    <Modal title={`${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][weekday(day) - 1]} ${d} ${MONTH_NAMES[m - 1]} ${y}`} onClose={onClose}>
      {status.label && <p className="day-status">{status.label} — no classes</p>}
      {status.kind === 'weekend' && !dueHere.length && <p className="muted">Weekend.</p>}
      {classes.length > 0 && (
        <div className="day-classes">
          {classes.map((c) => {
            const s = subjectOf(tt, c.lesson.subjectId);
            return (
              <div key={c.lesson.id} className="day-class" style={{ ['--subject' as string]: s?.color }}>
                <span className="day-time">
                  {c.lesson.start}
                  <br />
                  {c.lesson.end}
                </span>
                <span>
                  <b>{s?.name}</b>
                  <span className="muted small">{[c.lesson.room, c.lesson.teacher].filter(Boolean).join(' · ')}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      <h4 className="day-sub">Reminders</h4>
      {dueHere.length === 0 && <p className="muted small">Nothing due {dayTitle(day, today) === 'Today' ? 'today' : 'this day'}.</p>}
      {dueHere.map((r) => (
        <label key={r.id} className={`day-rem ${r.completed ? 'done' : ''}`}>
          <input type="checkbox" checked={r.completed} onChange={() => toggleComplete(r)} />
          <span>
            {r.title}
            <span className="muted small">{[r.time, subjectOf(tt, r.subjectId)?.name, REMINDER_TYPES.find((t) => t.id === r.type)?.label].filter(Boolean).join(' · ')}</span>
          </span>
        </label>
      ))}
      <form
        className="day-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="input" placeholder="New reminder for this day" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="row wrap">
          <select className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="Subject">
            <option value="">No subject</option>
            {tt.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as ReminderType)} aria-label="Type">
            <option value="">Any type</option>
            {REMINDER_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.emoji} {t.label}
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={!title.trim()}>
            Add
          </button>
        </div>
      </form>
      <button className="link-btn" onClick={() => nav({ view: 'reminders' })}>
        Open Reminders →
      </button>
    </Modal>
  );
}

// ------------------------------------------------------------------ editors

function TimetableEditor({ tt, onClose }: { tt: Timetable; onClose: () => void }) {
  const update = (id: string, patch: Partial<Lesson>) => db.lessons.update(id, patch);
  // A cleared picker, or an end before the start, would put a class alert at midnight.
  const setTimes = (l: Lesson, start: string, end: string) => {
    if (!start || !end || (start === l.start && end === l.end)) return;
    if (end <= start) return toast('A lesson has to end after it starts.', 'error');
    update(l.id, { start, end });
  };
  const addLesson = (day: number) => db.lessons.add({ id: uid(), subjectId: tt.subjects[0]?.id ?? '', day, start: '09:00', end: '10:00' });
  const addSubject = async () => {
    const id = uid();
    await db.subjects.add({ id, name: 'New subject', color: '#4f7cac' });
  };
  const removeSubject = async (s: Subject) => {
    const used = tt.lessons.filter((l) => l.subjectId === s.id).length;
    if (!(await confirmDialog(`Delete ${s.name}${used ? ` and its ${used} lesson${used === 1 ? '' : 's'}` : ''}?`))) return;
    await db.transaction('rw', db.subjects, db.lessons, async () => {
      await db.lessons.where('id').anyOf(tt.lessons.filter((l) => l.subjectId === s.id).map((l) => l.id)).delete();
      await db.subjects.delete(s.id);
    });
  };
  return (
    <Modal title="Timetable" onClose={onClose} wide>
      <p className="muted small">The same every week. Study periods are left out — only what you'd want a reminder for.</p>
      <h4 className="day-sub">Subjects</h4>
      <div className="tt-subjects">
        {tt.subjects.map((s) => (
          <div key={s.id} className="tt-subject">
            <input type="color" value={s.color} onChange={(e) => db.subjects.update(s.id, { color: e.target.value })} aria-label={`${s.name} colour`} />
            <DraftInput className="input" value={s.name} onValue={(v) => v.trim() && db.subjects.update(s.id, { name: v })} aria-label="Subject name" />
            <DraftInput className="input short" value={s.short ?? ''} placeholder="Short" onValue={(v) => db.subjects.update(s.id, { short: v || undefined })} aria-label="Short name" />
            <button className="icon-btn small danger" onClick={() => removeSubject(s)} aria-label={`Delete ${s.name}`}>
              ✕
            </button>
          </div>
        ))}
        <button className="btn small" onClick={addSubject}>
          + Subject
        </button>
      </div>
      {[1, 2, 3, 4, 5].map((day) => (
        <div key={day} className="tt-day">
          <h4 className="day-sub">{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][day - 1]}</h4>
          {tt.lessons
            .filter((l) => l.day === day)
            .map((l) => (
              <div key={l.id} className="tt-lesson">
                <select className="input" value={l.subjectId} onChange={(e) => update(l.id, { subjectId: e.target.value })} aria-label="Subject">
                  {tt.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {/* Saved when left: typing "11" into the hour passes through 01:00 on the way. */}
                <DraftInput className="input time" type="time" value={l.start} onValue={() => {}} onBlur={(e) => setTimes(l, e.currentTarget.value, l.end)} aria-label="Starts" />
                <DraftInput className="input time" type="time" value={l.end} onValue={() => {}} onBlur={(e) => setTimes(l, l.start, e.currentTarget.value)} aria-label="Ends" />
                <DraftInput className="input" value={l.room ?? ''} placeholder="Room" onValue={(v) => update(l.id, { room: v })} aria-label="Room" />
                <DraftInput className="input" value={l.teacher ?? ''} placeholder="Teacher" onValue={(v) => update(l.id, { teacher: v })} aria-label="Teacher" />
                <button className="icon-btn small danger" onClick={() => db.lessons.delete(l.id)} aria-label="Delete lesson">
                  ✕
                </button>
              </div>
            ))}
          <button className="btn small" onClick={() => addLesson(day)}>
            + Lesson
          </button>
        </div>
      ))}
    </Modal>
  );
}

function TermsEditor({ calendar, onClose }: { calendar: TermCalendar; onClose: () => void }) {
  const [cal, setCal] = useState(calendar);
  const edit = (kind: 'terms' | 'closures', i: number, patch: Partial<DateSpan>) => setCal((c) => ({ ...c, [kind]: c[kind].map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const save = async () => {
    const bad = [...cal.terms, ...cal.closures].find((s) => !s.start || !s.end || s.end < s.start);
    if (bad) return toast(`“${bad.name || 'A date'}” ends before it starts.`, 'error');
    await saveTermCalendar({ terms: [...cal.terms].sort((a, b) => a.start.localeCompare(b.start)), closures: [...cal.closures].sort((a, b) => a.start.localeCompare(b.start)) });
    toast('Term dates saved — class alerts follow them.', 'success');
    onClose();
  };
  const section = (kind: 'terms' | 'closures', title: string, hint: string) => (
    <>
      <h4 className="day-sub">{title}</h4>
      <p className="muted small">{hint}</p>
      {cal[kind].map((s, i) => (
        <div key={i} className={`term-row ${s.confirmed === false ? 'guess' : ''}`}>
          <input className="input" value={s.name} onChange={(e) => edit(kind, i, { name: e.target.value })} aria-label="Name" />
          <input className="input" type="date" value={s.start} onChange={(e) => edit(kind, i, { start: e.target.value })} aria-label="From" />
          <input className="input" type="date" value={s.end} onChange={(e) => edit(kind, i, { end: e.target.value })} aria-label="To" />
          <label className="check small">
            <input type="checkbox" checked={s.confirmed !== false} onChange={(e) => edit(kind, i, { confirmed: e.target.checked })} /> Checked
          </label>
          <button className="icon-btn small danger" onClick={() => setCal((c) => ({ ...c, [kind]: c[kind].filter((_, j) => j !== i) }))} aria-label="Remove">
            ✕
          </button>
        </div>
      ))}
      <button className="btn small" onClick={() => setCal((c) => ({ ...c, [kind]: [...c[kind], { name: kind === 'terms' ? 'Term' : 'Closure', start: dateIn(Date.now()), end: dateIn(Date.now()), confirmed: true }] }))}>
        + Add
      </button>
    </>
  );
  return (
    <Modal
      title="Term dates"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <p className="muted">
        No class alerts outside these terms or on closure days. Rows marked unchecked are best guesses — compare them with the{' '}
        <a href={SYMONDS_CALENDAR_URL} target="_blank" rel="noopener">
          college's Dates for the Year
        </a>{' '}
        and tick them once they match.
      </p>
      {section('terms', 'Terms', 'Days between terms are holidays (Christmas, Easter, summer).')}
      {section('closures', 'Closures in term', 'Half terms, bank holidays, training days.')}
    </Modal>
  );
}
