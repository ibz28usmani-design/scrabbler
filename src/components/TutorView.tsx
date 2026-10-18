import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db, getTermCalendar, uid, type TutorTool } from '../db';
import type { Content } from '../lib/gemini';
import type { Stroke } from '../lib/ink';
import { transcribeHandwriting } from '../lib/ai';
import { dayKey, fmtClock } from '../lib/dates';
import { toast, toastError } from '../lib/events';
import { folderSubject, OTHER_SUBJECT } from '../lib/folders';
import { renderInkPages } from '../lib/inkRender';
import { canReadImages, hasTextKey, stream } from '../lib/llm';
import { mdToHtml } from '../lib/markdown';
import { nav, openModal } from '../lib/nav';
import { PAGE_H } from '../lib/paper';
import { freeSlots, planWeek, type PlanBlock } from '../lib/revisionPlan';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { makeCard } from '../lib/study';
import { fmtMinutes, minutesByDay, weekDays, weekMinutes, weekStart } from '../lib/studyTime';
import { seriesVar } from '../lib/subjectColors';
import { addDays } from '../lib/timetable';
import {
  cardsForGaps,
  examQuestion,
  explainSimply,
  markBlurt,
  markExam,
  markFeynman,
  mockPaper,
  saveAttempt,
  socraticSummary,
  socraticSystem,
  subjectFolders,
  subjectMaterial,
  TOOL_LABEL,
  weakSpots,
  type BlurtResult,
  type Ctx,
  type ExamMark,
  type ExamQuestion,
  type FeynmanResult,
  type WeakSpot,
} from '../lib/tutor';
import { useStudyPresence } from '../lib/useStudyPresence';
import { addReminder } from './RemindersView';
import { PageHead } from './PageHead';
import { SketchCanvas } from './SketchCanvas';
import { useDark } from '../lib/theme';
import { Segmented, Spinner } from './ui';
import { ICards, ISend, ISparkle } from './Icons';

type Tab = 'blurt' | 'feynman' | 'exam' | 'mock' | 'socratic' | 'weak' | 'plan';

const TABS: { value: Tab; label: string }[] = [
  { value: 'blurt', label: 'Blurt' },
  { value: 'feynman', label: 'Feynman' },
  { value: 'exam', label: 'Exam question' },
  { value: 'mock', label: 'Mock paper' },
  { value: 'socratic', label: 'Socratic' },
  { value: 'weak', label: 'Weak spots' },
  { value: 'plan', label: 'Plan' },
];

const DEFAULT_BOARD: Record<string, string> = { law: 'AQA A-level Law', economics: 'AQA A-level Economics', maths: 'Edexcel A-level Mathematics' };

interface Setup {
  subjectId: string;
  subject: string;
  board: string;
  topic: string;
  /** Loads the subject's notes on the topic, to mark against. */
  ctx: () => Promise<Ctx>;
}

const Md = ({ md }: { md: string }) => <div className="prose md" dangerouslySetInnerHTML={{ __html: mdToHtml(md) }} />;

/**
 * Exercises that make you remember and explain rather than reread, marked
 * against your own notes: the active-recall half of revision, after
 * Turbo.ai's tutor and the "study like a genius" methods.
 */
export function TutorView({ narrow, showSidebarToggle }: { narrow: boolean; showSidebarToggle: boolean }) {
  const settings = useSettings();
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  const [tab, setTab] = useState<Tab>('blurt');
  const [subjectId, setSubjectId] = useState(settings.revisionSubjects[0] ?? OTHER_SUBJECT);
  const [topic, setTopic] = useState('');
  const [seed, setSeed] = useState<string | null>(null);
  const subject = subjects.find((s) => s.id === subjectId)?.name ?? 'General';
  const board = settings.examBoards[subjectId] ?? DEFAULT_BOARD[subjectId] ?? `A-level ${subject}`;
  useStudyPresence('tutor', { subjectId });

  // Topic ideas: the titles of this subject's notes.
  const topics =
    useLiveQuery(async () => {
      const ids = await subjectFolders(subjectId);
      return (await db.notes.where('folderId').anyOf(ids).toArray()).filter((n) => !n.deletedAt && n.title).map((n) => n.title);
    }, [subjectId]) ?? [];

  const setup: Setup = {
    subjectId,
    subject,
    board,
    topic,
    ctx: async () => ({ subject, board, topic, material: await subjectMaterial(subjectId, topic || subject) }),
  };
  const go = (t: Tab, nextTopic?: string, first?: string) => {
    if (nextTopic !== undefined) setTopic(nextTopic);
    setSeed(first ?? null);
    setTab(t);
  };

  return (
    <div className="study tutor-page">
      <PageHead title="Tutor" narrow={narrow} showSidebarToggle={showSidebarToggle} />
      <div className="tutor-bar">
        <label className="field inline">
          <span>Subject</span>
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline grow">
          <span>Exam board</span>
          <input value={board} onChange={(e) => updateSettings({ examBoards: { ...getSettings().examBoards, [subjectId]: e.target.value } })} />
        </label>
        <label className="field inline grow2">
          <span>Topic</span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} list="tutor-topics" placeholder="e.g. Offer and acceptance" />
          <datalist id="tutor-topics">
            {topics.slice(0, 200).map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="tutor-tabs">
        <Segmented value={tab} onChange={(t) => go(t)} options={TABS} />
      </div>
      <div className="study-scroll tutor-scroll" style={{ ['--ink' as string]: seriesVar(subjectId, settings.revisionSubjects) }}>
        {!hasTextKey() && tab !== 'weak' && tab !== 'plan' ? (
          <div className="warn">
            The tutor needs an AI key.{' '}
            <button className="link-btn" onClick={() => openModal({ type: 'settings' })}>
              Set up free AI
            </button>
          </div>
        ) : tab === 'blurt' ? (
          <Blurt key={subjectId} s={setup} />
        ) : tab === 'feynman' ? (
          <Feynman key={subjectId} s={setup} onDiscuss={(first) => go('socratic', undefined, first)} />
        ) : tab === 'exam' ? (
          <Exam key={subjectId} s={setup} />
        ) : tab === 'mock' ? (
          <Mock key={subjectId} s={setup} />
        ) : tab === 'socratic' ? (
          <Socratic key={`${subjectId}:${seed}`} s={setup} seed={seed} />
        ) : tab === 'weak' ? (
          <Weak onPick={(t, sub, to) => (setSubjectId(sub), go(to, t))} />
        ) : (
          <Plan />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- shared pieces

interface Answer {
  mode: 'typed' | 'hand';
  text: string;
  strokes: Stroke[];
  height: number;
}

const emptyAnswer = (): Answer => ({ mode: 'typed', text: '', strokes: [], height: PAGE_H });

/** The answer as text: typed as it is, handwriting read by the AI first. */
async function answerText(a: Answer): Promise<string> {
  if (a.mode === 'typed') return a.text.trim();
  if (!a.strokes.length) return '';
  if (!canReadImages()) throw new Error('Reading handwriting needs a model that can see images: add a Gemini key in Settings.');
  const pages = await renderInkPages({ strokes: a.strokes, paper: 'lines' }, { scale: 1.5, template: false });
  return (await transcribeHandwriting(pages, 'formatted', 'lines')).trim();
}

/** Typed, or written by hand with the Pencil on lined paper. */
function AnswerBox({ value, onChange, placeholder, rows = 10 }: { value: Answer; onChange: (a: Answer) => void; placeholder: string; rows?: number }) {
  const dark = useDark();
  return (
    <div className="answer-box">
      <Segmented
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode })}
        options={[
          { value: 'typed', label: 'Type' },
          { value: 'hand', label: 'Write by hand' },
        ]}
      />
      {value.mode === 'typed' ? (
        <textarea className="input answer-text" rows={rows} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} placeholder={placeholder} />
      ) : (
        <div className="editor-pane answer-ink">
          <div className="editor-scroll">
            <SketchCanvas
              paper="lines"
              page
              strokes={value.strokes}
              height={value.height}
              dark={dark}
              active
              onActivate={() => {}}
              onChange={(p) => onChange({ ...value, ...(p.strokes ? { strokes: p.strokes } : {}), ...(p.height ? { height: p.height } : {}) })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Busy({ children }: { children: ReactNode }) {
  return (
    <p className="tutor-busy">
      <Spinner size={15} /> {children}
    </p>
  );
}

function List({ title, items, tone }: { title: string; items: string[]; tone?: 'good' | 'bad' }) {
  if (!items.length) return null;
  return (
    <div className={`tutor-list ${tone ?? ''}`}>
      <h4>{title}</h4>
      <ul>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

/** Cards for what an exercise showed you don't know, filed in the subject's folder. */
function GapCards({ s, gaps }: { s: Setup; gaps: string[] }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (!gaps.length) return null;
  return (
    <button
      className="btn"
      disabled={busy || done}
      onClick={async () => {
        setBusy(true);
        try {
          const cards = await cardsForGaps(s.subject, s.topic || s.subject, gaps);
          const folderId = (await subjectFolders(s.subjectId))[0];
          const id = uid();
          const now = Date.now();
          await db.transaction('rw', db.decks, db.cards, async () => {
            await db.decks.add({ id, name: `Gaps: ${s.topic || s.subject}`, createdAt: now, emoji: '🩹', ...(folderId ? { folderId } : {}) });
            await db.cards.bulkAdd(cards.map((c, i) => makeCard(id, { type: 'basic', ...c }, now + i)));
          });
          setDone(true);
          toast(`${cards.length} flashcards made from what you missed`, 'success');
        } catch (e) {
          toastError(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Spinner size={14} /> : <ICards size={16} />} {done ? 'Cards made' : 'Make flashcards from the gaps'}
    </button>
  );
}

function Countdown({ minutes, onDone }: { minutes: number; onDone?: () => void }) {
  const [start] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = minutes * 60 - (now - start) / 1000;
  if (left <= 0 && !fired.current) {
    fired.current = true;
    onDone?.();
  }
  return <span className={`tutor-clock ${left < 60 ? 'late' : ''}`}>{left > 0 ? fmtClock(left) : `+${fmtClock(-left)}`}</span>;
}

// ---------------------------------------------------------------- blurt

function Blurt({ s }: { s: Setup }) {
  const [answer, setAnswer] = useState<Answer>(emptyAnswer);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<BlurtResult | null>(null);
  const [started, setStarted] = useState(false);

  const mark = async () => {
    try {
      setBusy(answer.mode === 'hand' ? 'Reading your handwriting…' : 'Marking…');
      const text = await answerText(answer);
      if (!text) return toast('Write what you remember first.', 'info');
      setBusy('Checking it against your notes…');
      const ctx = await s.ctx();
      const r = await markBlurt(ctx, text);
      setResult(r);
      await saveAttempt({ tool: 'blurt', subjectId: s.subjectId, topic: s.topic, answer: text, feedback: r.feedback, score: r.score, max: 100, gaps: [...r.missed, ...r.wrong] });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="tutor-tool">
      <header className="tutor-lede">
        <h2>Blurt it out</h2>
        <p>
          Close your notes. Write down everything you can remember about <strong>{s.topic || 'the topic above'}</strong> — headings, cases, diagrams, anything. Then see what you missed. Retrieval like this is what makes revision stick.
        </p>
        {started ? <Countdown minutes={5} onDone={() => toast('Five minutes — finish your thought, then mark it.', 'info')} /> : (
          <button className="btn small" onClick={() => setStarted(true)}>
            Start a 5-minute clock
          </button>
        )}
      </header>
      {!result ? (
        <>
          <AnswerBox value={answer} onChange={setAnswer} placeholder="Everything you remember…" rows={12} />
          {busy ? <Busy>{busy}</Busy> : (
            <button className="btn primary" disabled={!s.topic.trim()} onClick={mark} title={s.topic.trim() ? '' : 'Choose a topic above first'}>
              <ISparkle size={16} /> Mark my blurt
            </button>
          )}
        </>
      ) : (
        <div className="tutor-result">
          <div className="tutor-score">
            <span className="tutor-score-num">{result.score}</span>
            <span className="tutor-score-of">% recalled</span>
          </div>
          <Md md={result.feedback} />
          <div className="tutor-cols">
            <List title="You remembered" items={result.covered} tone="good" />
            <List title="You missed" items={result.missed} tone="bad" />
            <List title="Not quite right" items={result.wrong} tone="bad" />
          </div>
          <div className="row wrap">
            <GapCards s={s} gaps={[...result.missed, ...result.wrong]} />
            <button className="btn" onClick={() => (setResult(null), setAnswer(emptyAnswer()), setStarted(false))}>
              Blurt again
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Feynman

function Feynman({ s, onDiscuss }: { s: Setup; onDiscuss: (first: string) => void }) {
  const [answer, setAnswer] = useState<Answer>(emptyAnswer);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<FeynmanResult | null>(null);

  const mark = async () => {
    try {
      setBusy(answer.mode === 'hand' ? 'Reading your handwriting…' : 'Listening…');
      const text = await answerText(answer);
      if (!text) return toast('Explain it first.', 'info');
      const r = await markFeynman(await s.ctx(), text);
      setResult(r);
      await saveAttempt({ tool: 'feynman', subjectId: s.subjectId, topic: s.topic, answer: text, feedback: r.feedback, score: r.score, max: 10, gaps: r.gaps });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="tutor-tool">
      <header className="tutor-lede">
        <h2>Teach it to a twelve-year-old</h2>
        <p>
          Explain <strong>{s.topic || 'the topic above'}</strong> in plain words, as if to someone bright who has never met it. Wherever you reach for jargon or wave your hands, that’s the gap.
        </p>
      </header>
      {!result ? (
        <>
          <AnswerBox value={answer} onChange={setAnswer} placeholder="So basically, …" />
          {busy ? <Busy>{busy}</Busy> : (
            <button className="btn primary" disabled={!s.topic.trim()} onClick={mark}>
              <ISparkle size={16} /> How did I do?
            </button>
          )}
        </>
      ) : (
        <div className="tutor-result">
          <div className="tutor-score">
            <span className="tutor-score-num">{result.score}</span>
            <span className="tutor-score-of">/ 10</span>
          </div>
          <Md md={result.feedback} />
          <div className="tutor-cols">
            <List title="Jargon to unpack" items={result.jargon} />
            <List title="Gaps" items={result.gaps} tone="bad" />
            <List title="A curious learner would ask" items={result.followUps} />
          </div>
          <div className="row wrap">
            <button className="btn primary" onClick={() => onDiscuss(`I tried to explain ${s.topic}. The follow-up questions were:\n${result.followUps.map((q) => `- ${q}`).join('\n')}\nCan we work through them?`)}>
              Work through the questions with the tutor
            </button>
            <GapCards s={s} gaps={result.gaps} />
            <button className="btn" onClick={() => (setResult(null), setAnswer(emptyAnswer()))}>
              Try again
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- exam question

const MARKS = [4, 5, 6, 8, 9, 10, 12, 15, 16, 20, 25, 30];

function MarkView({ m, q }: { m: ExamMark; q: ExamQuestion }) {
  return (
    <div className="tutor-result">
      <div className="tutor-score">
        <span className="tutor-score-num">{m.mark}</span>
        <span className="tutor-score-of">/ {q.marks}</span>
        {m.level && <span className="tutor-level">{m.level}</span>}
      </div>
      {m.objectives.length > 0 && (
        <table className="ao-table">
          <tbody>
            {m.objectives.map((o) => (
              <tr key={o.ao}>
                <th>{o.ao}</th>
                <td>{o.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="tutor-cols">
        <List title="What earned marks" items={m.strengths} tone="good" />
        <List title="To move up a band" items={m.improvements} tone="bad" />
      </div>
      {m.model && (
        <blockquote className="tutor-model">
          <span className="tutor-model-kicker">What the top band adds</span>
          <Md md={m.model} />
        </blockquote>
      )}
    </div>
  );
}

function Exam({ s }: { s: Setup }) {
  const [marks, setMarks] = useState(9);
  const [q, setQ] = useState<ExamQuestion | null>(null);
  const [writing, setWriting] = useState(false);
  const [answer, setAnswer] = useState<Answer>(emptyAnswer);
  const [busy, setBusy] = useState('');
  const [mark, setMark] = useState<ExamMark | null>(null);

  const set = async () => {
    try {
      setBusy('Setting a question in the board’s style…');
      setQ(await examQuestion(await s.ctx(), marks));
      setMark(null);
      setWriting(false);
      setAnswer(emptyAnswer());
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };
  const submit = async () => {
    if (!q) return;
    try {
      setBusy(answer.mode === 'hand' ? 'Reading your handwriting…' : 'Marking to the mark scheme…');
      const text = await answerText(answer);
      if (!text) return toast('Answer the question first.', 'info');
      setBusy('Marking to the mark scheme…');
      const m = await markExam(await s.ctx(), q, text);
      setMark(m);
      await saveAttempt({ tool: 'exam', subjectId: s.subjectId, topic: s.topic, prompt: q.question, answer: text, feedback: [m.level, ...m.improvements].filter(Boolean).join('\n'), score: m.mark, max: q.marks, gaps: m.gaps });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="tutor-tool">
      <header className="tutor-lede">
        <h2>Exam question</h2>
        <p>
          A question in the style of <strong>{s.board}</strong>, marked against its assessment objectives and levels — with what the top band would have added.
        </p>
        <div className="row wrap">
          <select value={marks} onChange={(e) => setMarks(Number(e.target.value))} aria-label="Marks">
            {MARKS.map((m) => (
              <option key={m} value={m}>
                {m} marks
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={!!busy} onClick={set}>
            <ISparkle size={16} /> {q ? 'Another question' : 'Set a question'}
          </button>
        </div>
      </header>
      {busy && <Busy>{busy}</Busy>}
      {q && (
        <article className="exam-paper">
          <div className="exam-meta">
            <span>
              {s.board} · {q.marks} marks
            </span>
            {writing && !mark ? <Countdown minutes={q.minutes} onDone={() => toast('Time — finish your sentence.', 'info')} /> : <span>{q.minutes} minutes</span>}
          </div>
          <Md md={q.question} />
        </article>
      )}
      {q && !mark && !busy && (
        <>
          {!writing ? (
            <button className="btn" onClick={() => setWriting(true)}>
              Start the clock and answer
            </button>
          ) : (
            <>
              <AnswerBox value={answer} onChange={setAnswer} placeholder="Your answer…" rows={14} />
              <button className="btn primary" onClick={submit}>
                Hand it in
              </button>
            </>
          )}
        </>
      )}
      {mark && q && (
        <>
          <MarkView m={mark} q={q} />
          <GapCards s={s} gaps={mark.gaps} />
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- mock paper

function grade(pct: number) {
  return pct >= 80 ? 'A*' : pct >= 70 ? 'A' : pct >= 60 ? 'B' : pct >= 50 ? 'C' : pct >= 40 ? 'D' : pct >= 30 ? 'E' : 'U';
}

function Mock({ s }: { s: Setup }) {
  const [minutes, setMinutes] = useState(45);
  const [paper, setPaper] = useState<{ title: string; questions: ExamQuestion[] } | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [marks, setMarks] = useState<(ExamMark | null)[]>([]);
  const [busy, setBusy] = useState('');
  const [started, setStarted] = useState(false);

  const make = async () => {
    try {
      setBusy('Setting the paper…');
      const p = await mockPaper(await s.ctx(), minutes);
      if (!p.questions.length) throw new Error('The paper came back empty — try again.');
      setPaper(p);
      setAnswers(p.questions.map(emptyAnswer));
      setMarks([]);
      setStarted(false);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };
  const submit = async () => {
    if (!paper) return;
    const ctx = await s.ctx();
    const out: (ExamMark | null)[] = [];
    try {
      for (let i = 0; i < paper.questions.length; i++) {
        setBusy(`Marking question ${i + 1} of ${paper.questions.length}…`);
        const text = await answerText(answers[i]);
        out.push(text ? await markExam(ctx, paper.questions[i], text) : { mark: 0, outOf: paper.questions[i].marks, level: '', objectives: [], strengths: [], improvements: ['Not answered.'], model: '', gaps: [] });
        setMarks([...out]);
      }
      const got = out.reduce((a, m) => a + (m?.mark ?? 0), 0);
      const max = paper.questions.reduce((a, q) => a + q.marks, 0);
      await saveAttempt({ tool: 'mock', subjectId: s.subjectId, topic: s.topic || paper.title, prompt: paper.questions.map((q) => q.question).join('\n\n'), answer: '', feedback: `${got}/${max}`, score: got, max, gaps: out.flatMap((m) => m?.gaps ?? []) });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy('');
    }
  };
  const got = marks.reduce((a, m) => a + (m?.mark ?? 0), 0);
  const max = paper?.questions.reduce((a, q) => a + q.marks, 0) ?? 0;
  const finished = !!paper && marks.length === paper.questions.length;

  return (
    <section className="tutor-tool">
      <header className="tutor-lede">
        <h2>Mock paper</h2>
        <p>A short timed paper in {s.board}’s style{ s.topic ? ` on ${s.topic}` : '' }, marked question by question with a rough grade.</p>
        <div className="row wrap">
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Length">
            {[20, 30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={!!busy} onClick={make}>
            <ISparkle size={16} /> {paper ? 'A new paper' : 'Set a paper'}
          </button>
        </div>
      </header>
      {paper && (
        <article className="exam-paper">
          <div className="exam-meta">
            <span>{paper.title}</span>
            {started && !finished ? <Countdown minutes={minutes} onDone={() => toast('Time is up — pens down.', 'info')} /> : <span>{minutes} minutes · {max} marks</span>}
          </div>
          {!started && !finished && (
            <button className="btn primary" onClick={() => setStarted(true)}>
              Turn over and start
            </button>
          )}
          {(started || finished) &&
            paper.questions.map((q, i) => (
              <div key={i} className="mock-q">
                <div className="mock-q-head">
                  <span className="mock-q-num">{i + 1}</span>
                  <span className="mock-q-marks">[{q.marks} marks]</span>
                </div>
                <Md md={q.question} />
                {!marks[i] ? (
                  <AnswerBox value={answers[i]} onChange={(a) => setAnswers((all) => all.map((x, j) => (j === i ? a : x)))} placeholder="Your answer…" rows={Math.min(16, 3 + q.marks)} />
                ) : (
                  <MarkView m={marks[i]!} q={q} />
                )}
              </div>
            ))}
        </article>
      )}
      {busy && <Busy>{busy}</Busy>}
      {paper && started && !finished && !busy && (
        <button className="btn primary" onClick={submit}>
          Hand in the paper
        </button>
      )}
      {finished && (
        <div className="tutor-score big">
          <span className="tutor-score-num">{got}</span>
          <span className="tutor-score-of">/ {max}</span>
          <span className="tutor-level">
            {Math.round((got / Math.max(1, max)) * 100)}% · about a {grade((got / Math.max(1, max)) * 100)} (a rough guide, not real boundaries)
          </span>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Socratic

interface Turn {
  role: 'user' | 'model';
  text: string;
}

function Socratic({ s, seed }: { s: Setup; seed: string | null }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState(seed ?? '');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ summary: string; gaps: string[] } | null>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [turns]);

  const send = async (text: string) => {
    const next: Turn[] = [...turns, { role: 'user', text }];
    setTurns([...next, { role: 'model', text: '' }]);
    setDraft('');
    setBusy(true);
    try {
      ctxRef.current ??= await s.ctx();
      const contents: Content[] = next.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
      let out = '';
      for await (const d of stream({ system: socraticSystem(ctxRef.current), contents, temperature: 0.5 })) {
        out += d;
        setTurns([...next, { role: 'model', text: out }]);
      }
    } catch (e) {
      toastError(e);
      setTurns(next);
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    try {
      setBusy(true);
      const transcript = turns.map((t) => `${t.role === 'user' ? 'Student' : 'Tutor'}: ${t.text}`).join('\n\n');
      const r = await socraticSummary(ctxRef.current ?? (await s.ctx()), transcript);
      setSummary(r);
      await saveAttempt({ tool: 'socratic', subjectId: s.subjectId, topic: s.topic, answer: transcript, feedback: r.summary, gaps: r.gaps });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tutor-tool socratic">
      <header className="tutor-lede">
        <h2>Socratic tutor</h2>
        <p>It won’t give you the answer. It asks the next question until you can say it yourself.</p>
      </header>
      <div className="chat-log">
        {turns.length === 0 && (
          <div className="row wrap">
            {[`I don't understand ${s.topic || 'this topic'} — where do I start?`, `Test me on ${s.topic || s.subject}.`, `How would I apply ${s.topic || 'this'} in an exam answer?`].map((p) => (
              <button key={p} className="chip" onClick={() => send(p)}>
                {p}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`chat-turn ${t.role}`}>
            {t.role === 'model' ? t.text ? <Md md={t.text} /> : <Spinner size={14} /> : <p>{t.text}</p>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {summary ? (
        <div className="tutor-result">
          <Md md={summary.summary} />
          <List title="Still shaky" items={summary.gaps} tone="bad" />
          <GapCards s={s} gaps={summary.gaps} />
        </div>
      ) : (
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim() && !busy) send(draft.trim());
          }}
        >
          <textarea className="input" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Your answer, or a question…" onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), draft.trim() && !busy && send(draft.trim()))} />
          <button className="btn primary" disabled={!draft.trim() || busy} aria-label="Send">
            <ISend size={16} />
          </button>
          {turns.length >= 4 && (
            <button type="button" className="btn" disabled={busy} onClick={end}>
              End &amp; sum up
            </button>
          )}
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- weak spots

function Weak({ onPick }: { onPick: (topic: string, subjectId: string, tab: Tab) => void }) {
  const { revisionSubjects } = useSettings();
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  const attempts = useLiveQuery(() => db.tutor.orderBy('createdAt').reverse().limit(30).toArray(), []) ?? [];
  const spots = useLiveQuery(async () => {
    const folders = await db.folders.toArray();
    const decks = new Map((await db.decks.toArray()).map((d) => [d.id, d.folderId]));
    return weakSpots((deckId) => folderSubject(folders, decks.get(deckId)));
  }, []);
  const [open, setOpen] = useState<Record<string, string | 'loading'>>({});
  if (!spots) return <Busy>Looking for weak spots…</Busy>;
  const groups = [...new Set([...revisionSubjects, ...spots.map((x) => x.subjectId)])].filter((id) => spots.some((x) => x.subjectId === id));
  const name = (id: string) => subjects.find((x) => x.id === id)?.name ?? 'Other';

  const explain = async (w: WeakSpot) => {
    const key = `${w.subjectId}|${w.label}`;
    setOpen((o) => ({ ...o, [key]: 'loading' }));
    try {
      const md = await explainSimply(name(w.subjectId), w.label);
      setOpen((o) => ({ ...o, [key]: md }));
    } catch (e) {
      toastError(e);
      setOpen(({ [key]: _, ...o }) => o);
    }
  };

  return (
    <section className="tutor-tool">
      <header className="tutor-lede">
        <h2>Weak spots</h2>
        <p>What the tutor found missing in your answers over the last six weeks, and the flashcards you keep forgetting — heaviest first.</p>
      </header>
      {!groups.length && <p className="muted">Nothing yet. Blurt, explain or answer an exam question, and the gaps will gather here.</p>}
      <div className="weak-cols">
        {groups.map((g) => (
          <div key={g} className="weak-col" style={{ ['--ink' as string]: seriesVar(g, revisionSubjects) }}>
            <h3>
              <span className="rev-key" aria-hidden="true" /> {name(g)}
            </h3>
            <ol>
              {spots
                .filter((x) => x.subjectId === g)
                .slice(0, 12)
                .map((w) => {
                  const key = `${w.subjectId}|${w.label}`;
                  return (
                    <li key={key}>
                      <span className="weak-label">{w.label}</span>
                      <span className="weak-meta">
                        {w.from === 'cards' ? `forgotten ${w.weight}×` : w.weight > 1 ? `missed ${w.weight}×` : 'missed once'}
                      </span>
                      <span className="weak-actions">
                        <button className="link-btn" onClick={() => explain(w)}>
                          Explain
                        </button>
                        <button className="link-btn" onClick={() => onPick(w.label, w.subjectId, 'blurt')}>
                          Blurt it
                        </button>
                        <button className="link-btn" onClick={() => onPick(w.label, w.subjectId, 'exam')}>
                          Exam question
                        </button>
                      </span>
                      {open[key] === 'loading' ? <Busy>Explaining…</Busy> : open[key] ? <Md md={open[key]} /> : null}
                    </li>
                  );
                })}
            </ol>
          </div>
        ))}
      </div>
      {attempts.length > 0 && (
        <div className="tutor-history">
          <h3 className="rev-section">Recent work</h3>
          <ul>
            {attempts.map((a) => (
              <li key={a.id}>
                <span className="tutor-history-tool">{TOOL_LABEL[a.tool as TutorTool]}</span>
                <span className="tutor-history-topic">{a.topic || name(a.subjectId ?? '')}</span>
                <span className="tutor-history-score">{a.max ? `${a.score}/${a.max}` : ''}</span>
                <span className="muted">{new Date(a.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- plan

function Plan() {
  const settings = useSettings();
  const [which, setWhich] = useState<'this' | 'next'>('this');
  const [plan, setPlan] = useState<PlanBlock[] | null>(null);
  const [owed, setOwed] = useState(0);
  const [saving, setSaving] = useState(false);
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  const data = useLiveQuery(async () => {
    const today = dayKey();
    const monday = weekStart(today);
    const sessions = await db.studyTime.where('day').aboveOrEqual(monday).toArray();
    const lessons = await db.lessons.toArray();
    const cal = await getTermCalendar();
    const folders = await db.folders.toArray();
    const decks = new Map((await db.decks.toArray()).map((d) => [d.id, d.folderId]));
    const weak = await weakSpots((deckId) => folderSubject(folders, decks.get(deckId)));
    return { today, monday, sessions, lessons, cal, weak };
  }, []);

  const build = useMemo(
    () => () => {
      if (!data) return;
      const target = settings.weeklyTargetHours * 60;
      const byDay = minutesByDay(data.sessions);
      const nextMonday = addDays(data.monday, 7);
      const now = new Date();
      // Today only from the next quarter hour on.
      const nowMin = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
      const days = which === 'this' ? weekDays(data.monday).filter((d) => d >= data.today) : weekDays(nextMonday);
      const remaining = new Map(settings.revisionSubjects.map((id) => [id, which === 'this' ? Math.max(0, target - weekMinutes(byDay.get(id), data.monday)) : target]));
      const slots = new Map(days.map((d) => [d, freeSlots(d, data.lessons, data.cal, d === data.today ? nowMin : 0)]));
      const topics = new Map(settings.revisionSubjects.map((id) => [id, data.weak.filter((w) => w.subjectId === id).slice(0, 6).map((w) => w.label)]));
      setOwed([...remaining.values()].reduce((a, b) => a + b, 0));
      setPlan(planWeek({ days, remaining, slots, topics }));
    },
    [data, which, settings.weeklyTargetHours, settings.revisionSubjects],
  );
  useEffect(build, [build]);

  const name = (id: string) => subjects.find((x) => x.id === id)?.name ?? id;
  const days = plan ? [...new Set(plan.map((b) => b.day))] : [];
  const total = (id: string) => plan?.filter((b) => b.subjectId === id).reduce((a, b) => a + b.minutes, 0) ?? 0;

  return (
    <section className="tutor-tool">
      <header className="tutor-lede">
        <h2>The week’s revision</h2>
        <p>Each subject’s {settings.weeklyTargetHours} hours, in blocks fitted around your lessons and spread across the days, with your weakest topics first.</p>
        <Segmented
          value={which}
          onChange={setWhich}
          options={[
            { value: 'this', label: 'Rest of this week' },
            { value: 'next', label: 'Next week' },
          ]}
        />
      </header>
      {!plan ? (
        <Busy>Planning…</Busy>
      ) : !plan.length ? (
        <p className="muted">{owed ? `No free time left this week for the ${fmtMinutes(owed)} still to do — plan next week instead.` : 'Nothing left to plan — every subject is on target this week.'}</p>
      ) : (
        <>
          <p className="plan-totals">
            {settings.revisionSubjects.map((id) => (
              <span key={id} style={{ ['--ink' as string]: seriesVar(id, settings.revisionSubjects) }}>
                <span className="rev-key" aria-hidden="true" /> {name(id)} {fmtMinutes(total(id))}
              </span>
            ))}
          </p>
          <div className="plan-days">
            {days.map((d) => (
              <div key={d} className="plan-day">
                <h3>{new Date(`${d}T12:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</h3>
                <ul>
                  {plan
                    .filter((b) => b.day === d)
                    .map((b, i) => (
                      <li key={i} style={{ ['--ink' as string]: seriesVar(b.subjectId, settings.revisionSubjects) }}>
                        <span className="plan-time">{b.start}</span>
                        <span className="rev-key" aria-hidden="true" />
                        <span className="plan-what">
                          <strong>{name(b.subjectId)}</strong>
                          {b.topic ? ` — ${b.topic}` : ''}
                        </span>
                        <span className="plan-min">{fmtMinutes(b.minutes)}</span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
          <button
            className="btn primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                for (const b of plan) await addReminder({ title: `Revise ${name(b.subjectId)}${b.topic ? `: ${b.topic}` : ''} (${fmtMinutes(b.minutes)})`, due: b.day, time: b.start, subjectId: b.subjectId, type: 'revision' });
                toast(`${plan.length} revision blocks added to Reminders`, 'success');
                nav({ view: 'reminders', pane: 'list' });
              } catch (e) {
                toastError(e);
              } finally {
                setSaving(false);
              }
            }}
          >
            Add {plan.length} blocks to Reminders
          </button>
        </>
      )}
    </section>
  );
}
