import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, uid, type CardType } from '../db';
import { closeModal, nav } from '../lib/nav';
import { folderMaterial, generateCards } from '../lib/ai';
import { hasKey } from '../lib/gemini';
import { makeCard } from '../lib/study';
import { parseAnki, parseDelimited, type ImportedDeck } from '../lib/importers';
import { takePendingText } from '../lib/studyActions';
import { toast, toastError } from '../lib/events';
import { Modal, Segmented, Spinner } from './ui';
import { ISparkle, IUpload } from './Icons';

type From = { kind: 'note'; noteId: string } | { kind: 'folder'; folderId: string } | { kind: 'text' };

const ALL_TYPES: { t: CardType; label: string }[] = [
  { t: 'basic', label: 'Flashcards' },
  { t: 'cloze', label: 'Fill-in-the-blank' },
  { t: 'mcq', label: 'Multiple choice' },
  { t: 'tf', label: 'True / false' },
  { t: 'typed', label: 'Type the answer' },
];

export function GenerateDeckDialog({ from, quiz }: { from: From; quiz?: boolean }) {
  const [material, setMaterial] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(quiz ? 10 : 20);
  const [types, setTypes] = useState<CardType[]>(quiz ? ['mcq', 'tf', 'typed'] : ['basic', 'cloze']);
  const [target, setTarget] = useState<string>('new');
  const [busy, setBusy] = useState(false);
  const decks = useLiveQuery(() => db.decks.toArray(), []) ?? [];

  useEffect(() => {
    (async () => {
      if (from.kind === 'note') {
        const n = await db.notes.get(from.noteId);
        setMaterial(n?.text ?? '');
        setTitle(n?.title || 'Note deck');
      } else if (from.kind === 'folder') {
        const f = await db.folders.get(from.folderId);
        setMaterial(await folderMaterial(from.folderId));
        setTitle(f?.name ?? 'Notebook deck');
      } else {
        const p = takePendingText();
        setMaterial(p?.text ?? '');
        setTitle(p?.title ?? '');
      }
    })();
  }, [from]);

  const toggle = (t: CardType) => setTypes((ts) => (ts.includes(t) ? (ts.length > 1 ? ts.filter((x) => x !== t) : ts) : [...ts, t]));

  const run = async () => {
    if (!hasKey()) {
      toast('Add your free Gemini key in Settings first.', 'error');
      return nav({ modal: { type: 'settings' } });
    }
    const src = material?.trim() || topic.trim();
    if (!src) return toast(from.kind === 'text' ? 'Paste some text or type a topic.' : 'There’s no text to make cards from yet.', 'error');
    const isTopic = !material?.trim();
    setBusy(true);
    try {
      const prompt = isTopic ? `Topic: ${src}\n(No source text — use accurate, well-established knowledge about this topic.)` : src;
      const cards = await generateCards(prompt, count, types);
      if (!cards.length) throw new Error('No cards came back — try again with more material.');
      let deckId = target;
      if (target === 'new') {
        deckId = uid();
        await db.decks.add({
          id: deckId,
          name: (title || topic || 'New deck').slice(0, 80) + (quiz ? ' — Quiz' : ''),
          createdAt: Date.now(),
          emoji: quiz ? '❓' : '🃏',
          noteId: from.kind === 'note' ? from.noteId : undefined,
          folderId: from.kind === 'folder' ? from.folderId : undefined,
        });
      }
      const now = Date.now();
      await db.cards.bulkAdd(cards.map((c, i) => makeCard(deckId, c, now + i)));
      toast(`Created ${cards.length} cards ✦`, 'success');
      closeModal();
      nav({ view: 'study', deckId, pane: 'list', session: quiz ? { deckIds: [deckId], mode: 'quiz' } : null });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={
        <>
          <ISparkle size={18} /> {quiz ? 'Generate a quiz' : 'Generate flashcards'}
        </>
      }
      onClose={closeModal}
      footer={
        <>
          <span className="spacer" />
          <button className="btn primary" onClick={run} disabled={busy || material === null}>
            {busy ? (
              <>
                <Spinner size={14} /> Generating…
              </>
            ) : (
              'Generate'
            )}
          </button>
        </>
      }
    >
      {material === null ? (
        <div className="center pad">
          <Spinner />
        </div>
      ) : (
        <>
          {from.kind === 'text' ? (
            <>
              <label className="field">
                <span>Deck name</span>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Organic chemistry — functional groups" />
              </label>
              <label className="field">
                <span>Paste material, or leave empty and enter a topic below</span>
                <textarea className="input" rows={5} value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Paste lecture notes, an article, a chapter…" />
              </label>
              {!material.trim() && (
                <label className="field">
                  <span>Topic</span>
                  <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. The causes of World War I" />
                </label>
              )}
            </>
          ) : (
            <p className="muted">
              From <strong>{title}</strong> · {Math.round(material.length / 5.5).toLocaleString()} words of material
            </p>
          )}
          <div className="field">
            <span>Number of cards</span>
            <Segmented
              value={String(count)}
              onChange={(v) => setCount(Number(v))}
              options={[10, 20, 30, 50].map((n) => ({ value: String(n), label: String(n) }))}
            />
          </div>
          <div className="field">
            <span>Question types</span>
            <div className="chips">
              {ALL_TYPES.map(({ t, label }) => (
                <button key={t} className={`chip toggle ${types.includes(t) ? 'on' : ''}`} onClick={() => toggle(t)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Add to</span>
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="new">New deck</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.emoji} {d.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </Modal>
  );
}

export function ImportDeckDialog() {
  const [tab, setTab] = useState<'anki' | 'text'>('anki');
  const [found, setFound] = useState<ImportedDeck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [termSep, setTermSep] = useState('\\t');
  const [cardSep, setCardSep] = useState('\\n');
  const [name, setName] = useState('Imported deck');
  const preview = tab === 'text' && text ? parseDelimited(text, termSep, cardSep) : [];

  const save = async (decks: ImportedDeck[]) => {
    let total = 0;
    let firstId = '';
    for (const d of decks) {
      const id = uid();
      firstId ||= id;
      await db.decks.add({ id, name: d.name, createdAt: Date.now(), emoji: '📥' });
      const now = Date.now();
      await db.cards.bulkAdd(d.cards.map((c, i) => makeCard(id, c, now + i)));
      total += d.cards.length;
    }
    toast(`Imported ${total} cards into ${decks.length} deck${decks.length === 1 ? '' : 's'}`, 'success');
    closeModal();
    nav({ view: 'study', deckId: decks.length === 1 ? firstId : null, pane: 'list', session: null });
  };

  return (
    <Modal title="Import flashcards" onClose={closeModal}>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'anki', label: 'Anki (.apkg)' },
          { value: 'text', label: 'Quizlet / CSV / text' },
        ]}
      />
      {tab === 'anki' ? (
        <div className="import-pane">
          <p className="muted">In Anki: File → Export → “Anki Deck Package (.apkg)”. Text, cloze and basic cards import; images and audio are skipped.</p>
          <label className="btn">
            <IUpload size={16} /> Choose .apkg / .colpkg file
            <input
              type="file"
              accept=".apkg,.colpkg,application/zip"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setBusy(true);
                try {
                  setFound(await parseAnki(f, f.name.replace(/\.(apkg|colpkg)$/i, '')));
                } catch (err) {
                  toastError(err);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          {busy && <Spinner />}
          {found && (
            <div className="found">
              {found.map((d, i) => (
                <div key={i} className="found-row">
                  <strong>{d.name}</strong> <span className="muted">{d.cards.length} cards</span>
                </div>
              ))}
              {found.length > 0 ? (
                <button className="btn primary" onClick={() => save(found)}>
                  Import {found.reduce((a, d) => a + d.cards.length, 0)} cards
                </button>
              ) : (
                <p className="warn">No importable cards found.</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="import-pane">
          <p className="muted">In Quizlet: ⋯ → Export → copy the text. Default separators (Tab between term & definition, new line between cards) work as-is.</p>
          <label className="field">
            <span>Deck name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <textarea className="input mono" rows={8} placeholder={'term\tdefinition\nterm\tdefinition'} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row wrap">
            <label className="field inline">
              <span>Between term & definition</span>
              <select className="input" value={termSep} onChange={(e) => setTermSep(e.target.value)}>
                <option value="\t">Tab</option>
                <option value=",">Comma (CSV)</option>
                <option value=" - ">Dash ( - )</option>
                <option value=";">Semicolon</option>
                <option value="auto">Auto-detect</option>
              </select>
            </label>
            <label className="field inline">
              <span>Between cards</span>
              <select className="input" value={cardSep} onChange={(e) => setCardSep(e.target.value)}>
                <option value="\n">New line</option>
                <option value=";">Semicolon</option>
                <option value="\n\n">Blank line</option>
              </select>
            </label>
            <label className="btn small">
              <IUpload size={14} /> Load file
              <input type="file" accept=".csv,.tsv,.txt" hidden onChange={async (e) => e.target.files?.[0] && setText(await e.target.files[0].text())} />
            </label>
          </div>
          <div className="muted">{preview.length} cards detected</div>
          {preview.slice(0, 3).map((c, i) => (
            <div key={i} className="found-row">
              <strong>{c.front}</strong> → {c.back}
            </div>
          ))}
          <button className="btn primary" disabled={!preview.length} onClick={() => save([{ name: name || 'Imported deck', cards: preview }])}>
            Import {preview.length} cards
          </button>
        </div>
      )}
    </Modal>
  );
}
