import { describe, expect, it } from 'vitest';
import { deckBody, linkId } from '../lib/share';
import { makeCard } from '../lib/study';

describe('shared pages', () => {
  it('turns a deck into cards that open without any script, escaping what they say', () => {
    const cards = [
      makeCard('d', { type: 'basic', front: 'What is an <offer>?', back: 'A promise & more' }),
      makeCard('d', { type: 'cloze', front: 'Acceptance must {{c1::mirror}} the offer.', back: '' }),
      makeCard('d', { type: 'mcq', front: 'Which?', back: '', options: ['A one', 'B two'], answer: 1 }),
      { ...makeCard('d', { type: 'basic', front: 'Hidden', back: 'x' }), suspended: true },
    ];
    const html = deckBody({ name: 'Contract <law>' }, cards);
    expect(html).toContain('<h1>Contract &lt;law&gt;</h1>');
    expect(html).toContain('3 cards');
    expect(html).toContain('<summary>What is an &lt;offer&gt;?</summary><div class="answer">A promise &amp; more');
    expect(html).toContain('Acceptance must […] the offer.');
    expect(html).toContain('<mark>mirror</mark>');
    expect(html).toContain('B two');
    expect(html).not.toContain('Hidden');
    expect(html).not.toMatch(/<script/i);
  });

  it('makes long, unguessable, URL-safe link ids', () => {
    const a = linkId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(linkId()).not.toBe(a);
  });
});
