import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Play, Pause, RotateCcw, SkipForward, Maximize } from 'lucide-react';
import { db, uid } from '../lib/db';
import { pomo, usePomo, type Phase } from '../lib/pomo';
import { Head, useS, setS, pad, addDays, ymd, monday, toast } from '../lib/ui';
import { nowNext, useNow } from './Calendar';

/** One flip-clock card showing a two-character value. */
function Flip({ v }: { v: string }) {
  const [prev, setPrev] = useState(v);
  useEffect(() => { if (v === prev) return; const t = setTimeout(() => setPrev(v), 520); return () => clearTimeout(t); }, [v, prev]);
  return (
    <div className={'flip' + (v !== prev ? ' go' : '')} aria-hidden>
      <div className="half top">{v}</div><div className="half bottom">{prev}</div>
      <div className="half top flap">{prev}</div><div className="half bottom flap">{v}</div>
    </div>
  );
}
export function FlipClock({ parts, label }: { parts: string[]; label: string }) {
  return <div className="flipclock" role="timer" aria-label={label}>{parts.map((p, i) => <span key={i} className="row">{i > 0 && <i className="colon">:</i>}<Flip v={p} /></span>)}</div>;
}

export default function Focus() {
  const [tab, setTab] = useState<'pomodoro' | 'clock' | 'stopwatch'>('pomodoro');
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root} className="view scroller focus-view">
      <Head title="Focus" sub="Flip clock · Pomodoro · Stopwatch">
        <div className="seg">{(['pomodoro', 'clock', 'stopwatch'] as const).map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
        <button className="ib" aria-label="Full screen" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen?.())}><Maximize size={18} /></button>
      </Head>
      {tab === 'clock' ? <Clock /> : tab === 'stopwatch' ? <Stopwatch /> : <Pomodoro />}
    </div>
  );
}

function Clock() {
  const now = useNow(250), s = useS();
  const evs = useLiveQuery(() => db.events.toArray(), []) || [];
  const nn = nowNext(evs, now), h = now.getHours();
  return (
    <div className="focus-body">
      <FlipClock label="Current time" parts={[pad(s.clock24 ? h : h % 12 || 12), pad(now.getMinutes()), pad(now.getSeconds())]} />
      <p className="focus-date">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}{!s.clock24 && (h < 12 ? ' · AM' : ' · PM')}</p>
      <p className="muted">{nn.now ? `Now: ${nn.now.title} until ${nn.now.end}` : 'No class right now'}{nn.next ? ` · Next: ${nn.next.title} at ${nn.next.start}` : ''}</p>
      <button className="btn small" onClick={() => setS({ clock24: !s.clock24 })}>{s.clock24 ? 'Use 12-hour clock' : 'Use 24-hour clock'}</button>
    </div>
  );
}

const PHASES: [Phase, string][] = [['work', 'Focus'], ['short', 'Short break'], ['long', 'Long break']];
function Pomodoro() {
  const p = usePomo(), s = useS();
  const folders = useLiveQuery(() => db.folders.toArray(), []) || [];
  const sessions = useLiveQuery(() => db.sessions.where('start').above(+monday(new Date(new Date().setHours(0, 0, 0, 0)))).toArray(), []) || [];
  const sec = Math.ceil(p.left / 1000);
  const today = ymd(new Date()), todayMin = sessions.filter(x => ymd(new Date(x.start)) === today).reduce((a, x) => a + x.mins, 0);
  const bySubject = Object.entries(sessions.reduce((m, x) => ({ ...m, [x.subject]: (m[x.subject] || 0) + x.mins }), {} as Record<string, number>));
  const max = Math.max(60, ...bySubject.map(([, m]) => m));
  const num = (k: 'work' | 'short' | 'long' | 'rounds', label: string) => (
    <label className="col small">{label}<input className="input num" type="number" min={1} max={180} value={s[k]} onChange={e => { setS({ [k]: Math.max(1, +e.target.value || 1) }); pomo.refresh(); }} /></label>
  );
  return (
    <div className="focus-body">
      <div className="seg">{PHASES.map(([k, n]) => <button key={k} className={p.phase === k ? 'on' : ''} onClick={() => pomo.phase(k)}>{n}</button>)}</div>
      <FlipClock label="Time left" parts={[pad(Math.floor(sec / 60)), pad(sec % 60)]} />
      <div className="row rounds" aria-label={`Round ${p.round}`}>{Array.from({ length: s.rounds }, (_, i) => <i key={i} className={i < ((p.round - 1) % s.rounds) + (p.phase === 'work' ? 0 : 1) ? 'on' : ''} />)}<span className="label">Round {p.round}</span></div>
      <div className="row">
        <button className="btn primary big" onClick={() => (p.running ? pomo.pause() : pomo.start())}>{p.running ? <><Pause size={18} /> Pause</> : <><Play size={18} /> Start</>}</button>
        <button className="btn" onClick={() => pomo.reset()}><RotateCcw size={16} /> Reset</button>
        <button className="btn" onClick={() => pomo.skip()}><SkipForward size={16} /> Skip</button>
      </div>
      <label className="row">Studying <select className="select" value={p.subject} onChange={e => pomo.subject(e.target.value)}>{folders.map(f => <option key={f.id}>{f.name}</option>)}</select></label>
      <div className="row wrap focus-set">{num('work', 'Focus (min)')}{num('short', 'Short break')}{num('long', 'Long break')}{num('rounds', 'Rounds')}</div>
      <div className="card focus-stats">
        <div className="label">Today {Math.floor(todayMin / 60)}h {todayMin % 60}m · this week by subject</div>
        {bySubject.map(([sub, m]) => <div key={sub} className="bar-row"><span>{sub}</span><div className="bar"><i style={{ width: `${(m / max) * 100}%` }} /></div><b>{Math.floor(m / 60)}h {m % 60}m</b></div>)}
        {!bySubject.length && <p className="muted small">Finished focus sessions are logged here.</p>}
      </div>
    </div>
  );
}

function Stopwatch() {
  const [run, setRun] = useState(false);
  const [ms, setMs] = useState(0);
  const base = useRef(0);
  const folders = useLiveQuery(() => db.folders.toArray(), []) || [];
  const [subject, setSubject] = useState('Mathematics');
  useEffect(() => { if (!run) return; base.current = Date.now() - ms; const t = setInterval(() => setMs(Date.now() - base.current), 200); return () => clearInterval(t); }, [run]);
  const sec = Math.floor(ms / 1000);
  const log = async () => { const m = Math.round(sec / 60); if (!m) return toast('Under a minute: nothing to log.'); await db.sessions.add({ id: uid(), subject, start: Date.now() - ms, mins: m }); setRun(false); setMs(0); toast(`Logged ${m} min of ${subject}`); };
  return (
    <div className="focus-body">
      <FlipClock label="Stopwatch" parts={[pad(Math.floor(sec / 3600)), pad(Math.floor(sec / 60) % 60), pad(sec % 60)]} />
      <div className="row">
        <button className="btn primary big" onClick={() => setRun(!run)}>{run ? <><Pause size={18} /> Pause</> : <><Play size={18} /> Start</>}</button>
        <button className="btn" onClick={() => { setRun(false); setMs(0); }}><RotateCcw size={16} /> Reset</button>
      </div>
      <div className="row"><select className="select" aria-label="Subject" value={subject} onChange={e => setSubject(e.target.value)}>{folders.map(f => <option key={f.id}>{f.name}</option>)}</select><button className="btn" onClick={log}>Log this time</button></div>
    </div>
  );
}
