/**
 * Notion's blocks and typing shortcuts, as TipTap extensions: toggles (and
 * toggle headings), callouts, block colours, the Markdown-style shortcuts
 * Notion uses (`> ` toggle, `" ` quote, `~strike~`, `$$math$$`) and its
 * block keyboard shortcuts (⌘⌥0–9, ⌘D, ⌘⇧↑/↓, ⌘↵).
 */
import { Extension, InputRule, Node, mergeAttributes, wrappingInputRule, markInputRule, type Editor } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { TextSelection } from '@tiptap/pm/state';
import { blockAt, deleteBlock, duplicateBlock, exitContainer, moveBlock, setBlockColor, textblockToToggle } from '../lib/blockOps';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: () => ReturnType;
    };
  }
}

export const CALLOUT_EMOJI = ['💡', '⚠️', '❗', 'ℹ️', '✅', '📌', '🔥', '❓', '📝', '🎯'];

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      emoji: {
        default: '💡',
        parseHTML: (el) => el.getAttribute('data-emoji') || '💡',
        renderHTML: (a) => ({ 'data-emoji': a.emoji }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }, { tag: 'aside' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0];
  },
  addCommands() {
    return {
      setCallout:
        () =>
        ({ commands }) =>
          commands.wrapIn(this.name),
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.setAttribute('data-type', 'callout');
      const icon = document.createElement('button');
      icon.type = 'button';
      icon.className = 'callout-icon';
      icon.contentEditable = 'false';
      icon.setAttribute('aria-label', 'Change callout icon');
      const content = document.createElement('div');
      content.className = 'callout-body';
      dom.append(icon, content);
      const paint = (n: typeof node) => {
        icon.textContent = n.attrs.emoji;
        for (const a of ['data-color', 'data-bg'] as const) dom.removeAttribute(a);
        if (n.attrs.color) dom.setAttribute('data-color', n.attrs.color);
        if (n.attrs.background) dom.setAttribute('data-bg', n.attrs.background);
      };
      paint(node);
      icon.addEventListener('mousedown', (e) => e.preventDefault());
      icon.addEventListener('click', () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos === undefined || !editor.isEditable) return;
        const cur = editor.state.doc.nodeAt(pos);
        if (!cur) return;
        const next = CALLOUT_EMOJI[(CALLOUT_EMOJI.indexOf(cur.attrs.emoji) + 1) % CALLOUT_EMOJI.length];
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, emoji: next }));
      });
      return {
        dom,
        contentDOM: content,
        update: (n) => {
          if (n.type.name !== 'callout') return false;
          paint(n);
          return true;
        },
        ignoreMutation: (m) => m.type !== 'selection' && icon.contains(m.target as globalThis.Node),
      };
    };
  },
});

/** Toggle list; `heading` (1–3) makes it a Notion toggle heading. */
export const Toggle = Details.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      heading: {
        default: null,
        parseHTML: (el) => Number(el.getAttribute('data-heading')) || null,
        renderHTML: (a) => (a.heading ? { 'data-heading': a.heading } : {}),
      },
    };
  },
}).configure({
  persist: true,
  renderToggleButton: ({ element, isOpen }) => {
    element.className = 'toggle-btn';
    element.setAttribute('aria-label', isOpen ? 'Collapse' : 'Expand');
    element.setAttribute('aria-expanded', String(isOpen));
  },
});

/** Notion's quote shortcut is `"`; `>` belongs to toggles. */
export const Quote = Blockquote.extend({
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*["“”]\s$/, type: this.type })];
  },
});

export const BLOCK_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;
export type BlockColor = (typeof BLOCK_COLORS)[number];

/** Notion colours a whole block — its text, or its background. */
export const BlockColors = Extension.create({
  name: 'blockColors',
  addGlobalAttributes() {
    const attr = (data: string) => ({
      default: null,
      keepOnSplit: false,
      parseHTML: (el: HTMLElement) => {
        const v = el.getAttribute(data);
        return v && (BLOCK_COLORS as readonly string[]).includes(v) ? v : null;
      },
      renderHTML: (a: Record<string, any>) => {
        const v = a[data === 'data-color' ? 'color' : 'background'];
        return v ? { [data]: v } : {};
      },
    });
    return [{ types: ['paragraph', 'heading', 'detailsSummary', 'callout'], attributes: { color: attr('data-color'), background: attr('data-bg') } }];
  },
});

/** Notion's Markdown-style shortcuts that TipTap doesn't already have. */
export const NotionInputRules = Extension.create({
  name: 'notionInputRules',
  addInputRules() {
    return [
      // "> " at the start of a line makes a toggle.
      new InputRule({
        find: /^\s*>\s$/,
        handler: ({ state, range }) => {
          const tr = state.tr.delete(range.from, range.to);
          if (!textblockToToggle(tr, tr.doc.resolve(tr.mapping.map(range.from)))) return null;
        },
      }),
      // Notion strikes through with single tildes.
      markInputRule({ find: /(?:^|\s)(~(?!\s+~)([^~]+)~(?!\s+~))$/, type: this.editor.schema.marks.strike }),
      // $$E = mc^2$$ becomes an inline equation.
      new InputRule({
        find: /(?:^|\s)(\$\$([^$]+)\$\$)$/,
        handler: ({ state, range, match }) => {
          const type = state.schema.nodes.mathInline;
          if (!type) return null;
          const start = range.from + match[0].indexOf(match[1]);
          state.tr.replaceWith(start, range.to, type.create({ latex: match[2].trim() }));
        },
      }),
    ];
  },
});

// ------------------------------------------------------------------ turn into

export type BlockKind = 'text' | 'h1' | 'h2' | 'h3' | 'bullet' | 'number' | 'todo' | 'toggle' | 'toggleh1' | 'toggleh2' | 'toggleh3' | 'quote' | 'callout' | 'code';

const LISTS = ['bulletList', 'orderedList', 'taskList'];

/** Strips list, toggle, quote and code formatting from the current block. */
function toPlain(editor: Editor) {
  for (let i = 0; i < 6; i++) {
    const { $from } = editor.state.selection;
    const inList = LISTS.some((l) => editor.isActive(l));
    if (inList) {
      if (!editor.commands.liftListItem(editor.isActive('taskList') ? 'taskItem' : 'listItem')) break;
      continue;
    }
    if ($from.parent.type.name === 'detailsSummary') {
      editor.commands.unsetDetails();
      continue;
    }
    if (editor.isActive('blockquote')) {
      editor.commands.lift('blockquote');
      continue;
    }
    if (editor.isActive('callout')) {
      editor.commands.lift('callout');
      continue;
    }
    break;
  }
  editor.commands.setParagraph();
}

/** Notion's "Turn into": changes the current block's type, keeping its text. */
export function turnInto(editor: Editor, kind: BlockKind) {
  editor.commands.focus();
  toPlain(editor);
  const c = editor.chain().focus();
  switch (kind) {
    case 'text':
      return true;
    case 'h1':
    case 'h2':
    case 'h3':
      return c.setHeading({ level: Number(kind[1]) as 1 | 2 | 3 }).run();
    case 'bullet':
      return c.toggleBulletList().run();
    case 'number':
      return c.toggleOrderedList().run();
    case 'todo':
      return c.toggleTaskList().run();
    case 'quote':
      return c.toggleBlockquote().run();
    case 'callout':
      return c.setCallout().run();
    case 'code':
      return c.setCodeBlock().run();
    default: {
      const level = kind === 'toggle' ? null : Number(kind.slice(-1));
      return c
        .command(({ tr }) => textblockToToggle(tr, tr.selection.$from, level))
        .run();
    }
  }
}

export function colorBlock(editor: Editor, attr: 'color' | 'background', value: BlockColor | null) {
  const { from, to } = editor.state.selection;
  editor.view.dispatch(setBlockColor(editor.state.tr, from, to, attr, value));
}

export function currentBlock(editor: Editor) {
  return blockAt(editor.state.selection.$from);
}

export function deleteCurrentBlock(editor: Editor) {
  const ref = currentBlock(editor);
  if (ref) editor.view.dispatch(deleteBlock(editor.state.tr, ref));
}

export function duplicateCurrentBlock(editor: Editor) {
  const ref = currentBlock(editor);
  if (ref) editor.view.dispatch(duplicateBlock(editor.state.tr, ref).scrollIntoView());
}

export function moveCurrentBlock(editor: Editor, dir: -1 | 1) {
  const ref = currentBlock(editor);
  if (!ref) return false;
  const tr = editor.state.tr;
  if (!moveBlock(tr, ref, dir)) return false;
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Opens or closes every toggle in the note at once. */
export function setAllToggles(editor: Editor, open?: boolean) {
  const tr = editor.state.tr;
  let target = open;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'details') return;
    if (target === undefined) target = !node.attrs.open;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: target });
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}

/** Notion's block shortcuts. */
export const NotionKeymap = Extension.create({
  name: 'notionKeymap',
  priority: 1000,
  addKeyboardShortcuts() {
    const turn = (k: BlockKind) => () => turnInto(this.editor, k);
    return {
      'Mod-Alt-0': turn('text'),
      'Mod-Alt-1': turn('h1'),
      'Mod-Alt-2': turn('h2'),
      'Mod-Alt-3': turn('h3'),
      'Mod-Alt-4': turn('todo'),
      'Mod-Alt-5': turn('bullet'),
      'Mod-Alt-6': turn('number'),
      'Mod-Alt-7': turn('toggle'),
      'Mod-Alt-8': turn('code'),
      'Mod-d': () => (duplicateCurrentBlock(this.editor), true),
      'Mod-Shift-ArrowUp': () => moveCurrentBlock(this.editor, -1),
      'Mod-Shift-ArrowDown': () => moveCurrentBlock(this.editor, 1),
      'Mod-Alt-t': () => (setAllToggles(this.editor), true),
      Enter: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        // Enter in an open toggle's title steps into its empty body, rather than
        // stacking a second empty line on top of it.
        if (empty && $from.parent.type.name === 'detailsSummary' && $from.parentOffset === $from.parent.content.size) {
          const details = $from.node(-1);
          const body = details.child(1);
          if (details.attrs.open && body.childCount === 1 && body.firstChild!.isTextblock && !body.firstChild!.content.size) {
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, $from.after() + 2)));
            return true;
          }
        }
        const tr = state.tr;
        if (!exitContainer(tr)) return false;
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      // ⌘↵ ticks a to-do, or opens and closes a toggle.
      'Mod-Enter': () => {
        const { $from } = this.editor.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (n.type.name === 'taskItem' || n.type.name === 'details') {
            const key = n.type.name === 'taskItem' ? 'checked' : 'open';
            this.editor.view.dispatch(this.editor.state.tr.setNodeMarkup($from.before(d), undefined, { ...n.attrs, [key]: !n.attrs[key] }));
            return true;
          }
        }
        return false;
      },
    };
  },
});

export const notionExtensions = [Toggle, DetailsSummary, DetailsContent, Callout, Quote, BlockColors, NotionInputRules, NotionKeymap];
