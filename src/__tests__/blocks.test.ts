import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { notionExtensions } from '../components/notionBlocks';
import { blockAtPos, deleteBlock, dropBlock, duplicateBlock, insertLineAfter, moveBlock, setBlockColor, textblockToToggle } from '../lib/blockOps';
import { norm, rankItems, SLASH_ITEMS } from '../lib/slashCommands';
import { cleanUrl, embedPlan, playerUrl } from '../lib/embeds';
import { toBlocks } from '../lib/export/ir';
import { toMarkdown } from '../lib/export/text';

const schema = getSchema([StarterKit.configure({ blockquote: false }), TaskList, TaskItem.configure({ nested: true }), ...notionExtensions]);

const p = (text = '') => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const li = (text: string) => ({ type: 'listItem', content: [p(text)] });
const docOf = (...content: object[]) => schema.nodeFromJSON({ type: 'doc', content });
const texts = (doc: PMNode) => {
  const out: string[] = [];
  doc.forEach((n) => out.push(`${n.type.name}:${n.textContent}`));
  return out;
};
/** Position just inside the first textblock whose text is `text`. */
function posOf(doc: PMNode, text: string) {
  let at = -1;
  doc.descendants((n, pos) => {
    if (at < 0 && n.isTextblock && n.textContent === text) at = pos + 1;
    return at < 0;
  });
  if (at < 0) throw new Error(`no "${text}"`);
  return at;
}
const stateOf = (doc: PMNode, at = 1) => EditorState.create({ doc, selection: TextSelection.create(doc, at) });

describe('blocks', () => {
  it('finds the Notion block: list item, callout line, whole toggle', () => {
    const doc = docOf(
      { type: 'bulletList', content: [li('one'), li('two')] },
      { type: 'callout', content: [p('inside')] },
      { type: 'details', content: [{ type: 'detailsSummary', content: [{ type: 'text', text: 'Title' }] }, { type: 'detailsContent', content: [p('hidden')] }] },
    );
    expect(blockAtPos(doc, posOf(doc, 'two'))!.node.type.name).toBe('listItem');
    expect(blockAtPos(doc, posOf(doc, 'two'))!.node.textContent).toBe('two');
    expect(blockAtPos(doc, posOf(doc, 'inside'))!.node.type.name).toBe('paragraph');
    expect(blockAtPos(doc, posOf(doc, 'Title'))!.node.type.name).toBe('details');
    expect(blockAtPos(doc, posOf(doc, 'hidden'))!.node.type.name).toBe('paragraph');
    // Between blocks at the top level, the block after the gap.
    expect(blockAtPos(doc, 0)!.node.type.name).toBe('bulletList');
  });

  it('moves a block up and down among its siblings', () => {
    const doc = docOf(p('a'), p('b'), p('c'));
    const st = stateOf(doc, posOf(doc, 'b'));
    const tr = st.tr;
    expect(moveBlock(tr, blockAtPos(doc, posOf(doc, 'b'))!, -1)).toBe(true);
    expect(texts(tr.doc)).toEqual(['paragraph:b', 'paragraph:a', 'paragraph:c']);
    // The cursor travels with the block.
    expect(tr.selection.$from.parent.textContent).toBe('b');
    const tr2 = stateOf(doc).tr;
    expect(moveBlock(tr2, blockAtPos(doc, posOf(doc, 'a'))!, -1)).toBe(false);
    expect(moveBlock(tr2, blockAtPos(doc, posOf(doc, 'a'))!, 1)).toBe(true);
    expect(texts(tr2.doc)).toEqual(['paragraph:b', 'paragraph:a', 'paragraph:c']);
  });

  it('duplicates and deletes, removing a list with its last item', () => {
    const doc = docOf(p('x'), { type: 'bulletList', content: [li('only')] }, p('y'));
    const dup = duplicateBlock(stateOf(doc).tr, blockAtPos(doc, posOf(doc, 'x'))!);
    expect(texts(dup.doc)).toEqual(['paragraph:x', 'paragraph:x', 'bulletList:only', 'paragraph:y']);
    const del = deleteBlock(stateOf(doc).tr, blockAtPos(doc, posOf(doc, 'only'))!);
    expect(texts(del.doc)).toEqual(['paragraph:x', 'paragraph:y']);
  });

  it('drops a dragged block into a gap, wrapping list items to fit', () => {
    const doc = docOf(p('a'), p('b'), { type: 'bulletList', content: [li('i1'), li('i2')] });
    const tr = stateOf(doc).tr;
    const a = blockAtPos(doc, posOf(doc, 'a'))!;
    const b = blockAtPos(doc, posOf(doc, 'b'))!;
    expect(dropBlock(tr, a, b.pos + b.node.nodeSize)).toBe(true);
    expect(texts(tr.doc)).toEqual(['paragraph:b', 'paragraph:a', 'bulletList:i1i2']);

    const tr2 = stateOf(doc).tr;
    const item = blockAtPos(doc, posOf(doc, 'i2'))!;
    expect(dropBlock(tr2, item, 0)).toBe(true);
    expect(texts(tr2.doc)).toEqual(['bulletList:i2', 'paragraph:a', 'paragraph:b', 'bulletList:i1']);

    // Dropping a block onto itself does nothing.
    expect(dropBlock(stateOf(doc).tr, a, a.pos)).toBe(false);
  });

  it('turns a line into a toggle titled with its text', () => {
    const doc = docOf(p('Week 1'));
    const tr = stateOf(doc, 3).tr;
    expect(textblockToToggle(tr, tr.selection.$from, 2)).toBe(true);
    const t = tr.doc.firstChild!;
    expect(t.type.name).toBe('details');
    expect(t.attrs.heading).toBe(2);
    expect(t.firstChild!.textContent).toBe('Week 1');
    expect(tr.selection.$from.parent.type.name).toBe('detailsSummary');
  });

  it('adds a line after a block, as a list item inside lists', () => {
    const doc = docOf({ type: 'bulletList', content: [li('one')] });
    const tr = insertLineAfter(stateOf(doc).tr, blockAtPos(doc, posOf(doc, 'one'))!, '/');
    expect(tr.doc.firstChild!.childCount).toBe(2);
    expect(tr.selection.$from.parent.textContent).toBe('/');
  });

  it('colours every textblock in a range', () => {
    const doc = docOf(p('a'), { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'h' }] }, p('c'));
    const tr = setBlockColor(stateOf(doc).tr, 0, posOf(doc, 'h') + 1, 'background', 'yellow');
    expect([0, 1, 2].map((i) => tr.doc.child(i).attrs.background)).toEqual(['yellow', 'yellow', null]);
  });
});

describe('/ command ranking', () => {
  const top = (q: string) => rankItems(SLASH_ITEMS, q)[0]?.id;

  it('matches Notion’s aliases first', () => {
    expect(top('h1')).toBe('h1');
    expect(top('#')).toBe('h1');
    expect(top('##')).toBe('h2');
    expect(top('todo')).toBe('todo');
    expect(top('bullet')).toBe('bullet');
    expect(top('num')).toBe('number');
    expect(top('div')).toBe('divider');
    expect(top('toggle')).toBe('toggle');
    expect(top('quote')).toBe('quote');
    expect(top('callout')).toBe('callout');
    expect(top('code')).toBe('code');
    expect(top('toc')).toBe('toc');
    expect(top('math')).toBe('math');
    expect(top('page')).toBe('page');
    expect(top('text')).toBe('text');
    expect(top('plain')).toBe('text');
    expect(top('turnh1')).toBe('turn-h1');
    expect(top('turnbullet')).toBe('turn-bullet');
    expect(top('red')).toBe('color-red');
    expect(top('red background')).toBe('bg-red');
    expect(top('blue bg')).toBe('bg-blue');
    expect(top('-')).toBe('bullet');
    expect(top('---')).toBe('divider');
    expect(top('to-do')).toBe('todo');
  });

  it('keeps turn-into and colour commands out of the plain list', () => {
    const all = rankItems(SLASH_ITEMS, '');
    expect(all.some((i) => i.id.startsWith('turn-') || i.id.startsWith('color-') || i.id.startsWith('bg-'))).toBe(false);
    const turn = rankItems(SLASH_ITEMS, 'turn');
    expect(turn.filter((i) => i.id.startsWith('turn-')).length).toBeGreaterThan(10);
    // The drill-down item itself hides once you've typed its word.
    expect(turn.some((i) => i.id === 'turn')).toBe(false);
  });

  it('closes on a space straight after the slash, and on nonsense', () => {
    expect(rankItems(SLASH_ITEMS, ' 2')).toEqual([]);
    expect(rankItems(SLASH_ITEMS, 'zzqx')).toEqual([]);
  });

  it('every alias is unique to its command', () => {
    const seen = new Map<string, string>();
    for (const it of SLASH_ITEMS)
      for (const a of it.aliases) {
        const k = norm(a);
        expect(seen.get(k) ?? it.id, `alias ${a}`).toBe(it.id);
        seen.set(k, it.id);
      }
  });
});

describe('embeds', () => {
  it('finds players for video sites', () => {
    expect(playerUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42');
    expect(playerUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(playerUrl('https://youtube.com/shorts/abcdefghijk')).toBe('https://www.youtube-nocookie.com/embed/abcdefghijk');
    expect(playerUrl('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871');
    expect(playerUrl('https://example.com/watch?v=1')).toBeNull();
  });

  it('only accepts web links', () => {
    expect(cleanUrl('example.com/a')).toBe('https://example.com/a');
    expect(cleanUrl('javascript:alert(1)')).toBeNull();
    expect(cleanUrl('data:text/html,hi')).toBeNull();
    expect(cleanUrl('  ')).toBeNull();
  });

  it('plays media files directly', () => {
    expect(embedPlan('https://x.org/a.mp3', 'embed').as).toBe('audio');
    expect(embedPlan('https://x.org/a.mp4', 'embed').as).toBe('video');
    expect(embedPlan('https://x.org/', 'bookmark').as).toBe('card');
    expect(embedPlan('https://x.org/', 'embed').as).toBe('frame');
  });
});

describe('export of Notion blocks', () => {
  it('opens toggles, keeps equations and links as text', () => {
    const blocks = toBlocks({
      type: 'doc',
      content: [
        { type: 'details', attrs: { heading: 2 }, content: [{ type: 'detailsSummary', content: [{ type: 'text', text: 'Week 1' }] }, { type: 'detailsContent', content: [p('Offer')] }] },
        { type: 'callout', attrs: { emoji: '💡' }, content: [p('Remember')] },
        { type: 'mathBlock', attrs: { latex: 'E=mc^2' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'noteLink', attrs: { id: 'n1', title: 'Torts' } }, { type: 'mathInline', attrs: { latex: 'x^2' } }] },
        { type: 'tableOfContents' },
        { type: 'embed', attrs: { src: 'https://youtu.be/x', kind: 'video' } },
      ],
    });
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'quote', 'code', 'paragraph', 'paragraph']);
    const md = toMarkdown(blocks);
    expect(md).toContain('## Week 1');
    expect(md).toContain('> Remember');
    expect(md).toContain('E=mc^2');
    expect(md).toContain('Torts');
    expect(md).toContain('`x^2`');
    expect(md).toContain('https://youtu.be/x');
  });
});

describe('leaving a block with Enter', () => {
  it('moves an empty last line out of a quote, callout or toggle', async () => {
    const { exitContainer } = await import('../lib/blockOps');
    const toggle = docOf({ type: 'details', attrs: { open: true }, content: [{ type: 'detailsSummary', content: [{ type: 'text', text: 'T' }] }, { type: 'detailsContent', content: [p('body'), p()] }] });
    const end = toggle.content.size - 3; // inside the empty paragraph
    const tr = stateOf(toggle, end).tr;
    expect(exitContainer(tr)).toBe(true);
    expect(texts(tr.doc)).toEqual(['details:Tbody', 'paragraph:']);
    expect(tr.selection.$from.depth).toBe(1);

    const quote = docOf({ type: 'blockquote', content: [p('q'), p()] });
    const tr2 = stateOf(quote, quote.content.size - 2).tr;
    expect(exitContainer(tr2)).toBe(true);
    expect(texts(tr2.doc)).toEqual(['blockquote:q', 'paragraph:']);

    // A non-empty line, or the only line, stays put.
    const one = docOf({ type: 'callout', content: [p()] });
    expect(exitContainer(stateOf(one, 2).tr)).toBe(false);
  });
});
