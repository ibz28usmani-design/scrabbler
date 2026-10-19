import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { nav, openStudy } from '../lib/nav';
import { deckCounts } from '../lib/study';
import { useSettings } from '../lib/settings';
import { dateIn } from '../lib/timetable';
import { inSmartList } from '../lib/reminders';
import { fmtMinutes, startTimer } from '../lib/studyTime';
import { countdown, daysBetween, nextExams } from '../lib/exams';
import { seriesVar } from '../lib/subjectColors';
import { shortDate } from '../lib/dates';
import { ago, backupNow, useBackupState } from '../lib/safety';
import { useSyncStatus } from '../lib/syncState';
import { useRevisionData } from './RevisionTimer';
import { toggleComplete } from './RemindersView';
import { NextClass } from './NextClass';
import { PageHead } from './PageHead';
import { ICards, IFlame, IPlay } from './Icons';

/**
 * One screen for the start of the day: where to be, what's due, what to
 * revise and how far off the exams are.
 */
export function TodayView({ narrow, showSidebarToggle }: { narrow: boolean; showSidebarToggle: boolean }) {
  const settings = useSettings();
  const today = dateIn(Date.now());
  const reminders = useLiveQuery(async () => (await db.reminders.toArray()).filter((r) => inSmartList(r, 'today', today)).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? '') || (a.time ?? '').localeCompare(b.time ?? '')), [today]);
  const cards = useLiveQuery(async () => deckCounts(await db.cards.toArray()), []);
  const recent = useLiveQuery(async () => (await db.notes.orderBy('updatedAt').reverse().filter((n) => !n.deletedAt).limit(4).toArray()), []);
  const revision = useRevisionData();
  const exams = revision ? [...nextExams(revision.exams, today).values()].sort((a, b) => a.date.localeCompare(b.date)) : [];
  const subjects = revision?.subjects ?? [];
  const backup = useBackupState();
  const sync = useSyncStatus();
  const name = (id: string) => subjects.find((s) => s.id === id)?.name ?? id;
  const dateline = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="study today">
      <PageHead title="Today" narrow={narrow} showSidebarToggle={showSidebarToggle} />
      <div className="study-scroll">
        <p className="today-dateline">{dateline}</p>

        <section className="today-block" aria-labelledby="t-class">
          <h2 id="t-class">Classes</h2>
          <NextClass />
        </section>

        <div className="today-grid">
          <section className="today-block" aria-labelledby="t-due">
            <h2 id="t-due">Due</h2>
            {!reminders ? null : !reminders.length ? (
              <p className="muted">Nothing due today.</p>
            ) : (
              <ul className="today-list">
                {reminders.slice(0, 8).map((r) => (
                  <li key={r.id}>
                    <label className="today-check">
                      <input type="checkbox" checked={r.completed} onChange={() => toggleComplete(r)} />
                      <span>
                        {r.title}
                        <span className={`muted small ${r.due! < today ? 'late' : ''}`}>{r.due! < today ? ' · overdue' : r.time ? ` · ${r.time}` : ''}</span>
                      </span>
                    </label>
                  </li>
                ))}
                {reminders.length > 8 && (
                  <li>
                    <button className="btn small" onClick={() => nav({ view: 'reminders', pane: 'list' })}>
                      All {reminders.length}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </section>

          <section className="today-block" aria-labelledby="t-cards">
            <h2 id="t-cards">Flashcards</h2>
            {cards && (
              <>
                <p className="today-big">
                  <strong>{cards.due}</strong> due{cards.fresh ? <span className="muted"> · {cards.fresh} new</span> : null}
                </p>
                <button
                  className="btn primary"
                  disabled={!cards.due && !cards.fresh}
                  onClick={async () => nav({ view: 'study', pane: 'list', session: { deckIds: (await db.decks.toCollection().primaryKeys()) as string[], mode: 'study' } })}
                >
                  <ICards size={16} /> Study now
                </button>
              </>
            )}
          </section>
        </div>

        {revision && (
          <section className="today-block" aria-labelledby="t-rev">
            <h2 id="t-rev">Revision this week</h2>
            <ul className="today-meters">
              {revision.stats.map((s) => {
                const pct = Math.min(100, Math.round((s.week / s.target) * 100));
                return (
                  <li key={s.subject.id} style={{ ['--ink' as string]: seriesVar(s.subject.id, settings.revisionSubjects) }}>
                    <span className="today-meter-name">
                      <span className="rev-key" aria-hidden="true" /> {s.subject.name}
                      {s.streak.days > 0 && (
                        <span className="streak-pill" title={`${s.streak.days}-day streak`}>
                          <IFlame size={12} /> {s.streak.days}
                        </span>
                      )}
                    </span>
                    <span className="today-meter" role="meter" aria-valuemin={0} aria-valuemax={s.target} aria-valuenow={Math.round(s.week)} aria-label={`${s.subject.name}: ${fmtMinutes(s.week)} of ${fmtMinutes(s.target)}`}>
                      <span style={{ width: `${pct}%` }} />
                    </span>
                    <span className="today-meter-text">
                      {fmtMinutes(s.week)} / {fmtMinutes(s.target)}
                    </span>
                    <button className="icon-btn small" onClick={() => startTimer(s.subject.id, 'pomodoro')} aria-label={`Start a 25-minute block of ${s.subject.name}`} title="25-minute block">
                      <IPlay size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <button className="btn small" onClick={() => openStudy('revision')}>
              Open Revision
            </button>
          </section>
        )}

        <section className="today-block" aria-labelledby="t-exams">
          <h2 id="t-exams">Exams</h2>
          {!exams.length ? (
            <p className="muted">
              No exam dates yet.{' '}
              <button className="link-btn" onClick={() => openStudy('revision')}>
                Add them on the Revision page
              </button>{' '}
              and the weekly targets, plan and flashcards build toward them.
            </p>
          ) : (
            <ul className="today-exams">
              {exams.map((e) => {
                const d = daysBetween(today, e.date);
                return (
                  <li key={e.id} style={{ ['--ink' as string]: seriesVar(e.subjectId, settings.revisionSubjects) }}>
                    <span className="exam-days">
                      <strong>{d}</strong>
                      <small>{d === 1 ? 'day' : 'days'}</small>
                    </span>
                    <span>
                      <strong>{name(e.subjectId)}</strong> — {e.name}, {countdown(d)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {!!recent?.length && (
          <section className="today-block" aria-labelledby="t-recent">
            <h2 id="t-recent">Carry on</h2>
            <ul className="today-list">
              {recent.map((n) => (
                <li key={n.id}>
                  <button className="link-btn" onClick={() => nav({ view: 'folder', folderId: n.folderId, noteId: n.id, pane: 'editor' })}>
                    {n.title || 'New Note'}
                  </button>
                  <span className="muted small"> · {shortDate(n.updatedAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="today-safety muted small">
          {sync.enabled ? (sync.lastOkAt ? `Synced ${ago(sync.lastOkAt)}.` : 'Sync is on and has not finished yet.') : 'Sync is off.'}{' '}
          {backup?.lastAt ? `Last backup ${ago(backup.lastAt)}.` : 'Not backed up yet.'}{' '}
          {backup?.changedSince && (
            <button className="link-btn" onClick={() => void backupNow()}>
              Back up now
            </button>
          )}
        </p>
      </div>
    </div>
  );
}
