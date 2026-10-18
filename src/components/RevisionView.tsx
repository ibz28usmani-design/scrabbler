import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db, type StudySession } from '../db';
import type { Subject } from '../lib/timetable';
import { dayKey, fmtClock, prevDay } from '../lib/dates';
import { OTHER_SUBJECT } from '../lib/folders';
import { nav, useNav } from '../lib/nav';
import { useSettings } from '../lib/settings';
import { getGame, levelFor } from '../lib/study';
import { seriesVar } from '../lib/subjectColors';
import {
  addManual,
  fmtMinutes,
  minutesByDay,
  minutesOf,
  pauseTimer,
  phaseElapsed,
  resumeTimer,
  startTimer,
  stopTimer,
  subjectStreak,
  tickTimer,
  timeXp,
  useTimer,
  weekDays,
  weekMinutes,
  weekStart,
  type RevisionTimer,
} from '../lib/studyTime';
import { toast } from '../lib/events';
import { PageHead } from './PageHead';
import { confirmDialog, Modal, Segmented } from './ui';
import { IFlame, IPause, IPlay, IPlus, IStop, ITimer, ITrash } from './Icons';

const HEAT_WEEKS = 12;

/** Ticks once a second while the timer runs, so phase changes happen on time. */
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/**
 * Runs the revision timer wherever you are in the app: moves Pomodoro phases
 * on, logs focus blocks, and says so.
 */
export function useTimerEngine() {
  const timer = useTimer();
  useEffect(() => {
    if (!timer) return;
    const run = async () => {
      const ev = await tickTimer();
      if (!ev) return;
      if (ev.kind === 'focus-done') {
        toast(`Focus block done — ${Math.round(ev.minutes)} minutes logged. Take a break.`, 'success');
        navigator.vibrate?.([120, 80, 120]);
      } else if (ev.kind === 'break-done') {
        toast('Break over — back to it.', 'info');
        navigator.vibrate?.(120);
      } else toast('The timer had run four hours, so it stopped and logged four hours. Edit the entry if that’s wrong.', 'info');
    };
    void run();
    const t = setInterval(run, 1000);
    return () => clearInterval(t);
  }, [timer]);
}

/** The running timer, pinned to a corner when you're elsewhere in the app. */
export function TimerChip() {
  const timer = useTimer();
  const { view } = useNav();
  const now = useNow(!!timer);
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  if (!timer || view === 'revision') return null;
  const name = subjects.find((s) => s.id === timer.subjectId)?.short ?? subjects.find((s) => s.id === timer.subjectId)?.name ?? 'Other';
  return (
    <button className={`timer-chip ${timer.phase}`} onClick={() => nav({ view: 'revision', pane: 'list' })} aria-label="Revision timer">
      <ITimer size={16} />
      <span className="timer-chip-clock">{clockFor(timer, now)}</span>
      <span className="timer-chip-label">{timer.phase === 'break' ? 'Break' : name}</span>
    </button>
  );
}

function clockFor(t: RevisionTimer, now: number) {
  const elapsed = phaseElapsed(t, now) / 1000;
  if (t.mode === 'stopwatch') return fmtClock(elapsed);
  const total = (t.phase === 'focus' ? t.focusMin : t.breakMin) * 60;
  return fmtClock(Math.max(0, total - elapsed));
}

interface SubjectStats {
  subject: Subject | { id: string; name: string; short?: string };
  streak: ReturnType<typeof subjectStreak>;
  week: number;
  perDay: Map<string, number> | undefined;
}

function useRevisionData() {
  const settings = useSettings();
  const since = useMemo(() => {
    let d = dayKey();
    for (let i = 0; i < 400; i++) d = prevDay(d);
    return d;
  }, []);
  const sessions = useLiveQuery(() => db.studyTime.where('day').aboveOrEqual(since).toArray(), [since]);
  const subjects = useLiveQuery(() => db.subjects.toArray(), []);
  return useMemo(() => {
    if (!sessions || !subjects) return null;
    const today = dayKey();
    const monday = weekStart(today);
    const byDay = minutesByDay(sessions);
    const tracked = settings.revisionSubjects.map((id) => subjects.find((s) => s.id === id) ?? { id, name: id });
    const stats: SubjectStats[] = tracked.map((subject) => ({
      subject,
      streak: subjectStreak(byDay.get(subject.id), settings.streakMinMinutes, today),
      week: weekMinutes(byDay.get(subject.id), monday),
      perDay: byDay.get(subject.id),
    }));
    const otherIds = [...byDay.keys()].filter((id) => !settings.revisionSubjects.includes(id));
    const otherWeek = otherIds.reduce((sum, id) => sum + weekMinutes(byDay.get(id), monday), 0);
    return { sessions, subjects, stats, otherWeek, byDay, today, monday };
  }, [sessions, subjects, settings.revisionSubjects, settings.streakMinMinutes]);
}

/** For the sidebar: the longest streak running, and whether a timer is going. */
export function useRevisionSummary() {
  const data = useRevisionData();
  const timer = useTimer();
  if (!data) return null;
  return { bestStreak: Math.max(0, ...data.stats.map((s) => s.streak.days)), timerOn: !!timer };
}

export function RevisionView({ narrow, showSidebarToggle }: { narrow: boolean; showSidebarToggle: boolean }) {
  const settings = useSettings();
  const data = useRevisionData();
  const [adding, setAdding] = useState(false);
  const game = useLiveQuery(() => getGame(), []);
  if (!data) return null;
  const target = settings.weeklyTargetHours * 60;
  const xp = (game?.xp ?? 0) + timeXp(data.sessions, settings.revisionSubjects, target);
  const lvl = levelFor(xp);
  const weekLabel = new Date(`${data.monday}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

  return (
    <div className="study revision">
      <PageHead title="Revision" narrow={narrow} showSidebarToggle={showSidebarToggle}>
        <button className="btn" onClick={() => setAdding(true)}>
          <IPlus size={16} /> Add time
        </button>
      </PageHead>
      <div className="study-scroll">
        <div className="rev-dateline">
          <span>Week of {weekLabel}</span>
          <span>
            Target {settings.weeklyTargetHours}h a subject · streak needs {settings.streakMinMinutes}m a day
          </span>
          <span className="rev-level" title={`${xp.toLocaleString()} XP from cards, quizzes and revision time`}>
            Lv {lvl.level} · {xp.toLocaleString()} XP
          </span>
        </div>

        <TimerPanel subjects={data.subjects} revised={settings.revisionSubjects} />

        <section className="rev-columns" aria-label="This week by subject">
          {data.stats.map((s) => (
            <SubjectColumn key={s.subject.id} s={s} target={target} monday={data.monday} today={data.today} revised={settings.revisionSubjects} />
          ))}
        </section>
        {data.otherWeek > 0 && <p className="rev-other">Plus {fmtMinutes(data.otherWeek)} this week on other subjects.</p>}

        <Heatmap data={data} revised={settings.revisionSubjects} min={settings.streakMinMinutes} />
        <Headlines data={data} target={target} />
        <SessionLog sessions={data.sessions} subjects={data.subjects} revised={settings.revisionSubjects} />
      </div>
      {adding && <AddTime subjects={data.subjects} revised={settings.revisionSubjects} onClose={() => setAdding(false)} />}
    </div>
  );
}

function SubjectColumn({ s, target, monday, today, revised }: { s: SubjectStats; target: number; monday: string; today: string; revised: string[] }) {
  const days = weekDays(monday);
  const pct = Math.min(1, s.week / target);
  const color = seriesVar(s.subject.id, revised);
  const left = Math.max(0, target - s.week);
  return (
    <article className="rev-col" style={{ ['--ink' as string]: color }}>
      <h2 className="rev-subject">
        <span className="rev-key" aria-hidden="true" />
        {s.subject.name}
      </h2>
      <div className={`rev-streak ${s.streak.todayMet ? 'lit' : ''}`}>
        <IFlame size={30} />
        <span className="rev-streak-num">{s.streak.days}</span>
        <span className="rev-streak-label">
          day{s.streak.days === 1 ? '' : 's'} running
          <br />
          best {s.streak.best}
        </span>
      </div>
      <p className="rev-today">
        {s.streak.todayMet ? 'Today’s done' : s.streak.days ? 'Keep it going today' : 'Start a streak today'} · {fmtMinutes(s.streak.todayMinutes)} today
      </p>
      <div className="rev-meter" role="img" aria-label={`${fmtMinutes(s.week)} of ${fmtMinutes(target)} this week`}>
        {days.map((d) => {
          const m = s.perDay?.get(d) ?? 0;
          return m > 0 ? <span key={d} className="rev-meter-seg" style={{ flexGrow: m }} title={`${new Date(`${d}T12:00`).toLocaleDateString(undefined, { weekday: 'long' })}: ${fmtMinutes(m)}`} /> : null;
        })}
        <span className="rev-meter-rest" style={{ flexGrow: Math.max(0, target - s.week) }} />
      </div>
      <div className="rev-meter-legend">
        <strong>{fmtMinutes(s.week)}</strong> of {fmtMinutes(target)}
        <span className="spacer" />
        {pct >= 1 ? 'Target met ✦' : `${fmtMinutes(left)} to go`}
      </div>
      <div className="rev-week" aria-hidden="true">
        {days.map((d) => (
          <span key={d} className={`rev-day ${(s.perDay?.get(d) ?? 0) > 0 ? 'on' : ''} ${d === today ? 'today' : ''}`}>
            {new Date(`${d}T12:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}
          </span>
        ))}
      </div>
      <button className="btn small" onClick={() => startTimer(s.subject.id, 'pomodoro')}>
        <IPlay size={14} /> 25-minute block
      </button>
    </article>
  );
}

function TimerPanel({ subjects, revised }: { subjects: Subject[]; revised: string[] }) {
  const timer = useTimer();
  const now = useNow(!!timer);
  const [subjectId, setSubjectId] = useState(revised[0] ?? OTHER_SUBJECT);
  const [mode, setMode] = useState<RevisionTimer['mode']>('pomodoro');
  const [focusMin, setFocusMin] = useState(25);
  const [label, setLabel] = useState('');
  const name = (id: string) => subjects.find((s) => s.id === id)?.name ?? 'Other';

  if (timer) {
    const running = !timer.pausedAt;
    return (
      <section className={`rev-timer on ${timer.phase}`} aria-live="polite">
        <div className="rev-timer-kicker">
          {timer.phase === 'break' ? 'Break' : name(timer.subjectId)}
          {timer.label ? ` — ${timer.label}` : ''}
          {timer.mode === 'pomodoro' && ` · block ${timer.cycles + (timer.phase === 'focus' ? 1 : 0)}`}
        </div>
        <div className="rev-clock">{clockFor(timer, now)}</div>
        <div className="rev-timer-actions">
          {running ? (
            <button className="btn" onClick={pauseTimer}>
              <IPause size={16} /> Pause
            </button>
          ) : (
            <button className="btn" onClick={resumeTimer}>
              <IPlay size={16} /> Resume
            </button>
          )}
          <button
            className="btn primary"
            onClick={async () => {
              const min = await stopTimer();
              toast(min ? `${fmtMinutes(min)} logged to ${name(timer.subjectId)}.` : 'Stopped — under a minute, so nothing was logged.', 'success');
            }}
          >
            <IStop size={16} /> Stop &amp; log
          </button>
        </div>
        <p className="muted small">While the timer runs, time in the app isn’t counted twice. Lock the iPad and revise on paper: it keeps time.</p>
      </section>
    );
  }
  return (
    <section className="rev-timer">
      <div className="rev-timer-kicker">Revision timer</div>
      <div className="rev-timer-form">
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="Subject">
          {[...revised.map((id) => subjects.find((s) => s.id === id)).filter(Boolean), ...subjects.filter((s) => !revised.includes(s.id))].map((s) => (
            <option key={s!.id} value={s!.id}>
              {s!.name}
            </option>
          ))}
          <option value={OTHER_SUBJECT}>Other</option>
        </select>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What are you revising? (optional)" aria-label="What you're revising" />
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'pomodoro', label: 'Pomodoro' },
            { value: 'stopwatch', label: 'Stopwatch' },
          ]}
        />
        {mode === 'pomodoro' && (
          <select value={focusMin} onChange={(e) => setFocusMin(Number(e.target.value))} aria-label="Focus length">
            {[15, 25, 45, 50].map((m) => (
              <option key={m} value={m}>
                {m} min focus · {m >= 45 ? 10 : 5} break
              </option>
            ))}
          </select>
        )}
        <button className="btn primary" onClick={() => startTimer(subjectId, mode, focusMin, focusMin >= 45 ? 10 : 5, label.trim() || undefined)}>
          <IPlay size={16} /> Start
        </button>
      </div>
      <p className="muted small">Time you spend in a subject’s notes, cards and tutor counts on its own; use the timer for work off the screen.</p>
    </section>
  );
}

/** One row of days per subject, darker for more minutes, as a calendar of ink. */
function Heatmap({ data, revised, min }: { data: NonNullable<ReturnType<typeof useRevisionData>>; revised: string[]; min: number }) {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const days: string[] = [];
  let d = data.today;
  const start = weekStart(data.today);
  // Whole weeks, Monday first, ending this week.
  for (let i = 0; i < HEAT_WEEKS * 7; i++) {
    days.unshift(d);
    d = prevDay(d);
  }
  while (days[0] !== weekStart(days[0])) days.shift();
  const end = weekDays(start)[6];
  for (let k = dayKey(new Date(`${data.today}T12:00`).getTime() + 86400000); k <= end; k = dayKey(new Date(`${k}T12:00`).getTime() + 86400000)) days.push(k);
  const level = (m: number) => (m <= 0 ? 0 : m < min ? 1 : m < 60 ? 2 : m < 120 ? 3 : 4);
  return (
    <section className="rev-heat" aria-label={`Revision by day, last ${HEAT_WEEKS} weeks`}>
      <h3 className="rev-section">The last {HEAT_WEEKS} weeks</h3>
      {data.stats.map((s) => (
        <div key={s.subject.id} className="rev-heat-row" style={{ ['--ink' as string]: seriesVar(s.subject.id, revised) }}>
          <span className="rev-heat-name">{'short' in s.subject && s.subject.short ? s.subject.short : s.subject.name}</span>
          <div className="rev-heat-cells">
            {days.map((day) => {
              const m = s.perDay?.get(day) ?? 0;
              const future = day > data.today;
              return (
                <span
                  key={day}
                  className={`heat l${future ? 'x' : level(m)}`}
                  onPointerEnter={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setTip({ text: `${s.subject.name} · ${new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${m ? fmtMinutes(m) : 'none'}`, x: r.left + r.width / 2, y: r.top });
                  }}
                  onPointerLeave={() => setTip(null)}
                />
              );
            })}
          </div>
        </div>
      ))}
      <div className="rev-heat-key" aria-hidden="true">
        Less <span className="heat l0" /> <span className="heat l1" /> <span className="heat l2" /> <span className="heat l3" /> <span className="heat l4" /> More
        <span className="muted"> · under {min}m, under 1h, under 2h, 2h+</span>
      </div>
      {tip && (
        <div className="viz-tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
    </section>
  );
}

interface Headline {
  title: string;
  dek: string;
  earned: boolean;
}

/** Achievements, set as the week's headlines. */
function Headlines({ data, target }: { data: NonNullable<ReturnType<typeof useRevisionData>>; target: number }) {
  const total = data.sessions.reduce((sum, s) => sum + minutesOf(s), 0);
  const best = Math.max(0, ...data.stats.map((s) => s.streak.best));
  const onTarget = data.stats.filter((s) => s.week >= target);
  const timerDays = new Map<string, number>();
  for (const s of data.sessions) if (s.source === 'timer') timerDays.set(s.day, (timerDays.get(s.day) ?? 0) + 1);
  const early = data.sessions.some((s) => new Date(s.start).getHours() < 8);
  const items: Headline[] = [
    { title: 'First Hour Filed', dek: 'An hour of revision, all told.', earned: total >= 60 },
    { title: 'A Week Unbroken', dek: 'A seven-day streak in any subject.', earned: best >= 7 },
    { title: 'Month-Long Run', dek: 'Thirty days in a row on one subject.', earned: best >= 30 },
    { title: 'Target Met', dek: `${Math.round(target / 60)} hours on a subject in one week.`, earned: onTarget.length > 0 },
    { title: 'Clean Sweep', dek: 'Every subject on target this week.', earned: data.stats.length > 0 && onTarget.length === data.stats.length },
    { title: 'Four Blocks Deep', dek: 'Four timed blocks in a day.', earned: [...timerDays.values()].some((n) => n >= 4) },
    { title: 'Early Edition', dek: 'Revision started before 8am.', earned: early },
    { title: 'Fifty Hours', dek: 'Fifty hours of revision, all told.', earned: total >= 3000 },
  ];
  return (
    <section className="rev-headlines" aria-label="Achievements">
      <h3 className="rev-section">Headlines</h3>
      <div className="rev-headline-grid">
        {items.map((h) => (
          <div key={h.title} className={`rev-headline ${h.earned ? 'earned' : ''}`}>
            <span className="rev-headline-title">{h.title}</span>
            <span className="rev-headline-dek">{h.earned ? h.dek : `Not yet: ${h.dek.charAt(0).toLowerCase()}${h.dek.slice(1)}`}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const SOURCE: Record<StudySession['source'], string> = { auto: 'In the app', timer: 'Timer', manual: 'Added' };
const ACTIVITY: Record<StudySession['activity'], string> = { notes: 'notes', cards: 'flashcards', quiz: 'quiz', tutor: 'tutor', notebook: 'notebook', lecture: 'lecture', timer: 'timed', manual: 'by hand' };

function SessionLog({ sessions, subjects, revised }: { sessions: StudySession[]; subjects: Subject[]; revised: string[] }) {
  const [all, setAll] = useState(false);
  const recent = [...sessions].sort((a, b) => b.start - a.start).slice(0, all ? 200 : 12);
  if (!recent.length) return null;
  return (
    <section className="rev-log" aria-label="Recent revision">
      <h3 className="rev-section">The log</h3>
      <ul>
        {recent.map((s) => (
          <li key={s.id} style={{ ['--ink' as string]: seriesVar(s.subjectId, revised) }}>
            <span className="rev-key" aria-hidden="true" />
            <span className="rev-log-subject">{subjects.find((x) => x.id === s.subjectId)?.name ?? 'Other'}</span>
            <span className="rev-log-what">
              {SOURCE[s.source]} · {ACTIVITY[s.activity]}
              {s.label ? ` · ${s.label}` : ''}
            </span>
            <span className="rev-log-when">
              {new Date(s.start).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
              {s.source !== 'manual' && `, ${new Date(s.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
            </span>
            <span className="rev-log-min">{fmtMinutes(minutesOf(s))}</span>
            <button
              className="icon-btn small"
              aria-label="Delete this entry"
              onClick={async () => {
                if (await confirmDialog('Delete this revision entry? Streaks and totals are recounted without it.')) await db.studyTime.delete(s.id);
              }}
            >
              <ITrash size={15} />
            </button>
          </li>
        ))}
      </ul>
      {sessions.length > 12 && (
        <button className="link-btn" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : 'Show more'}
        </button>
      )}
    </section>
  );
}

function AddTime({ subjects, revised, onClose }: { subjects: Subject[]; revised: string[]; onClose: () => void }) {
  const [subjectId, setSubjectId] = useState(revised[0] ?? OTHER_SUBJECT);
  const [day, setDay] = useState(dayKey());
  const [minutes, setMinutes] = useState(30);
  const [label, setLabel] = useState('');
  const ok = minutes > 0 && minutes <= 12 * 60 && day <= dayKey();
  return (
    <Modal
      title="Add revision time"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!ok}
            onClick={async () => {
              await addManual(subjectId, day, minutes, label.trim() || undefined);
              toast(`${fmtMinutes(minutes)} added.`, 'success');
              onClose();
            }}
          >
            Add
          </button>
        </>
      }
    >
      <label className="field">
        <span>Subject</span>
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value={OTHER_SUBJECT}>Other</option>
        </select>
      </label>
      <label className="field">
        <span>Day</span>
        <input type="date" value={day} max={dayKey()} onChange={(e) => setDay(e.target.value)} />
      </label>
      <label className="field">
        <span>Minutes</span>
        <input type="number" min={1} max={720} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
      </label>
      <label className="field">
        <span>What (optional)</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Past paper, flashcards on paper…" />
      </label>
    </Modal>
  );
}
