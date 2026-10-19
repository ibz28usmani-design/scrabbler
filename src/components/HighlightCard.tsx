import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Note } from '../db';
import { clozeDraft, saveHighlightCard } from '../lib/cardFromSelection';
import { toast, toastError } from '../lib/events';
import { Modal } from './ui';
import { ICards } from './Icons';

interface Pending {
  front: string;
  back: string;
}

/**
 * Select words in a note and a "Card" chip appears by them: one tap makes a
 * fill-in-the-blank card from the sentence, filed in the note's own deck.
 */
export function HighlightCard({ editor, note }: { editor: Editor; note: Note }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState<Pending | null>(null);
  const [deckId, setDeckId] = useState('');
  const chip = useRef<HTMLButtonElement>(null);
  const decks = useLiveQuery(() => (draft ? db.decks.orderBy('createdAt').reverse().toArray() : []), [!!draft]) ?? [];

  useEffect(() => {
    const update = () => {
      const { from, to, empty, $from, $to } = editor.state.selection;
      // Only plain text inside one paragraph or heading, the kind a sentence lives in.
      if (empty || !$from.sameParent($to) || !$from.parent.isTextblock || !editor.isEditable) return setAt(null);
      const words = editor.state.doc.textBetween(from, to).trim();
      if (!words || words.length > 200) return setAt(null);
      const end = editor.view.coordsAtPos(to);
      const host = editor.view.dom.closest('.editor-scroll')?.getBoundingClientRect();
      if (!host) return setAt(null);
      setAt({ top: end.bottom + 8, left: Math.min(end.left, window.innerWidth - 120) });
    };
    const hide = () => setTimeout(() => document.activeElement !== chip.current && setAt(null), 150);
    editor.on('selectionUpdate', update);
    editor.on('blur', hide);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('blur', hide);
    };
  }, [editor]);

  const open = () => {
    const { from, to, $from } = editor.state.selection;
    const start = $from.start();
    const para = $from.parent;
    // Links and mentions read as their titles.
    const leaf = (n: { attrs: Record<string, unknown>; type: { name: string } }) => (n.type.name === 'hardBreak' ? ' ' : String(n.attrs.title ?? n.attrs.label ?? ''));
    const before = para.textBetween(0, from - start, undefined, leaf);
    const sel = para.textBetween(from - start, to - start, undefined, leaf);
    const after = para.textBetween(to - start, para.content.size, undefined, leaf);
    const d = clozeDraft(before + sel + after, before.length, before.length + sel.length);
    if (!d) return toast('Select a few words in a sentence to make a card from.', 'info');
    setDraft({ front: d.front, back: '' });
    setAt(null);
  };

  const save = async () => {
    if (!draft) return;
    try {
      const { card, deck } = await saveHighlightCard(note, draft.front.trim(), draft.back.trim(), deckId || undefined);
      setDraft(null);
      toast(`Card added to ${deck.name}`, 'success', { label: 'Undo', run: () => void db.cards.delete(card.id) });
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <>
      {at && (
        <button ref={chip} className="highlight-card-chip" style={at} onMouseDown={(e) => e.preventDefault()} onClick={open} aria-label="Make a flashcard from the selection">
          <ICards size={15} /> Card
        </button>
      )}
      {draft && (
        <Modal
          title="New card from your note"
          onClose={() => setDraft(null)}
          footer={
            <button className="btn primary" disabled={!/\{\{c\d+::[^}]+\}\}/.test(draft.front) && !draft.back.trim()} onClick={save}>
              Add card
            </button>
          }
        >
          <label className="form-label">
            Front — the words in {'{{c1::…}}'} become the blank
            <textarea className="input" rows={3} value={draft.front} onChange={(e) => setDraft({ ...draft, front: e.target.value })} autoFocus />
          </label>
          <label className="form-label">
            Extra on the back (optional)
            <textarea className="input" rows={2} value={draft.back} onChange={(e) => setDraft({ ...draft, back: e.target.value })} />
          </label>
          <label className="form-label">
            Deck
            <select className="input" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
              <option value="">{decks.find((d) => d.noteId === note.id)?.name ?? `New deck: ${note.title || 'Highlights'}`}</option>
              {decks
                .filter((d) => d.noteId !== note.id)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </label>
        </Modal>
      )}
    </>
  );
}
