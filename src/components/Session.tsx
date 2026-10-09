import { useEffect, useMemo, useRef, useState } from 'react';
import { db, type Card } from '../db';
import { nav } from '../lib/nav';
import {
  buildQueue, clozeAnswers, clozeBack, clozeFront, getGame, MAX_LIVES, nextLifeIn, previewIntervals, Rating, recordReview, similarity, type GameState,
} from '../lib/study';
import { explainCard, gradeTyped } from '../lib/ai';
import { hasKey } from '../lib/gemini';
import { mdToHtml } from '../lib/markdown';
import { useSettings } from '../lib/settings';
import { toastError } from '../lib/events';
import { Spinner } from './ui';
import { IBolt, ICheck, IHeart, ISparkle, IX, IFlame } from './Icons';
import type { Grade } from 'ts-fsrs';

type Mode = 'study' | 'quiz';

/** A card as presented — quiz mode may turn basic cards into multiple choice. */
interface Item {
  card: Card;
  kind: 'reveal' | 'mcq' | 'tf' | 'typed';
  prompt: string;
  options?: string[];
  correctIdx?: number;
  expected?: string;
}

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function present(card: Card, mode: Mode, pool: Card[]): Item {
  if (card.type === 'mcq' && card.options?.length) {
    const order = shuffle(card.options.map((_, i) => i));
    return { card, kind: 'mcq', prompt: card.front, options: order.map((i) => card.options![i]), correctIdx: order.indexOf(card.answer ?? 0) };
  }
  if (card.type === 'tf') return { card, kind: 'tf', prompt: card.front, correctIdx: card.answer ? 0 : 1, options: ['True', 'False'] };
  if (card.type === 'typed') return { card, kind: 'typed', prompt: card.front, expected: card.back };
  if (mode === 'quiz') {
    if (card.type === 'cloze') return { card, kind: 'typed', prompt: clozeFront(card.front), expected: clozeAnswers(card.front).join(', ') };
    // Gizmo-style: build multiple choice from other cards' answers.
    const distractors = shuffle(Array.from(new Set(pool.filter((c) => c.id !== card.id && c.type === 'basic' && c.back && c.back !== card.back).map((c) => c.back)))).slice(0, 3);
    if (distractors.length >= 2) {
      const options = shuffle([card.back, ...distractors]);
      return { card, kind: 'mcq', prompt: card.front, options, correctIdx: options.indexOf(card.back) };
    }
    return { card, kind: 'typed', prompt: card.front, expected: card.back };
  }
  return { card, kind: 'reveal', prompt: card.type === 'cloze' ? clozeFront(card.front) : card.front };
}

export function Session({ deckIds, mode }: { deckIds: string[]; mode: Mode }) {
  const { newPerDay } = useSettings();
  const [queue, setQueue] = useState<Item[] | null>(null);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [verdict, setVerdict] = useState<null | { correct: boolean; feedback?: string; pending?: boolean; self?: boolean }>(null);
  const [explain, setExplain] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [game, setGame] = useState<GameState | null>(null);
  const [combo, setCombo] = useState(0);
  const [stats, setStats] = useState({ done: 0, correct: 0, xp: 0 });
  const [floatXp, setFloatXp] = useState<{ n: number; k: number } | null>(null);
  const startedAt = useRef(Date.now());
  const pool = useRef<Card[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      getGame().then(setGame);
      let cards: Card[];
      if (mode === 'study') cards = await buildQueue(deckIds, newPerDay);
      else cards = shuffle((await db.cards.where('deckId').anyOf(deckIds).toArray()).filter((c) => !c.suspended)).slice(0, 20);
      pool.current = await db.cards.where('deckId').anyOf(deckIds).toArray();
      setQueue(cards.map((c) => present(c, mode, pool.current)));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const item = queue?.[pos];
  const intervals = useMemo(() => (item && mode === 'study' ? previewIntervals(item.card.sched) : null), [item, mode]);

  useEffect(() => {
    if (item?.kind === 'typed') setTimeout(() => inputRef.current?.focus(), 50);
  }, [item]);

  const advance = () => {
    setPos((p) => p + 1);
    setRevealed(false);
    setPicked(null);
    setTyped('');
    setVerdict(null);
    setExplain(null);
  };

  const commit = async (rating: Grade, correct: boolean) => {
    if (!item) return;
    try {
      const nextCombo = correct ? combo + 1 : 0;
      const res = await recordReview(item.card, rating, correct, nextCombo, mode);
      setCombo(nextCombo);
      setGame(res.game);
      setStats((s) => ({ done: s.done + 1, correct: s.correct + (correct ? 1 : 0), xp: s.xp + res.xp }));
      if (res.xp) setFloatXp({ n: res.xp, k: Date.now() });
      // Lapsed cards come back later in the same session.
      if (mode === 'study' && rating === Rating.Again) {
        setQueue((q) => (q ? [...q, present(res.card, mode, pool.current)] : q));
      }
    } catch (e) {
      toastError(e);
    }
    advance();
  };

  const checkTyped = async () => {
    if (!item || verdict) return;
    const expected = item.expected ?? '';
    const sim = Math.max(...expected.split(/\s*[,;/]\s*|\s+or\s+/).concat(expected).map((e) => similarity(typed, e)));
    if (sim >= 0.85) return setVerdict({ correct: true });
    if (!typed.trim()) return setVerdict({ correct: false });
    if (!hasKey()) return setVerdict({ correct: false, self: true });
    setVerdict({ correct: false, pending: true });
    try {
      const r = await gradeTyped(item.prompt, expected, typed);
      setVerdict({ correct: r.correct, feedback: r.feedback });
    } catch {
      setVerdict({ correct: false, self: true });
    }
  };

  const doExplain = async () => {
    if (!item) return;
    setExplaining(true);
    try {
      const answer = item.kind === 'mcq' || item.kind === 'tf' ? item.options![item.correctIdx!] : item.expected ?? (item.card.type === 'cloze' ? clozeAnswers(item.card.front).join(', ') : item.card.back);
      const given = item.kind === 'typed' ? typed : picked !== null && item.options ? item.options[picked] : undefined;
      setExplain(await explainCard(item.prompt, answer, given));
    } catch (e) {
      toastError(e);
    } finally {
      setExplaining(false);
    }
  };

  // Keyboard shortcuts: space/enter reveal, 1–4 rate, 1–4 pick options.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!item || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (item.kind === 'reveal') {
        if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault();
          setRevealed(true);
        } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) commit(Number(e.key) as Grade, e.key !== '1');
      } else if ((item.kind === 'mcq' || item.kind === 'tf') && picked === null && ['1', '2', '3', '4'].includes(e.key)) {
        const i = Number(e.key) - 1;
        if (item.options && i < item.options.length) setPicked(i);
      } else if (verdict || picked !== null) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          continueAfter();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const exit = () => nav({ session: null });

  if (!queue) {
    return (
      <div className="session center">
        <Spinner size={24} />
      </div>
    );
  }

  if (!item) {
    const acc = stats.done ? Math.round((stats.correct / stats.done) * 100) : 0;
    const mins = Math.max(1, Math.round((Date.now() - startedAt.current) / 60000));
    return (
      <div className="session done">
        <div className="done-card">
          <div className="done-emoji">{stats.done === 0 ? '🌿' : acc >= 90 ? '🏆' : acc >= 70 ? '🎉' : '💪'}</div>
          <h2>{stats.done === 0 ? 'All caught up!' : mode === 'quiz' ? `You scored ${acc}%` : 'Session complete'}</h2>
          {stats.done > 0 ? (
            <div className="done-stats">
              <div>
                <strong>{stats.done}</strong>
                <span>cards</span>
              </div>
              <div>
                <strong>{acc}%</strong>
                <span>accuracy</span>
              </div>
              <div>
                <strong>+{stats.xp}</strong>
                <span>XP</span>
              </div>
              <div>
                <strong>{mins}m</strong>
                <span>time</span>
              </div>
            </div>
          ) : (
            <p className="muted">No cards are due right now. Come back later — or take a practice quiz.</p>
          )}
          <div className="done-actions">
            <button className="btn big primary" onClick={exit}>
              Done
            </button>
            {mode === 'study' && stats.done === 0 && (
              <button className="btn big" onClick={() => nav({ session: { deckIds, mode: 'quiz' } })}>
                Practice quiz
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const answered = item.kind === 'reveal' ? revealed : item.kind === 'typed' ? !!verdict && !verdict.pending : picked !== null;
  const isCorrect = item.kind === 'typed' ? !!verdict?.correct : picked !== null && picked === item.correctIdx;

  function continueAfter() {
    if (!item) return;
    if (item.kind === 'typed' && verdict?.self) return;
    commit(isCorrect ? Rating.Good : Rating.Again, isCorrect);
  }

  const outOfLives = game && game.lives <= 0;

  return (
    <div className="session">
      <div className="session-top">
        <button className="icon-btn" onClick={exit} aria-label="End session">
          <IX />
        </button>
        <div className="progress">
          <span style={{ width: `${(pos / queue.length) * 100}%` }} />
        </div>
        {combo >= 3 && (
          <span className="combo">
            <IFlame size={14} /> {combo}
          </span>
        )}
        <span className="hearts small" title={outOfLives ? `Out of lives — next in ${Math.ceil(nextLifeIn(game!) / 60000)}m (no XP until then)` : 'Lives'}>
          <IHeart size={16} className={game?.lives ? 'full' : 'empty'} /> {game?.lives ?? MAX_LIVES}
        </span>
        <span className="xp-pill">
          <IBolt size={14} /> {stats.xp}
          {floatXp && (
            <span key={floatXp.k} className="xp-float">
              +{floatXp.n}
            </span>
          )}
        </span>
      </div>
      {outOfLives && <div className="lives-banner">Out of lives 💔 — keep practising; XP resumes when a life refills ({Math.ceil(nextLifeIn(game!) / 60000)}m).</div>}

      <div className="flash-wrap">
        <div className={`flash ${answered ? (item.kind === 'reveal' ? 'flipped' : isCorrect ? 'right' : 'wrong') : ''}`}>
          <div className="flash-type">{item.kind === 'reveal' ? (item.card.type === 'cloze' ? 'Fill in the blank' : 'Recall') : item.kind === 'mcq' ? 'Multiple choice' : item.kind === 'tf' ? 'True or false?' : 'Type the answer'}</div>
          <div className="flash-prompt">{item.prompt}</div>
          {item.kind === 'reveal' && revealed && (
            <div className="flash-answer">
              {item.card.type === 'cloze' ? (
                <div
                  className="cloze-reveal"
                  dangerouslySetInnerHTML={{ __html: clozeBack(item.card.front).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!).replace(/⟦([\s\S]*?)⟧/g, '<mark>$1</mark>') }}
                />
              ) : null}
              {item.card.back && <div className="back">{item.card.back}</div>}
              {item.card.explanation && <div className="explanation">{item.card.explanation}</div>}
            </div>
          )}
          {(item.kind === 'mcq' || item.kind === 'tf') && (
            <div className={`options ${item.kind}`}>
              {item.options!.map((o, i) => (
                <button
                  key={i}
                  disabled={picked !== null}
                  className={`option ${picked !== null && i === item.correctIdx ? 'correct' : ''} ${picked === i && i !== item.correctIdx ? 'incorrect' : ''}`}
                  onClick={() => setPicked(i)}
                >
                  <span className="opt-key">{i + 1}</span> {o}
                </button>
              ))}
            </div>
          )}
          {item.kind === 'typed' && (
            <form
              className="typed"
              onSubmit={(e) => {
                e.preventDefault();
                if (verdict && !verdict.pending && !verdict.self) continueAfter();
                else checkTyped();
              }}
            >
              <input ref={inputRef} className="input" value={typed} disabled={!!verdict} onChange={(e) => setTyped(e.target.value)} placeholder="Your answer" autoComplete="off" autoCapitalize="off" />
              {!verdict && (
                <button className="btn primary" type="submit">
                  Check
                </button>
              )}
            </form>
          )}
          {item.kind === 'typed' && verdict && (
            <div className={`verdict ${verdict.pending ? '' : verdict.correct ? 'right' : 'wrong'}`}>
              {verdict.pending ? (
                <>
                  <Spinner size={14} /> Checking your answer…
                </>
              ) : (
                <>
                  {verdict.correct ? <ICheck size={18} /> : <IX size={18} />} {verdict.correct ? 'Correct!' : 'Not quite.'} {verdict.feedback}
                  {!verdict.correct && (
                    <div className="expected">
                      Answer: <strong>{item.expected}</strong>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {(item.kind === 'mcq' || item.kind === 'tf') && picked !== null && item.card.explanation && <div className="explanation">{item.card.explanation}</div>}
          {explain && <div className="tutor prose md" dangerouslySetInnerHTML={{ __html: mdToHtml(explain) }} />}
        </div>
      </div>

      <div className="session-actions">
        {item.kind === 'reveal' && !revealed && (
          <button className="btn big primary wide" onClick={() => setRevealed(true)}>
            Show answer
          </button>
        )}
        {item.kind === 'reveal' && revealed && mode === 'study' && intervals && (
          <div className="ratings">
            {(
              [
                [Rating.Again, 'Again', 'again'],
                [Rating.Hard, 'Hard', 'hard'],
                [Rating.Good, 'Good', 'good'],
                [Rating.Easy, 'Easy', 'easy'],
              ] as const
            ).map(([r, label, cls]) => (
              <button key={r} className={`rate ${cls}`} onClick={() => commit(r as Grade, r !== Rating.Again)}>
                <span>{label}</span>
                <small>{intervals[r]}</small>
              </button>
            ))}
          </div>
        )}
        {item.kind === 'reveal' && revealed && mode === 'quiz' && (
          <div className="ratings two">
            <button className="rate again" onClick={() => commit(Rating.Again, false)}>
              I missed it
            </button>
            <button className="rate good" onClick={() => commit(Rating.Good, true)}>
              I got it
            </button>
          </div>
        )}
        {item.kind === 'typed' && verdict?.self && (
          <div className="ratings two">
            <button className="rate again" onClick={() => commit(Rating.Again, false)}>
              I was wrong
            </button>
            <button className="rate good" onClick={() => commit(Rating.Good, true)}>
              I was right
            </button>
          </div>
        )}
        {answered && item.kind !== 'reveal' && !(item.kind === 'typed' && verdict?.self) && (
          <div className="after">
            {!isCorrect && hasKey() && !explain && (
              <button className="btn" onClick={doExplain} disabled={explaining}>
                {explaining ? <Spinner size={14} /> : <ISparkle size={16} />} Explain it to me
              </button>
            )}
            <button className={`btn big wide ${isCorrect ? 'success' : 'primary'}`} onClick={continueAfter}>
              Continue
            </button>
          </div>
        )}
        {item.kind === 'reveal' && revealed && hasKey() && !explain && (
          <button className="link-btn" onClick={doExplain} disabled={explaining}>
            {explaining ? <Spinner size={12} /> : <ISparkle size={14} />} Explain this card
          </button>
        )}
      </div>
    </div>
  );
}
