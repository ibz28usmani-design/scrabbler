import { useTimetable, useNow } from '../lib/calendarData';
import { currentAndNext, dateIn, dayStatus, timeRange, type ClassTime, type Subject } from '../lib/timetable';
import { dayTitle } from '../lib/reminders';
import { nav } from '../lib/nav';

/** "in 25 min", "in 2 h 5 min", "tomorrow", "in 6 days". */
export function countdown(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return 'now';
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 12) return `in ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
  const days = Math.round(ms / 86400000);
  return days <= 1 ? 'tomorrow' : `in ${days} days`;
}

function label(c: ClassTime, subjects: Subject[], short: boolean) {
  const s = subjects.find((x) => x.id === c.lesson.subjectId);
  return { name: (short && s?.short) || s?.name || 'Class', color: s?.color ?? '#888' };
}

/**
 * Where you need to be next: the class on now and the one after it, or the
 * first class back after a break. `compact` is the sidebar version.
 */
export function NextClass({ compact = false }: { compact?: boolean }) {
  const tt = useTimetable();
  const now = useNow(compact ? 30000 : 15000);
  if (!tt || !tt.lessons.length) return null;
  const { current, next } = currentAndNext(tt.lessons, tt.calendar, now);
  const today = dateIn(now);
  const status = dayStatus(today, tt.calendar);
  const away = !current && next && next.date > today && (status.kind === 'closure' || status.kind === 'holiday');

  const row = (c: ClassTime, kind: 'now' | 'next') => {
    const l = label(c, tt.subjects, compact);
    const soon = kind === 'next' && c.date === today ? countdown(c.start - now) : '';
    // The sidebar is narrow: the countdown moves under the name there.
    const when = kind === 'now' ? `until ${c.lesson.end}` : c.date === today ? (compact ? c.lesson.start : `${c.lesson.start} · ${soon}`) : `${dayTitle(c.date, today)} ${c.lesson.start}`;
    return (
      <div className={`next-row ${kind}`} style={{ ['--subject' as string]: l.color }}>
        <span className="next-kind">{kind === 'now' ? 'Now' : 'Next'}</span>
        <span className="next-name">{l.name}</span>
        <span className="next-when">{when}</span>
        {!compact && <span className="next-where">{[timeRange(c.lesson), c.lesson.room, c.lesson.teacher].filter(Boolean).join(' · ')}</span>}
        {compact && (soon || c.lesson.room) && <span className="next-where">{[soon, c.lesson.room].filter(Boolean).join(' · ')}</span>}
      </div>
    );
  };

  return (
    <button className={`next-class ${compact ? 'compact' : ''}`} onClick={() => nav({ view: 'calendar', pane: 'list', drawer: false })}>
      {away && <div className="next-away">{status.label ?? 'No classes'} — back {dayTitle(next!.date, today) === 'Tomorrow' ? 'tomorrow' : dayTitle(next!.date, today)}</div>}
      {current && row(current, 'now')}
      {next && row(next, 'next')}
      {!current && !next && <div className="next-away">No classes coming up — check the term dates.</div>}
    </button>
  );
}
