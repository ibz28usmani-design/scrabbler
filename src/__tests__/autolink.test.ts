import { describe, expect, it } from 'vitest';
import { autoLinkMarkdown, linkable } from '../lib/autolink';
import { marked } from 'marked';

const notes = [
  { id: 'offer', title: 'Offer' },
  { id: 'cl', title: 'Contract law' },
  { id: 'contract', title: 'Contract' },
  { id: 'generic', title: 'Notes' },
  { id: 'self', title: 'Lecture 4: Formation' },
];

describe('linking lecture notes', () => {
  it('links the first mention of each note, longest title first, whole words only', () => {
    const md = '# Lecture 4: Formation\n\nContract law needs an offer. An offer can be revoked. Contractual terms differ from a contract.';
    const { md: out, linked } = autoLinkMarkdown(md, notes, 'self');
    expect(linked).toEqual(['cl', 'contract', 'offer']);
    expect(out).toContain('<span data-note="cl">Contract law</span> needs an <span data-note="offer">offer</span>. An offer can');
    expect(out).toContain('Contractual terms differ from a <span data-note="contract">contract</span>.');
    // The title line itself stays plain.
    expect(out.split('\n')[0]).toBe('# Lecture 4: Formation');
  });

  it('leaves code, existing links and generic titles alone', () => {
    const md = '```\nOffer in code\n```\nSee `Offer` and [Offer](https://x) and [[Offer]] in your Notes.';
    const { linked } = autoLinkMarkdown(md, notes, 'self');
    expect(linked).toEqual([]);
  });

  it('skips short and generic titles', () => {
    expect(linkable([{ id: 'a', title: 'Law' }, { id: 'b', title: 'Untitled' }, { id: 'c', title: 'Tort' }, { id: 'd', title: '2024' }], 'x').map((t) => t.id)).toEqual(['c']);
  });

  it('survives Markdown as the span the editor reads as a note link', () => {
    // (DOMPurify keeps data- attributes by default; it needs a DOM, so only marked runs here.)
    const { md } = autoLinkMarkdown('We met the **offer** rule.', notes, 'self');
    expect(marked.parse(md, { async: false })).toContain('<strong><span data-note="offer">offer</span></strong>');
  });
});
