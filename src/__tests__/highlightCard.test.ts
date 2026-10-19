import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { clozeDraft, saveHighlightCard } from '../lib/cardFromSelection';

describe('cards from a highlight', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('blanks the highlight inside the sentence it sits in', () => {
    const text = 'Contracts need consideration. An offer is a promise to be bound on terms. Acceptance must mirror it.';
    const from = text.indexOf('a promise');
    expect(clozeDraft(text, from, from + 'a promise'.length)).toEqual({
      front: 'An offer is {{c1::a promise}} to be bound on terms.',
      sentence: 'An offer is a promise to be bound on terms.',
    });
  });

  it('keeps the braces tight around a selection with spaces at its ends', () => {
    const text = 'The rule in Hadley v Baxendale limits damages.';
    const from = text.indexOf(' Hadley');
    expect(clozeDraft(text, from, from + ' Hadley v Baxendale '.length)?.front).toBe('The rule in {{c1::Hadley v Baxendale}} limits damages.');
  });

  it('keeps a window around the highlight in a very long run-on paragraph', () => {
    const text = `${'word '.repeat(200)}target${' more'.repeat(200)}`;
    const from = text.indexOf('target');
    const d = clozeDraft(text, from, from + 6)!;
    expect(d.front).toContain('{{c1::target}}');
    expect(d.front.length).toBeLessThan(320);
  });

  it('refuses an empty or huge selection', () => {
    expect(clozeDraft('   ', 0, 3)).toBeNull();
    expect(clozeDraft('x'.repeat(500), 0, 500)).toBeNull();
  });

  it('files cards in the note’s own deck, made once, and remembers the note', async () => {
    const note = { id: 'n1', title: 'Offer and acceptance', folderId: 'f' };
    const a = await saveHighlightCard(note, 'An offer is {{c1::a promise}}.', '');
    const b = await saveHighlightCard(note, 'Plain question?', 'Plain answer');
    expect(a.deck.id).toBe(b.deck.id);
    expect(a.deck).toMatchObject({ name: 'Offer and acceptance', noteId: 'n1', folderId: 'f' });
    expect(a.card).toMatchObject({ type: 'cloze', noteId: 'n1' });
    expect(b.card.type).toBe('basic');
    expect(await db.cards.where('noteId').equals('n1').count()).toBe(2);
  });
});
