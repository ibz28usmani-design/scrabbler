import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarDays, CalendarClock, Inbox, Flag, CheckCircle2, Plus, Trash2, ChevronDown } from 'lucide-react';
import { db, uid, type Reminder } from '../lib/db';
import { Head, Field, addDays, ymd, pad } from '../lib/ui';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** "Law essay friday 4pm" → title "Law essay", due that Friday, 16:00. */
export function parseQuick(s: string, now = new Date()): Partial<Reminder> {
  let due: string | undefined, time: string | undefined;
  s = s.replace(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(?:at\s+)?(\d{1,2}):(\d{2})\b/i, (_, h, m, ap, h2, m2) => {
    let hr = +(h ?? h2); if (ap?.toLowerCase() === 'pm' && hr < 12) hr += 12; if (ap?.toLowerCase() === 'am' && hr === 12) hr = 0;
    time = `${pad(hr)}:${m ?? m2 ?? '00'}`; return '';
  });
  s = s.replace(/\b(today|tomorrow|(?:on\s+)?(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)\b/i, w => {
    const k = w.toLowerCase().replace(/^on\s+/, '');
    if (k === 'today') due = ymd(now); else if (k === 'tomorrow') due = ymd(addDays(now, 1));
    else { const d = DAYS.indexOf(k.slice(0, 3)); due = ymd(addDays(now, ((d - now.getDay() + 7) % 7) || 7)); }
    return '';
  });
  if (time && !due) due = ymd(now);
  return { title: s.replace(/\s+/g, ' ').trim(), due, time };
}

export async function toggleDone(r: Reminder) {
  if (!r.done && r.repeat && r.due) {
    const d = new Date(r.due + 'T12:00');
    if (r.repeat === 'daily') d.setDate(d.getDate() + 1); else if (r.repeat === 'weekly') d.setDate(d.getDate() + 7); else d.setMonth(d.getMonth() + 1);
    return db.reminders.update(r.id, { due: ymd(d), notified: undefined });
  }
  return db.reminders.update(r.id, { done: !r.done, doneAt: Date.now() });
}

export default function Reminders() {
  const items = useLiveQuery(() => db.reminders.toArray(), []) || [];
  const lists = useLiveQuery(() => db.lists.toArray(), []) || [];
  const [view, setView] = useState('today');
  const [openId, setOpenId] = useState('');
  const [draft, setDraft] = useState('');
  const today = ymd(new Date());
  const smart: Record<string, { name: string; color: string; icon: any; f: (r: Reminder) => boolean }> = {
    today: { name: 'Today', color: '#007aff', icon: CalendarDays, f: r => !r.done && !!r.due && r.due <= today },
    scheduled: { name: 'Scheduled', color: '#ff3b30', icon: CalendarClock, f: r => !r.done && !!r.due },
    all: { name: 'All', color: '#48484a', icon: Inbox, f: r => !r.done },
    flagged: { name: 'Flagged', color: '#ff9500', icon: Flag, f: r => !r.done && !!r.flag },
    done: { name: 'Completed', color: '#8e8e93', icon: CheckCircle2, f: r => !!r.done },
  };
  const list = lists.find(l => l.id === view);
  const filter = smart[view]?.f || ((r: Reminder) => !r.done && r.list === view);
  const shown = items.filter(filter).sort((a, b) => (a.due || '9').localeCompare(b.due || '9') || (a.time || '').localeCompare(b.time || '') || (b.priority || 0) - (a.priority || 0));
  const add = async () => {
    if (!draft.trim()) return;
    const q = parseQuick(draft);
    await db.reminders.add({ id: uid(), title: q.title || draft, list: list ? list.id : lists.find(l => l.id === 'reminders')?.id || lists[0]?.id || 'reminders', due: q.due ?? (view === 'today' ? today : undefined), time: q.time, flag: view === 'flagged', created: Date.now() });
    setDraft('');
  };
  const addList = async () => { const name = prompt('List name'); if (name) await db.lists.add({ id: uid(), name, color: ['#1f8a70', '#8e5bb5', '#d64933', '#2f6fb3'][lists.length % 4] }); };
  const up = (id: string, p: Partial<Reminder>) => db.reminders.update(id, p);
  const color = smart[view]?.color || list?.color || 'var(--ink)';

  return (
    <div className="view rem-view">
      <aside className="rem-side scroller">
        <div className="tiles">
          {Object.entries(smart).map(([k, s]) => (
            <button key={k} className={'tile' + (view === k ? ' on' : '')} onClick={() => setView(k)}>
              <span className="tile-icon" style={{ background: s.color }}><s.icon size={16} /></span><b>{items.filter(s.f).length}</b><span>{s.name}</span>
            </button>
          ))}
        </div>
        <div className="label pad">My lists</div>
        {lists.map(l => (
          <button key={l.id} className={'folder' + (view === l.id ? ' on' : '')} onClick={() => setView(l.id)}><span className="fdot" style={{ background: l.color }} />{l.name}<em>{items.filter(r => !r.done && r.list === l.id).length}</em></button>
        ))}
        <div className="row pad"><button className="btn small" onClick={addList}><Plus size={14} /> Add list</button>
          {list && lists.length > 1 && <button className="btn small" onClick={async () => { if (confirm('Delete this list and its reminders?')) { await db.reminders.where('list').equals(list.id).delete(); await db.lists.delete(list.id); setView('all'); } }}>Delete list</button>}</div>
      </aside>
      <section className="rem-main scroller">
        <Head title={smart[view]?.name || list?.name || ''} sub={`${shown.length} ${shown.length === 1 ? 'reminder' : 'reminders'}`} />
        <div className="rem-list" style={{ ['--c' as any]: color }}>
          {shown.map(r => (
            <div key={r.id} className={'rem' + (r.done ? ' done' : '')}>
              <button className="check" aria-label={r.done ? 'Mark not done' : 'Mark done'} onClick={() => toggleDone(r)} />
              <div className="grow">
                <Field className="rem-title" aria-label="Reminder" value={r.title} onChange={v => up(r.id, { title: v })} />
                <div className="rem-meta">
                  {r.due && <span className={!r.done && r.due < today ? 'late' : ''}>{r.due === today ? 'Today' : new Date(r.due + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}{r.time ? ', ' + r.time : ''}</span>}
                  {r.repeat && <span>↻ {r.repeat}</span>}{!!r.priority && <span className="late">{'!'.repeat(r.priority)}</span>}
                  {!list && <span>{lists.find(l => l.id === r.list)?.name}</span>}{r.notes && openId !== r.id && <span>{r.notes.slice(0, 50)}</span>}
                </div>
                {openId === r.id && <div className="rem-detail">
                  <Field area className="input" placeholder="Notes" value={r.notes || ''} onChange={v => up(r.id, { notes: v })} />
                  <div className="row wrap">
                    <input className="input" type="date" aria-label="Due date" value={r.due || ''} onChange={e => up(r.id, { due: e.target.value || undefined, notified: undefined })} />
                    <input className="input" type="time" aria-label="Time" value={r.time || ''} onChange={e => up(r.id, { time: e.target.value || undefined, notified: undefined })} />
                    <select className="select" aria-label="Repeat" value={r.repeat || ''} onChange={e => up(r.id, { repeat: e.target.value || undefined })}><option value="">Never repeats</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>
                    <select className="select" aria-label="Priority" value={r.priority || 0} onChange={e => up(r.id, { priority: +e.target.value })}><option value={0}>No priority</option><option value={1}>Low !</option><option value={2}>Medium !!</option><option value={3}>High !!!</option></select>
                    <select className="select" aria-label="List" value={r.list} onChange={e => up(r.id, { list: e.target.value })}>{lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                    <button className="btn small" onClick={() => db.reminders.delete(r.id)}><Trash2 size={14} /> Delete</button>
                  </div>
                </div>}
              </div>
              <button className={'ib' + (r.flag ? ' flagged' : '')} aria-label="Flag" onClick={() => up(r.id, { flag: !r.flag })}><Flag size={16} /></button>
              <button className="ib" aria-label="Details" onClick={() => setOpenId(openId === r.id ? '' : r.id)}><ChevronDown size={16} /></button>
            </div>
          ))}
          {view !== 'done' && <div className="rem new"><span className="check ghost" />
            <input className="rem-title" placeholder='New reminder, e.g. "Law essay friday 4pm"' value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} onBlur={add} /></div>}
        </div>
      </section>
    </div>
  );
}
