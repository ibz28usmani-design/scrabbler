/**
 * Notion-style "blocks" on top of a ProseMirror document.
 *
 * ProseMirror nests nodes; Notion thinks in blocks. A block here is the unit a
 * person would grab: a list item rather than its whole list, a paragraph inside
 * a callout or toggle rather than the callout, and a quote or table as a whole.
 * Everything below works on plain transactions, so it is testable without a DOM.
 */
import { Fragment, Slice, type Node as PMNode, type ResolvedPos, type NodeType } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';

const ITEMS = new Set(['listItem', 'taskItem']);
/** Nodes whose children are each a block of their own. */
const CONTAINERS = new Set(['doc', 'detailsContent', 'callout']);

export interface BlockRef {
  pos: number;
  node: PMNode;
}

/** The block a position sits in (or, between blocks, the one after it). */
export function blockAt($pos: ResolvedPos): BlockRef | null {
  const after = $pos.nodeAfter;
  if (after && !$pos.parent.isTextblock && (CONTAINERS.has($pos.parent.type.name) || ITEMS.has(after.type.name))) return { pos: $pos.pos, node: after };
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d);
    if (ITEMS.has(node.type.name) || CONTAINERS.has($pos.node(d - 1).type.name)) return { pos: $pos.before(d), node };
  }
  return null;
}

/** A new empty line of the right kind (a list item inside lists) right after a block. */
export function insertLineAfter(tr: Transaction, ref: BlockRef, text = ''): Transaction {
  const schema = tr.doc.type.schema;
  const para = schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
  const line = ITEMS.has(ref.node.type.name) ? ref.node.type.create(null, para) : para;
  const at = ref.pos + ref.node.nodeSize;
  tr.insert(at, line);
  tr.setSelection(TextSelection.create(tr.doc, at + (line === para ? 1 : 2) + text.length));
  return tr;
}

export function blockAtPos(doc: PMNode, pos: number): BlockRef | null {
  if (pos < 0 || pos > doc.content.size) return null;
  return blockAt(doc.resolve(pos));
}

/** Re-reads a block from the current document, or null if it has gone. */
export function freshBlock(doc: PMNode, ref: BlockRef): BlockRef | null {
  const node = ref.pos >= 0 && ref.pos < doc.content.size ? doc.nodeAt(ref.pos) : null;
  return node && node.type === ref.node.type ? { pos: ref.pos, node } : null;
}

/** The range to remove for a block — its whole list when it is the list's only item. */
function removalRange(doc: PMNode, ref: BlockRef) {
  const $ = doc.resolve(ref.pos);
  if (ITEMS.has(ref.node.type.name) && $.parent.childCount === 1 && $.depth > 0) {
    return { from: $.before(), to: $.after() };
  }
  return { from: ref.pos, to: ref.pos + ref.node.nodeSize };
}

export function deleteBlock(tr: Transaction, ref: BlockRef): Transaction {
  const { from, to } = removalRange(tr.doc, ref);
  tr.delete(from, to);
  const pos = Math.min(from, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos), pos > 0 ? -1 : 1));
  return tr;
}

export function duplicateBlock(tr: Transaction, ref: BlockRef): Transaction {
  const at = ref.pos + ref.node.nodeSize;
  tr.insert(at, ref.node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(at + 1, tr.doc.content.size)), 1));
  return tr;
}

/** Swaps a block with its previous (-1) or next (1) sibling; false at either end. */
export function moveBlock(tr: Transaction, ref: BlockRef, dir: -1 | 1): boolean {
  const $ = tr.doc.resolve(ref.pos);
  const index = $.index();
  const sib = index + dir;
  if (sib < 0 || sib >= $.parent.childCount) return false;
  const sibling = $.parent.child(sib);
  const size = ref.node.nodeSize;
  const sel = tr.selection;
  const offset = sel.from >= ref.pos && sel.from <= ref.pos + size ? sel.from - ref.pos : null;
  let newPos: number;
  if (dir < 0) {
    newPos = ref.pos - sibling.nodeSize;
    tr.delete(ref.pos, ref.pos + size);
    tr.insert(newPos, ref.node);
  } else {
    tr.insert(ref.pos + size + sibling.nodeSize, ref.node);
    tr.delete(ref.pos, ref.pos + size);
    newPos = ref.pos + sibling.nodeSize;
  }
  if (offset !== null) tr.setSelection(TextSelection.near(tr.doc.resolve(newPos + offset)));
  return true;
}

/**
 * Moves a block to a position between blocks (a drag and drop). The target is
 * a gap position in the current document; content that doesn't fit there as is
 * (a list item dropped between paragraphs) is wrapped to fit.
 */
export function dropBlock(tr: Transaction, ref: BlockRef, target: number): boolean {
  const { from, to } = removalRange(tr.doc, ref);
  if (target >= from && target <= to) return false;
  tr.delete(from, to);
  const at = tr.mapping.map(target);
  tr.replaceRange(at, at, new Slice(Fragment.from(ref.node), 0, 0));
  // The start of what was inserted (the default bias would give its end, the next block).
  const landed = tr.mapping.slice(tr.steps.length - 1).map(at, -1);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(landed + 1, tr.doc.content.size)), 1));
  return true;
}

/**
 * Turns the textblock around `$pos` into a toggle whose title is that text.
 * Returns false where a toggle can't go (inside a list item's first line).
 */
export function textblockToToggle(tr: Transaction, $pos: ResolvedPos, headingLevel: number | null = null): boolean {
  const schema = tr.doc.type.schema;
  const details = schema.nodes.details as NodeType | undefined;
  if (!details || !$pos.parent.isTextblock || $pos.depth < 1) return false;
  const parent = $pos.node(-1);
  const index = $pos.index(-1);
  if (!parent.canReplaceWith(index, index + 1, details)) return false;
  const text: PMNode[] = [];
  let lossy = false;
  $pos.parent.content.forEach((n) => (n.isText ? text.push(n) : (lossy ||= n.type.name !== 'hardBreak')));
  // A title holds only text: a line with an equation or a link to a note goes
  // inside the toggle whole, leaving the title to type, rather than lose them.
  const summary = schema.nodes.detailsSummary.create(null, lossy ? [] : text);
  const first = lossy ? schema.nodes.paragraph.create(null, $pos.parent.content) : schema.nodes.paragraph.create();
  const body = schema.nodes.detailsContent.create(null, first);
  // New toggles start open, so Enter after the title lands inside them.
  const node = details.create({ open: true, heading: headingLevel }, [summary, body]);
  const start = $pos.before();
  tr.replaceWith(start, $pos.after(), node);
  tr.setSelection(TextSelection.create(tr.doc, start + 2 + summary.content.size));
  return true;
}

/** Sets (or clears, with null) a block colour attribute on every textblock in a range. */
export function setBlockColor(tr: Transaction, from: number, to: number, attr: 'color' | 'background', value: string | null): Transaction {
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if ((node.isTextblock || node.type.name === 'callout') && attr in node.type.spec.attrs!) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: value });
      return node.type.name === 'callout';
    }
    return true;
  });
  return tr;
}

const EXITABLE = new Set(['blockquote', 'callout', 'detailsContent']);

/**
 * Enter on an empty last line inside a quote, callout or toggle moves that line
 * out below the block, as Notion does. False when the cursor isn't on such a line.
 */
export function exitContainer(tr: Transaction): boolean {
  const { $from, empty } = tr.selection;
  if (!empty || $from.depth < 2) return false;
  const line = $from.parent;
  const box = $from.node(-1);
  if (line.type.name !== 'paragraph' || line.content.size || !EXITABLE.has(box.type.name)) return false;
  if ($from.index(-1) !== box.childCount - 1 || box.childCount < 2) return false;
  // A toggle's body sits inside the toggle itself: step out of both.
  const outerDepth = box.type.name === 'detailsContent' ? $from.depth - 2 : $from.depth - 1;
  if (outerDepth < 1) return false;
  const after = $from.after(outerDepth);
  const lineStart = $from.before();
  tr.delete(lineStart, lineStart + line.nodeSize);
  const at = tr.mapping.map(after);
  // Reuse an empty line already waiting below rather than stacking another.
  const next = tr.doc.nodeAt(at);
  if (!(next?.type.name === 'paragraph' && !next.content.size)) tr.insert(at, line.type.create());
  tr.setSelection(TextSelection.create(tr.doc, at + 1));
  return true;
}
