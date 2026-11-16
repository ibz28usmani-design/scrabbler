import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { NotebookPen, Waypoints, Presentation, ListChecks, CalendarDays, Timer, Calculator as CalcIcon, Sparkles, Settings as Cog, Moon, Sun } from 'lucide-react';
import { db } from './lib/db';
import { Toasts, notify, toast, useS, setS, getS, ymd, hm, mins } from './lib/ui';
import { usePomo, mmss } from './lib/pomo';
import { onLocalChange, sendSchedule, syncNow } from './lib/cloud';
import { importLegacy } from './lib/legacy';
import Notes from './views/Notes';
import Graph from './views/Graph';
import Slides from './views/Slides';
import Reminders from './views/Reminders';
import Calendar, { eventsOn, nowNext, useNow } from './views/Calendar';
import Focus from './views/Focus';
import Study from './views/Study';
import Settings from './views/Settings';

const Calculator = lazy(() => import('./views/Calculator'));
const VIEWS = [['notes', 'Notes', NotebookPen], ['graph', 'Graph', Waypoints], ['slides', 'Slides', Presentation], ['reminders', 'Reminders', ListChecks], ['calendar', 'Timetable', CalendarDays], ['focus', 'Focus', Timer], ['calc', 'Calculator', CalcIcon], ['study', 'Study', Sparkles], ['settings', 'Settings', Cog]] as const;

export default function App() {
  const s = useS(), p = usePomo(), now = useNow();
  const [view, setViewState] = useState<string>(new URLSearchParams(location.search).has('clip') ? 'notes' : localStorage.getItem('scr2-view') || 'notes');
  const [noteId, setNoteId] = useState<string | undefined>(localStorage.getItem('scr2-note') || undefined);
  const [deckId, setDeckId] = useState<string>();
  const evs = useLiveQuery(() => db.events.toArray(), []) || [];
  const alerted = useRef(new Set<string>());
  const setView = (v: string) => { setViewState(v); localStorage.setItem('scr2-view', v); };
  const openNote = (id?: string) => { setNoteId(id); id ? localStorage.setItem('scr2-note', id) : localStorage.removeItem('scr2-note'); };
  const [sysDark, setSysDark] = useState(matchMedia('(prefers-color-scheme: dark)').matches);
  const dark = s.theme === 'dark' || (s.theme === 'auto' && sysDark);

  useEffect(() => { const m = matchMedia('(prefers-color-scheme: dark)'), f = () => setSysDark(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#000000' : '#f5f5f7');
  }, [dark]);

  // Reminder and class alerts while the app is open.
  useEffect(() => {
    const check = async () => {
      const d = new Date(), today = ymd(d), t = hm(d);
      for (const r of await db.reminders.filter(r => !r.done && r.due === today && !!r.time && r.time <= t && r.notified !== `${r.due}T${r.time}`).toArray()) {
        notify('Reminder', r.title); db.reminders.update(r.id, { notified: `${r.due}T${r.time}` });
      }
      for (const e of eventsOn(await db.events.toArray(), d)) {
        const k = today + e.id, left = mins(e.start) - mins(t);
        if (left > 0 && left <= 5 && !alerted.current.has(k)) { alerted.current.add(k); notify(`${e.title} in ${left} min`, e.room || ''); }
      }
    };
    check(); const i = setInterval(check, 30000); return () => clearInterval(i);
  }, []);

  // Sync on start, every minute, on return to the app and a few seconds after each change; keep the push server's schedule current.
  useEffect(() => {
    let syncT: ReturnType<typeof setTimeout>, pushT: ReturnType<typeof setTimeout>;
    const sync = () => { if (getS().syncOn && navigator.onLine) syncNow().catch(e => console.warn('sync', e)); };
    const off = onLocalChange(t => {
      clearTimeout(syncT); syncT = setTimeout(sync, 4000);
      if (t === 'events' || t === 'reminders') { clearTimeout(pushT); pushT = setTimeout(() => sendSchedule().catch(() => {}), 3000); }
    });
    const vis = () => { if (!document.hidden) sync(); };
    const open = (url: string) => { const v = new URL(url, location.href).searchParams.get('open'); if (v === 'calendar' || v === 'reminders') setView(v); };
    const msg = (e: MessageEvent) => { if (e.data?.type === 'scrabbler-open') open(e.data.url); };
    open(location.href); sync(); sendSchedule().catch(() => {});
    const i = setInterval(sync, 60000);
    document.addEventListener('visibilitychange', vis); navigator.serviceWorker?.addEventListener('message', msg);
    if (!localStorage.getItem('scr2-legacy')) importLegacy().then(n => { localStorage.setItem('scr2-legacy', '1'); if (n) toast(`Brought across ${n} notes from the previous Scrabbler.`); }).catch(() => {});
    return () => { off(); clearInterval(i); clearTimeout(syncT); clearTimeout(pushT); document.removeEventListener('visibilitychange', vis); navigator.serviceWorker?.removeEventListener('message', msg); };
  }, []);

  const nn = nowNext(evs, now);
  return (
    <div className="app">
      <nav className="rail" aria-label="Sections">
        <div className="brand" aria-hidden>S</div>
        <div className="rail-tabs">
          <span className="rail-ind" aria-hidden style={{ ['--i' as any]: Math.max(0, VIEWS.findIndex(v => v[0] === view)) }} />
          {VIEWS.map(([k, n, I]) => <button key={k} className={'rail-btn' + (view === k ? ' on' : '')} onClick={() => setView(k)} aria-current={view === k}><I size={20} /><span>{n}</span></button>)}
        </div>
        <span className="grow" />
        {(p.running || p.phase !== 'work') && <button className="rail-mini" onClick={() => setView('focus')} title="Pomodoro">{mmss(p.left)}</button>}
        {(nn.now || nn.next) && <button className="rail-mini class" onClick={() => setView('calendar')} title="Timetable">{nn.now ? `${nn.now.title.slice(0, 5)} →${nn.now.end}` : `${nn.next!.title.slice(0, 5)} ${nn.next!.start}`}</button>}
        <button className="rail-btn" onClick={() => setS({ theme: dark ? 'light' : 'dark' })} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? <Sun size={20} /> : <Moon size={20} />}<span>{dark ? 'Light' : 'Dark'}</span></button>
      </nav>
      <main className="main">
        {view === 'notes' ? <Notes openId={noteId} open={openNote} />
          : view === 'graph' ? <Graph open={id => { openNote(id); setView('notes'); }} />
          : view === 'slides' ? <Slides openId={deckId} open={setDeckId} />
          : view === 'reminders' ? <Reminders />
          : view === 'calendar' ? <Calendar />
          : view === 'focus' ? <Focus />
          : view === 'calc' ? <Suspense fallback={<div className="view muted">Loading calculator…</div>}><Calculator /></Suspense>
          : view === 'study' ? <Study goNote={id => { openNote(id); setView('notes'); }} goDeck={id => { setDeckId(id); setView('slides'); }} />
          : <Settings />}
      </main>
      <Toasts />
    </div>
  );
}
