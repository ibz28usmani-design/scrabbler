import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { db, uid, type Ev } from '../lib/db';
import { Head, Modal, addDays, ymd, hm, mins, isoDay, monday, pad } from '../lib/ui';

export const eventsOn = (evs: Ev[], d: Date) => evs.filter(e => (e.weekly ? e.day === isoDay(d) : e.date === ymd(d))).sort((a, b) => a.start.localeCompare(b.start));
/** The class happening now and the next one today. */
export function nowNext(evs: Ev[], now: Date) {
  const t = hm(now), today = eventsOn(evs, now);
  return { now: today.find(e => e.start <= t && t < e.end), next: today.find(e => e.start > t) };
}
export function useNow(ms = 30000) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
const COLORS = ['#8a5a32', '#4b5d3e', '#3f3b3d', '#8b4744', '#504459', '#575c7e', '#1f8a70', '#2f6fb3', '#d64933', '#b58a00'];
const DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function Calendar() {
  const evs = useLiveQuery(() => db.events.toArray(), []) || [];
  const rems = useLiveQuery(() => db.reminders.filter(r => !r.done && !!r.due).toArray(), []) || [];
  const now = useNow();
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(new Date());
  const [edit, setEdit] = useState<Ev | null>(null);
  const nn = nowNext(evs, now);
  const shift = (n: number) => setAnchor(a => (mode === 'week' ? addDays(a, 7 * n) : new Date(a.getFullYear(), a.getMonth() + n, 1)));
  const blank = (p: Partial<Ev> = {}): Ev => ({ id: '', title: '', color: COLORS[6], weekly: false, date: ymd(anchor), day: isoDay(anchor), start: '09:00', end: '10:00', ...p });

  return (
    <div className="view scroller">
      <Head title={mode === 'week' ? 'Timetable' : 'Calendar'} sub={anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}>
        <div className="seg"><button className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>Week</button><button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Month</button></div>
        <button className="ib" aria-label="Previous" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
        <button className="btn small" onClick={() => setAnchor(new Date())}>Today</button>
        <button className="ib" aria-label="Next" onClick={() => shift(1)}><ChevronRight size={18} /></button>
        <button className="btn primary" onClick={() => setEdit(blank())}><Plus size={15} /> Event</button>
      </Head>
      <div className="today-strip">
        <div className="big-date"><span className="label">{now.toLocaleDateString(undefined, { weekday: 'long' })}</span><b>{pad(now.getDate())}.{pad(now.getMonth() + 1)}</b><b>{now.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</b></div>
        <div className="big-time"><b>{hm(now)}</b><span className="label">{eventsOn(evs, now).length} classes today</span></div>
        {nn.now && <div className="nn-card" style={{ background: nn.now.color }}><span className="label">Now · until {nn.now.end}</span><b>{nn.now.title}</b><span>{nn.now.room}</span></div>}
        {nn.next ? <div className="nn-card" style={{ background: nn.next.color }}><span className="label">Next · {nn.next.start}</span><b>{nn.next.title}</b><span>{nn.next.room}</span></div>
          : !nn.now && <div className="nn-card plain"><span className="label">Next</span><b>Nothing more today</b></div>}
      </div>
      {mode === 'week' ? <Week evs={evs} anchor={anchor} now={now} onEdit={setEdit} blank={blank} /> : <Month evs={evs} rems={rems} anchor={anchor} now={now} pick={d => { setAnchor(d); setMode('week'); }} />}
      {edit && <EventModal ev={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function Week({ evs, anchor, now, onEdit, blank }: { evs: Ev[]; anchor: Date; now: Date; onEdit: (e: Ev) => void; blank: (p: Partial<Ev>) => Ev }) {
  const mon = monday(anchor);
  const weekend = [5, 6].some(i => eventsOn(evs, addDays(mon, i)).length);
  const days = Array.from({ length: weekend ? 7 : 5 }, (_, i) => addDays(mon, i));
  const all = days.flatMap(d => eventsOn(evs, d));
  const from = Math.min(9 * 60, ...all.map(e => Math.floor(mins(e.start) / 60) * 60)), to = Math.max(17 * 60, ...all.map(e => Math.ceil(mins(e.end) / 60) * 60));
  const px = 1.15, hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return (
    <div className="week" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(120px, 1fr))` }}>
      <div />
      {days.map(d => <div key={+d} className={'week-day' + (ymd(d) === ymd(now) ? ' today' : '')}><b>{d.toLocaleDateString(undefined, { weekday: 'long' })}</b> {d.getDate()}</div>)}
      <div className="week-axis" style={{ height: (to - from) * px }}>{hours.map(h => <span key={h} style={{ top: (h - from) * px }}>{pad(h / 60)}:00</span>)}</div>
      {days.map(d => (
        <div key={+d} className="week-col" style={{ height: (to - from) * px, backgroundSize: `100% ${60 * px}px` }}
          onClick={e => { if (e.target !== e.currentTarget) return; const m = Math.round((from + (e.clientY - e.currentTarget.getBoundingClientRect().top) / px) / 15) * 15; onEdit(blank({ date: ymd(d), day: isoDay(d), start: `${pad(Math.floor(m / 60))}:${pad(m % 60)}`, end: `${pad(Math.floor(m / 60) + 1)}:${pad(m % 60)}` })); }}>
          {eventsOn(evs, d).map(e => (
            <button key={e.id} className="ev" style={{ top: (mins(e.start) - from) * px, height: (mins(e.end) - mins(e.start)) * px - 2 }} onClick={() => onEdit(e)}>
              <span className="ev-time" style={{ background: e.color }}>{e.start} – {e.end}</span><b>{e.title}</b><span>{e.room}</span><span>{e.teacher}</span>
            </button>
          ))}
          {ymd(d) === ymd(now) && nowMin >= from && nowMin <= to && <i className="now-line" style={{ top: (nowMin - from) * px }} />}
        </div>
      ))}
    </div>
  );
}

function Month({ evs, rems, anchor, now, pick }: { evs: Ev[]; rems: { id: string; title: string; due?: string }[]; anchor: Date; now: Date; pick: (d: Date) => void }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1), start = monday(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return (
    <div className="month">
      {DAY.map(d => <div key={d} className="label month-h">{d.slice(0, 3)}</div>)}
      {cells.map(d => {
        const list = eventsOn(evs, d), day = ymd(d);
        return (
          <button key={day} className={'cell' + (d.getMonth() !== anchor.getMonth() ? ' out' : '') + (day === ymd(now) ? ' today' : '') + (list.length ? ' busy' : '')} onClick={() => pick(d)}>
            <b>{d.getDate()}</b>
            <span className="dots">{list.filter(e => e.weekly).map(e => <i key={e.id} style={{ background: e.color }} />)}</span>
            {list.filter(e => !e.weekly).map(e => <span key={e.id} className="mchip" style={{ borderColor: e.color }}>{e.title}</span>)}
            {rems.filter(r => r.due === day).slice(0, 2).map(r => <span key={r.id} className="mchip rem">{r.title}</span>)}
          </button>
        );
      })}
    </div>
  );
}

function EventModal({ ev, onClose }: { ev: Ev; onClose: () => void }) {
  const [e, setE] = useState(ev);
  const set = (p: Partial<Ev>) => setE({ ...e, ...p });
  const save = async () => { if (!e.title.trim() || e.end <= e.start) return alert('Give the event a name and an end time after its start.'); await db.events.put({ ...e, id: e.id || uid() }); onClose(); };
  return (
    <Modal title={ev.id ? 'Edit event' : 'New event'} onClose={onClose}>
      <input className="input" placeholder="Name, e.g. Economics" value={e.title} onChange={x => set({ title: x.target.value })} autoFocus />
      <div className="row wrap">{COLORS.map(c => <button key={c} className={'swatch big' + (e.color === c ? ' on' : '')} aria-label={'Colour ' + c} style={{ background: c }} onClick={() => set({ color: c })} />)}</div>
      <label className="row"><input type="checkbox" checked={e.weekly} onChange={x => set({ weekly: x.target.checked })} /> Repeats every week (a lesson)</label>
      <div className="row wrap">
        {e.weekly ? <select className="select" aria-label="Day" value={e.day} onChange={x => set({ day: +x.target.value })}>{DAY.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select>
          : <input className="input" type="date" aria-label="Date" value={e.date || ''} onChange={x => set({ date: x.target.value })} />}
        <input className="input" type="time" aria-label="Start" value={e.start} onChange={x => set({ start: x.target.value })} />
        <input className="input" type="time" aria-label="End" value={e.end} onChange={x => set({ end: x.target.value })} />
      </div>
      <div className="row"><input className="input grow" placeholder="Room" value={e.room || ''} onChange={x => set({ room: x.target.value })} /><input className="input grow" placeholder="Teacher" value={e.teacher || ''} onChange={x => set({ teacher: x.target.value })} /></div>
      <div className="row">{ev.id && <button className="btn" onClick={async () => { await db.events.delete(ev.id); onClose(); }}>Delete</button>}<span className="grow" /><button className="btn primary" onClick={save}>Save</button></div>
    </Modal>
  );
}
