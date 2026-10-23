/**
 * A flashcard cut from a highlight: the sentence it sits in, with the
 * highlighted words as the blank to fill. No AI, so it costs nothing and
 * says exactly what the note says, and the card remembers its note.
 */
import { db, uid, type Card, type Deck, type Note } from '../db';
import { makeCard } from './study';

export interface Draft {
  /** The cloze text: the sentence with {{c1::the highlight}}. */
  front: string;
  /** The sentence as written, for the card's back. */
  sentence: string;
}

const MAX_SENTENCE = 320;

/**
 * The sentence around [from, to) in a paragraph's text, with the selection
 * as the blank. Selections spanning sentences keep them all.
 */
export function clozeDraft(text: string, from: number, to: number): Draft | null {
  const sel = text.slice(from, to);
  const answer = sel.trim();
  if (!answer || answer.length > 200) return null;
  // Trim the selection's own whitespace from its ends, so the braces hug the words.
  const a = from + (sel.length - sel.trimStart().length);
  const b = to - (sel.length - sel.trimEnd().length);
  const before = text.slice(0, a);
  const after = text.slice(b);
  const startMatch = [...before.matchAll(/[.!?](["'”’)\]]*)\s+/g)].pop();
  let start = startMatch ? startMatch.index! + startMatch[0].length : 0;
  const endMatch = /[.!?](["'”’)\]]*)(\s|$)/.exec(after);
  let end = endMatch ? b + endMatch.index + endMatch[0].trimEnd().length : text.length;
  // A runaway "sentence" (a long list, no full stops): keep a window around the highlight.
  if (end - start > MAX_SENTENCE) {
    start = Math.max(start, a - 140);
    end = Math.min(end, b + 140);
  }
  const lead = text.slice(start, a);
  const tail = text.slice(b, end);
  const sentence = `${lead}${text.slice(a, b)}${tail}`.replace(/\s+/g, ' ').trim();
  const front = `${lead}{{c1::${text.slice(a, b)}}}${tail}`.replace(/\s+/g, ' ').trim();
  return { front, sentence };
}

/** The note's own deck: the one made from it before, or a new one named after it in its folder. */
export async function deckForNote(note: Pick<Note, 'id' | 'title' | 'folderId'>): Promise<Deck> {
  const existing = await db.decks.filter((d) => d.noteId === note.id).first();
  if (existing) return existing;
  const deck: Deck = { id: uid(), name: note.title.trim() || 'Highlights', folderId: note.folderId, noteId: note.id, createdAt: Date.now(), icon: 'cards' };
  await db.decks.add(deck);
  return deck;
}

export async function saveHighlightCard(note: Pick<Note, 'id' | 'title' | 'folderId'>, front: string, back: string, deckId?: string): Promise<{ card: Card; deck: Deck }> {
  const deck = deckId ? ((await db.decks.get(deckId)) ?? (await deckForNote(note))) : await deckForNote(note);
  const isCloze = /\{\{c\d+::/.test(front);
  const card = makeCard(deck.id, { type: isCloze ? 'cloze' : 'basic', front, back, noteId: note.id });
  await db.cards.add(card);
  return { card, deck };
}
