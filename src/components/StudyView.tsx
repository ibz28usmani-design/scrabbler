import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, deleteDeck, uid, type Card, type CardType, type Deck } from '../db';
import { nav, toggleSidebar, openModal, useNav } from '../lib/nav';
import { computeStreak, deckCounts, getGame, levelFor, makeCard, MAX_LIVES, newSched, nextLifeIn, clozeFront, State } from '../lib/study';
import { useSettings } from '../lib/settings';
import { dayKey, prevDay } from '../lib/dates';
import { confirmDialog, Empty, Menu, Modal, promptDialog, useMenu } from './ui';
import { ICards, IChevL, IFlame, IHeart, IBolt, IPlus, IMore, ISparkle, IUpload, ITrash, ISidebar } from './Icons';
import { Session } from './Session';
import { toast } from '../lib/events';

const TYPE_LABEL: Record<CardType, string> = { basic: 'Flashcard', cloze: 'Cloze', mcq: 'Multiple choice', tf: 'True / False', typed: 'Type answer' };

export function StudyView({ narrow, showSidebarToggle }: { narrow: boolean; showSidebarToggle: boolean }) {
  const { deckId, session } = useNav();
  if (session) return <Session deckIds={session.deckIds} mode={session.mode} />;
  if (deckId) return <DeckDetail deckId={deckId} />;
  return <StudyHome narrow={narrow} showSidebarToggle={showSidebarToggle} />;
}

function useGame() {
  const reviewsToday = useLiveQuery(() => db.reviews.where('day').equals(dayKey()).count(), []);
  const [game, setGame] = useState<Awaited<ReturnType<typeof getGame>> | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    getGame().then(setGame);
  }, [reviewsToday]);
  useEffect(() => {
    const t = setInterval(() => {
      tick((n) => n + 1);
      getGame().then(setGame);
    }, 30000);
    return () => clearInterval(t);
  }, []);
  return game;
}

export function StatsBar() {
  const { dailyGoal } = useSettings();
  const game = useGame();
  const streak = useLiveQuery(() => computeStreak(dailyGoal), [dailyGoal]);
  const lvl = levelFor(game?.xp ?? 0);
  const today = streak?.todayCount ?? 0;
  const pct = Math.min(1, today / dailyGoal);
  const lifeMs = game ? nextLifeIn(game) : 0;
  return (
    <div className="stats">
      <div className={`stat streak ${streak?.todayMet ? 'lit' : ''}`}>
        <IFlame size={26} />
        <div>
          <div className="stat-num">{streak?.days ?? 0}</div>
          <div className="stat-label">day streak{game?.bestStreak ? ` · best ${game.bestStreak}` : ''}</div>
        </div>
      </div>
      <div className="stat goal">
        <svg viewBox="0 0 36 36" className="ring">
          <circle cx="18" cy="18" r="15.5" className="ring-bg" />
          <circle cx="18" cy="18" r="15.5" className="ring-fg" strokeDasharray={`${pct * 97.4} 97.4`} />
        </svg>
        <div>
          <div className="stat-num">
            {today}/{dailyGoal}
          </div>
          <div className="stat-label">{streak?.todayMet ? 'goal met today 🎉' : 'daily goal'}</div>
        </div>
      </div>
      <div className="stat xp">
        <IBolt size={24} />
        <div className="xp-col">
          <div className="stat-num">Lv {lvl.level}</div>
          <div className="xp-bar">
            <span style={{ width: `${(lvl.into / lvl.span) * 100}%` }} />
          </div>
          <div className="stat-label">
            {game?.xp ?? 0} XP · {lvl.span - lvl.into} to next
          </div>
        </div>
      </div>
      <div className="stat lives">
        <div className="hearts">
          {Array.from({ length: MAX_LIVES }).map((_, i) => (
            <IHeart key={i} size={19} className={i < (game?.lives ?? MAX_LIVES) ? 'full' : 'empty'} />
          ))}
        </div>
        <div className="stat-label">{lifeMs > 0 ? `next life in ${Math.ceil(lifeMs / 60000)}m` : 'lives full'}</div>
      </div>
    </div>
  );
}

function Activity() {
  const { dailyGoal } = useSettings();
  const data = useLiveQuery(async () => {
    const days: string[] = [];
    let d = dayKey();
    for (let i = 0; i < 84; i++) {
      days.unshift(d);
      d = prevDay(d);
    }
    const rows = await db.reviews.where('day').anyOf(days).toArray();
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.day, (map.get(r.day) ?? 0) + 1);
    return days.map((day) => ({ day, n: map.get(day) ?? 0 }));
  }, []);
  if (!data) return null;
  return (
    <div className="activity" aria-label="Review activity, last 12 weeks">
      {data.map((d) => (
        <span key={d.day} title={`${d.day}: ${d.n} reviews`} className={`cell l${d.n === 0 ? 0 : d.n < dailyGoal / 2 ? 1 : d.n < dailyGoal ? 2 : d.n < dailyGoal * 2 ? 3 : 4}`} />
      ))}
    </div>
  );
}

function StudyHome({ narrow, showSidebarToggle }: { narrow: boolean; showSidebarToggle: boolean }) {
  const decks = useLiveQuery(() => db.decks.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const cards = useLiveQuery(() => db.cards.toArray(), []) ?? [];
  const [anchor, open, close] = useMenu();
  const byDeck = new Map<string, Card[]>();
  for (const c of cards) byDeck.set(c.deckId, [...(byDeck.get(c.deckId) ?? []), c]);
  const all = deckCounts(cards);

  const newDeck = async () => {
    const name = await promptDialog('New Deck', '', 'Deck name');
    if (!name) return;
    const id = uid();
    await db.decks.add({ id, name, createdAt: Date.now(), emoji: '🗂️' });
    nav({ deckId: id });
  };

  return (
    <div className="study">
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
        <h1>Flashcards & Quizzes</h1>
        <span className="spacer" />
        <button className="btn primary" onClick={(e) => open(e.currentTarget)}>
          <IPlus size={17} /> New
        </button>
      </div>
      <div className="study-scroll">
        <StatsBar />
        <Activity />
        <div className="study-cta">
          <button className="btn big primary" disabled={!all.due && !all.fresh} onClick={() => nav({ session: { deckIds: decks.map((d) => d.id), mode: 'study' } })}>
            Study all · {all.due} due{all.fresh ? ` · ${all.fresh} new` : ''}
          </button>
        </div>
        {decks.length === 0 ? (
          <Empty icon={<ICards size={32} />} title="No decks yet">
            Generate flashcards from any note or notebook with AI, or import your Anki and Quizlet decks.
            <div className="empty-actions">
              <button className="btn primary" onClick={() => openModal({ type: 'generateDeck', from: { kind: 'text' } })}>
                <ISparkle size={16} /> Generate with AI
              </button>
              <button className="btn" onClick={() => openModal({ type: 'importDeck' })}>
                <IUpload size={16} /> Import Anki / Quizlet
              </button>
            </div>
          </Empty>
        ) : (
          <div className="deck-grid">
            {decks.map((d) => {
              const c = deckCounts(byDeck.get(d.id) ?? []);
              return (
                <div key={d.id} className="deck">
                  <button className="deck-main" onClick={() => nav({ deckId: d.id })}>
                    <span className="deck-emoji">{d.emoji}</span>
                    <span className="deck-name">{d.name}</span>
                    <span className="deck-counts">
                      <span className="due">{c.due} due</span> · <span className="new">{c.fresh} new</span> · {c.total} cards
                    </span>
                  </button>
                  <div className="deck-actions">
                    <button className="btn small primary" disabled={!c.due && !c.fresh} onClick={() => nav({ session: { deckIds: [d.id], mode: 'study' } })}>
                      Study
                    </button>
                    <button className="btn small" disabled={!c.total} onClick={() => nav({ session: { deckIds: [d.id], mode: 'quiz' } })}>
                      Quiz
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {anchor && (
        <Menu
          anchor={anchor}
          align="right"
          onClose={close}
          items={[
            { label: 'Generate with AI…', icon: <ISparkle size={17} />, onClick: () => openModal({ type: 'generateDeck', from: { kind: 'text' } }) },
            { label: 'Import Anki / Quizlet / CSV…', icon: <IUpload size={17} />, onClick: () => openModal({ type: 'importDeck' }) },
            { label: 'Empty deck', icon: <IPlus size={17} />, onClick: newDeck },
          ]}
        />
      )}
    </div>
  );
}

function DeckDetail({ deckId }: { deckId: string }) {
  const deck = useLiveQuery(() => db.decks.get(deckId), [deckId]);
  const cards = useLiveQuery(() => db.cards.where('deckId').equals(deckId).sortBy('createdAt'), [deckId]) ?? [];
  const [edit, setEdit] = useState<Card | 'new' | null>(null);
  const [anchor, open, close] = useMenu();
  const counts = deckCounts(cards);
  if (!deck) return null;
  return (
    <div className="study">
      <div className="study-head">
        <button className="icon-btn accent" onClick={() => nav({ deckId: null })}>
          <IChevL /> <span className="back-label">Decks</span>
        </button>
        <span className="spacer" />
        <button className="icon-btn" onClick={(e) => open(e.currentTarget)} aria-label="Deck options">
          <IMore />
        </button>
      </div>
      <div className="study-scroll">
        <div className="deck-hero">
          <span className="deck-emoji big">{deck.emoji}</span>
          <h1>{deck.name}</h1>
          <div className="deck-counts">
            <span className="due">{counts.due} due</span> · <span className="new">{counts.fresh} new</span> · {counts.total} cards
          </div>
          <div className="deck-hero-actions">
            <button className="btn big primary" disabled={!counts.due && !counts.fresh} onClick={() => nav({ session: { deckIds: [deckId], mode: 'study' } })}>
              Study now
            </button>
            <button className="btn big" disabled={!counts.total} onClick={() => nav({ session: { deckIds: [deckId], mode: 'quiz' } })}>
              Practice quiz
            </button>
          </div>
        </div>
        <div className="card-list-head">
          <h3>Cards</h3>
          <span className="spacer" />
          <button className="btn small" onClick={() => setEdit('new')}>
            <IPlus size={15} /> Add card
          </button>
        </div>
        <ul className="card-list">
          {cards.map((c) => (
            <li key={c.id} className={`card-row ${c.suspended ? 'suspended' : ''}`} onClick={() => setEdit(c)}>
              <span className={`type-badge ${c.type}`}>{TYPE_LABEL[c.type]}</span>
              <span className="card-front">{c.type === 'cloze' ? clozeFront(c.front) : c.front}</span>
              <span className="card-back">{c.type === 'mcq' ? c.options?.[c.answer ?? 0] : c.type === 'tf' ? (c.answer ? 'True' : 'False') : c.back}</span>
              <span className="card-due">{c.suspended ? 'suspended' : c.sched.state === State.New ? 'new' : new Date(c.sched.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </li>
          ))}
        </ul>
      </div>
      {edit && <CardEditor deckId={deckId} card={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {anchor && (
        <Menu
          anchor={anchor}
          align="right"
          onClose={close}
          items={[
            {
              label: 'Rename…',
              onClick: async () => {
                const name = await promptDialog('Rename deck', deck.name);
                if (name) db.decks.update(deckId, { name });
              },
            },
            {
              label: 'Change icon…',
              onClick: async () => {
                const e = await promptDialog('Deck icon (emoji)', deck.emoji);
                if (e) db.decks.update(deckId, { emoji: [...e][0] });
              },
            },
            { label: 'Generate more cards with AI…', onClick: () => openModal({ type: 'generateDeck', from: deck.noteId ? { kind: 'note', noteId: deck.noteId } : deck.folderId ? { kind: 'folder', folderId: deck.folderId } : { kind: 'text' } }) },
            {
              label: 'Reset progress',
              onClick: async () => {
                if (!(await confirmDialog('Reset scheduling for every card in this deck?', 'Reset'))) return;
                await db.cards.where('deckId').equals(deckId).modify((c: Card) => {
                  c.sched = newSched();
                });
                toast('Deck progress reset', 'success');
              },
            },
            { divider: true, label: '' },
            {
              label: 'Delete deck',
              danger: true,
              icon: <ITrash size={17} />,
              onClick: async () => {
                if (!(await confirmDialog(`Delete “${deck.name}” and its ${cards.length} cards?`))) return;
                await deleteDeck(deckId);
                nav({ deckId: null });
              },
            },
          ]}
        />
      )}
    </div>
  );
}

function CardEditor({ deckId, card, onClose }: { deckId: string; card: Card | null; onClose: () => void }) {
  const [type, setType] = useState<CardType>(card?.type ?? 'basic');
  const [front, setFront] = useState(card?.front ?? '');
  const [back, setBack] = useState(card?.back ?? '');
  const [options, setOptions] = useState<string[]>(card?.options ?? ['', '', '', '']);
  const [answer, setAnswer] = useState<number>(card?.answer ?? (type === 'tf' ? 1 : 0));
  const [explanation, setExplanation] = useState(card?.explanation ?? '');

  const save = async () => {
    if (!front.trim()) return toast('The front can’t be empty.', 'error');
    if (type === 'cloze' && !/\{\{c\d+::/.test(front)) return toast('Wrap the hidden part like {{c1::answer}}.', 'error');
    const patch: Partial<Card> = {
      type,
      front: front.trim(),
      back: type === 'mcq' ? options[answer] ?? '' : type === 'tf' ? (answer ? 'True' : 'False') : back.trim(),
      options: type === 'mcq' ? options.map((o) => o.trim()).filter(Boolean) : undefined,
      answer: type === 'mcq' || type === 'tf' ? answer : undefined,
      explanation: explanation.trim() || undefined,
    };
    if (card) await db.cards.update(card.id, patch);
    else await db.cards.add(makeCard(deckId, patch as Card));
    onClose();
  };

  return (
    <Modal
      title={card ? 'Edit card' : 'New card'}
      onClose={onClose}
      footer={
        <>
          {card && (
            <>
              <button
                className="btn danger"
                onClick={async () => {
                  await db.cards.delete(card.id);
                  onClose();
                }}
              >
                Delete
              </button>
              <button className="btn" onClick={() => db.cards.update(card.id, { suspended: !card.suspended }).then(onClose)}>
                {card.suspended ? 'Unsuspend' : 'Suspend'}
              </button>
            </>
          )}
          <span className="spacer" />
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <label className="field">
        <span>Type</span>
        <select className="input" value={type} onChange={(e) => setType(e.target.value as CardType)}>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{type === 'cloze' ? 'Text — wrap hidden parts like {{c1::answer}}' : type === 'tf' ? 'Statement' : 'Front / question'}</span>
        <textarea className="input" rows={3} value={front} onChange={(e) => setFront(e.target.value)} />
      </label>
      {type === 'mcq' ? (
        <div className="field">
          <span>Options (select the correct one)</span>
          {options.map((o, i) => (
            <div key={i} className="mcq-edit">
              <input type="radio" name="ans" checked={answer === i} onChange={() => setAnswer(i)} aria-label={`Option ${i + 1} is correct`} />
              <input className="input" value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`} />
            </div>
          ))}
        </div>
      ) : type === 'tf' ? (
        <div className="field">
          <span>Answer</span>
          <div className="row">
            <label className="check">
              <input type="radio" checked={answer === 1} onChange={() => setAnswer(1)} /> True
            </label>
            <label className="check">
              <input type="radio" checked={answer === 0} onChange={() => setAnswer(0)} /> False
            </label>
          </div>
        </div>
      ) : (
        <label className="field">
          <span>{type === 'cloze' ? 'Extra (optional)' : type === 'typed' ? 'Expected answer' : 'Back / answer'}</span>
          <textarea className="input" rows={3} value={back} onChange={(e) => setBack(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>Explanation (optional)</span>
        <input className="input" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </label>
    </Modal>
  );
}

export type { Deck };
