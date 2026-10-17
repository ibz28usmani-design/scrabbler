/**
 * Notion's / commands for typed notes.
 *
 * Each command has the aliases Notion accepts after the slash (/h1, /todo,
 * /turnbullet, /red background…). Ranking is a pure function so it can be
 * tested; running a command needs the live editor and a small host object the
 * note editor provides (image picker, AI tools, the note's folder).
 */
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { db, type Note } from '../db';
import { createNote } from './notes';
import { nav, openModal } from './nav';
import { toast } from './events';
import { cleanUrl, type EmbedKind } from './embeds';
import { attachFromPicker } from './attachments';
import { EMOJI } from './emoji';
import { promptDialog } from '../components/ui';
import { BLOCK_COLORS, colorBlock, currentBlock, deleteCurrentBlock, duplicateCurrentBlock, setAllToggles, turnInto, type BlockColor, type BlockKind } from '../components/notionBlocks';
import { openNote } from '../components/NotionBlockViews';

import { getSlashHost, type SlashHost } from './slashHost';
export { getSlashHost, setSlashHost, type SlashHost } from './slashHost';

export interface MenuItem {
  id: string;
  title: string;
  hint?: string;
  icon: string;
  group?: string;
  /** Typed after the trigger to find this item (spaces and dashes ignored). */
  aliases: string[];
  /** The Markdown shortcut that does the same, shown at the right. */
  shortcut?: string;
  /** Text colour / background swatch for colour commands. */
  swatch?: { color?: BlockColor | 'default'; bg?: BlockColor | 'default' };
  /** Only listed once the query matches one of its aliases. */
  hidden?: boolean;
  /** Selecting it types this after the slash instead, to narrow the list. */
  drill?: string;
}

export interface SlashItem extends MenuItem {
  run?: (ctx: { editor: Editor; host: SlashHost | undefined }) => unknown;
}

/** Lower-cased, without spaces or in-word hyphens: "To-do list" → "todolist", but "---" stays. */
export const norm = (s: string) => s.toLowerCase().replace(/\s+|_|(?<=\w)-(?=\w)/g, '');

function score(it: MenuItem, q: string): number | null {
  const aliases = it.aliases.map(norm);
  const title = norm(it.title);
  if (aliases.includes(q) || title === q) return 0;
  if (aliases.some((a) => a.startsWith(q))) return 1;
  if (title.startsWith(q)) return 2;
  if (it.title.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))) return 3;
  if (title.includes(q) || aliases.some((a) => a.includes(q))) return 4;
  return null;
}

/** Notion-like matching: exact alias, then alias prefix, then title words, then anywhere. */
export function rankItems<T extends MenuItem>(items: T[], query: string): T[] {
  if (/^\s/.test(query)) return [];
  const q = norm(query);
  if (!q) return items.filter((i) => !i.hidden);
  const scored: [number, number, T][] = [];
  items.forEach((it, idx) => {
    if (it.drill && norm(it.drill) === q) return;
    const s = score(it, q);
    if (s === null || (it.hidden && s > 1)) return;
    scored.push([s, idx, it]);
  });
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((s) => s[2]);
}

// ------------------------------------------------------------------ helpers

/** Notion puts a new block below when the line already has text in it. */
function freshLine(editor: Editor) {
  const { $from } = editor.state.selection;
  if (!$from.parent.isTextblock || $from.parent.content.size === 0) return;
  if (editor.isActive('codeBlock')) editor.chain().focus().exitCode().run();
  else editor.chain().focus().selectTextblockEnd().enter().run();
}

const turn = (k: BlockKind) => ({ editor }: { editor: Editor }) => {
  freshLine(editor);
  turnInto(editor, k);
};

/** Inserts a block-level node, with a line after it to keep typing on. */
function insertBlock(editor: Editor, content: Record<string, unknown>) {
  freshLine(editor);
  editor.chain().focus().insertContent([content, { type: 'paragraph' }]).run();
}

async function embed(editor: Editor, kind: EmbedKind, label: string) {
  const raw = await promptDialog(`${label} — paste a link`, '', 'https://');
  if (raw === null) return editor.commands.focus();
  const src = cleanUrl(raw);
  if (!src) return toast('That doesn’t look like a web link.', 'error');
  insertBlock(editor, { type: 'embed', attrs: { src, kind } });
}

const longDate = (d: Date) => d.toLocaleDateString(undefined, { dateStyle: 'long' });
const dayOffset = (n: number) => new Date(Date.now() + n * 86400000);

/** Makes a new note from the current block and leaves a link to it in its place. */
async function turnIntoPage(editor: Editor, host: SlashHost | undefined) {
  const ref = currentBlock(editor);
  if (!ref || !host) return;
  const { schema } = editor.state;
  const node = ref.node;
  const isItem = node.type.name === 'listItem' || node.type.name === 'taskItem';
  const body: readonly PMNode[] = isItem ? node.content.content : node.isTextblock ? [schema.nodes.paragraph.create(null, node.content)] : [schema.nodes.paragraph.create(null, node.textContent ? schema.text(node.textContent.split('\n')[0]) : null), node];
  const title = node.textContent.trim().split('\n')[0].slice(0, 120);
  const page = await createNote(host.folderId, { title, text: node.textContent, content: { type: 'doc', content: body.map((n) => n.toJSON()) } }, false);
  const link = schema.nodes.noteLink.create({ id: page.id, title });
  const line = schema.nodes.paragraph.create(null, link);
  // The document may have moved on while the page was made: find this very
  // block again (nodes are immutable, so an untouched block is the same object)
  // rather than replacing whatever now sits at its old position.
  let at = !editor.isDestroyed && editor.state.doc.nodeAt(ref.pos) === node ? ref.pos : -1;
  if (at < 0 && !editor.isDestroyed)
    editor.state.doc.descendants((n, pos) => {
      if (at >= 0) return false;
      if (n === node) at = pos;
    });
  if (at < 0) {
    toast('The page was made, but the block changed meanwhile, so it’s still here. Find the page in this folder.', 'info');
    return;
  }
  const replacement = isItem ? node.type.create(node.type.name === 'taskItem' ? { checked: false } : null, line) : line;
  editor.view.dispatch(editor.state.tr.replaceWith(at, at + node.nodeSize, replacement));
  toast('Turned into a page — tap the link to open it.', 'success');
}

// ------------------------------------------------------------------ the commands

const kinds: { kind: BlockKind; title: string; icon: string; aliases: string[]; hint: string; shortcut?: string; group: string }[] = [
  { kind: 'text', title: 'Text', icon: 'T', aliases: ['text', 'plain', 'paragraph', 'p'], hint: 'Just start writing with plain text.', group: 'Basic blocks' },
  { kind: 'h1', title: 'Heading 1', icon: 'H1', aliases: ['h1', '#', 'heading1', 'title'], hint: 'Big section heading.', shortcut: '#', group: 'Basic blocks' },
  { kind: 'h2', title: 'Heading 2', icon: 'H2', aliases: ['h2', '##', 'heading2'], hint: 'Medium section heading.', shortcut: '##', group: 'Basic blocks' },
  { kind: 'h3', title: 'Heading 3', icon: 'H3', aliases: ['h3', '###', 'heading3'], hint: 'Small section heading.', shortcut: '###', group: 'Basic blocks' },
  { kind: 'bullet', title: 'Bulleted list', icon: '•', aliases: ['bullet', 'bulletedlist', 'ul', 'list', '-'], hint: 'Create a simple bulleted list.', shortcut: '-', group: 'Basic blocks' },
  { kind: 'number', title: 'Numbered list', icon: '1.', aliases: ['num', 'number', 'numberedlist', 'ol', '1.'], hint: 'Create a list with numbering.', shortcut: '1.', group: 'Basic blocks' },
  { kind: 'todo', title: 'To-do list', icon: '☐', aliases: ['todo', 'to-do', 'checkbox', 'checklist', 'task', '[]'], hint: 'Track tasks with a to-do list.', shortcut: '[]', group: 'Basic blocks' },
  { kind: 'toggle', title: 'Toggle list', icon: '▸', aliases: ['toggle', 'togglelist', 'details', 'collapse', '>'], hint: 'Toggles can hide and show content inside.', shortcut: '>', group: 'Basic blocks' },
  { kind: 'quote', title: 'Quote', icon: '❝', aliases: ['quote', 'blockquote', '"'], hint: 'Capture a quote.', shortcut: '"', group: 'Basic blocks' },
  { kind: 'callout', title: 'Callout', icon: '💡', aliases: ['callout', 'note', 'info', 'aside'], hint: 'Make writing stand out.', group: 'Basic blocks' },
  { kind: 'code', title: 'Code', icon: '</>', aliases: ['code', 'codeblock', 'snippet', '```'], hint: 'Capture a code snippet.', shortcut: '```', group: 'Basic blocks' },
  { kind: 'toggleh1', title: 'Toggle heading 1', icon: '▸H1', aliases: ['toggleh1', 'toggleheading1', '>#'], hint: 'Hide content inside a large heading.', group: 'Advanced blocks' },
  { kind: 'toggleh2', title: 'Toggle heading 2', icon: '▸H2', aliases: ['toggleh2', 'toggleheading2', '>##'], hint: 'Hide content inside a medium heading.', group: 'Advanced blocks' },
  { kind: 'toggleh3', title: 'Toggle heading 3', icon: '▸H3', aliases: ['toggleh3', 'toggleheading3', '>###'], hint: 'Hide content inside a small heading.', group: 'Advanced blocks' },
];

const colorName = (c: string) => c[0].toUpperCase() + c.slice(1);

export const SLASH_ITEMS: SlashItem[] = [
  ...kinds.map(({ kind, ...k }) => ({ id: kind, ...k, run: turn(kind) })),
  { id: 'page', title: 'Page', icon: '📄', group: 'Basic blocks', aliases: ['page', 'subpage', 'newpage', 'newnote'], hint: 'Make a new note and link to it here.', run: async ({ editor, host }) => {
      if (!host) return;
      freshLine(editor);
      const page = await createNote(host.folderId, {}, false);
      editor.chain().focus().insertNoteLink({ id: page.id, title: '' }).run();
      setTimeout(() => openNote(page.id), 50);
    } },
  { id: 'table', title: 'Table', icon: '▦', group: 'Basic blocks', aliases: ['table', 'grid', 'simpletable'], hint: 'Add a simple table.', run: ({ editor }) => {
      freshLine(editor);
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    } },
  { id: 'divider', title: 'Divider', icon: '—', group: 'Basic blocks', aliases: ['div', 'divider', 'hr', 'line', 'separator', '---'], shortcut: '---', hint: 'Visually divide blocks.', run: ({ editor }) => {
      freshLine(editor);
      editor.chain().focus().setHorizontalRule().run();
    } },
  { id: 'link', title: 'Link to note', icon: '↗', group: 'Basic blocks', aliases: ['link', 'linktopage', 'linktonote'], shortcut: '[[', hint: 'Link to another note.', drill: 'link ' },

  { id: 'image', title: 'Image', icon: '🖼', group: 'Media', aliases: ['image', 'img', 'picture', 'photo'], hint: 'Upload a picture.', run: ({ editor, host }) => {
      freshLine(editor);
      host?.pickImage();
      editor.commands.focus();
    } },
  { id: 'pdf', title: 'PDF', icon: 'PDF', group: 'Media', aliases: ['pdf'], hint: 'Upload a PDF and see its first page.', run: ({ editor }) => attachFromPicker(editor, 'application/pdf,.pdf') },
  { id: 'file', title: 'File', icon: '📎', group: 'Media', aliases: ['file', 'upload', 'attach', 'attachment'], hint: 'Upload any file to keep with the note.', run: ({ editor }) => attachFromPicker(editor, '') },
  { id: 'video', title: 'Video', icon: '▶', group: 'Media', aliases: ['video', 'movie', 'clip'], hint: 'Upload a video from this device.', run: ({ editor }) => attachFromPicker(editor, 'video/*') },
  { id: 'audio', title: 'Audio', icon: '♪', group: 'Media', aliases: ['audio', 'sound', 'mp3', 'voicememo'], hint: 'Upload an audio file from this device.', run: ({ editor }) => attachFromPicker(editor, 'audio/*') },
  { id: 'videolink', title: 'Video link', icon: '▶', group: 'Media', aliases: ['videolink', 'youtube', 'vimeo', 'loom', 'embedvideo'], hint: 'Embed from YouTube, Vimeo or a video link.', run: ({ editor }) => embed(editor, 'video', 'Video') },
  { id: 'audiolink', title: 'Audio link', icon: '♪', group: 'Media', aliases: ['audiolink', 'podcast', 'embedaudio'], hint: 'Play an audio file from a web link.', run: ({ editor }) => embed(editor, 'audio', 'Audio') },
  { id: 'embed', title: 'Embed', icon: '⧉', group: 'Media', aliases: ['embed', 'iframe', 'web'], hint: 'Show a web page inside the note.', run: ({ editor }) => embed(editor, 'embed', 'Embed') },
  { id: 'bookmark', title: 'Web bookmark', icon: '🔖', group: 'Media', aliases: ['bookmark', 'webbookmark', 'url'], hint: 'Save a link as a visual card.', run: ({ editor }) => embed(editor, 'bookmark', 'Bookmark') },

  { id: 'mention', title: 'Mention a note', icon: '@', group: 'Inline', aliases: ['mention', 'mentionpage', 'mentionnote'], shortcut: '@', hint: 'Link to a note inside the sentence.', drill: 'mention ' },
  { id: 'date', title: 'Date', icon: '📅', group: 'Inline', aliases: ['date', 'today', 'now', 'remind', 'reminder'], hint: 'Insert today’s date.', run: ({ editor }) => editor.chain().focus().insertContent(longDate(new Date()) + ' ').run() },
  { id: 'emoji', title: 'Emoji', icon: '☺', group: 'Inline', aliases: ['emoji', 'emoticon', 'smiley'], shortcut: ':', hint: 'Search for an emoji to place in text.', run: ({ editor }) => editor.chain().focus().insertContent(':').run() },
  { id: 'inlinemath', title: 'Inline equation', icon: '√x', group: 'Inline', aliases: ['inlineequation', 'inlinemath', 'inlinelatex', '$'], shortcut: '$$', hint: 'Insert a maths symbol in text.', run: async ({ editor }) => {
      const v = await promptDialog('Inline equation (LaTeX)', '', 'a^2 + b^2 = c^2');
      if (v) editor.chain().focus().insertMathInline(v).run();
      else editor.commands.focus();
    } },

  { id: 'toc', title: 'Table of contents', icon: '≡', group: 'Advanced blocks', aliases: ['toc', 'tableofcontents', 'contents', 'outline'], hint: 'Show an outline of the note.', run: ({ editor }) => insertBlock(editor, { type: 'tableOfContents' }) },
  { id: 'math', title: 'Block equation', icon: 'Σ', group: 'Advanced blocks', aliases: ['math', 'equation', 'blockequation', 'tex', 'latex', 'katex', '$$'], hint: 'Display a standalone maths equation.', run: ({ editor }) => insertBlock(editor, { type: 'mathBlock', attrs: { latex: '' } }) },

  { id: 'ai', title: 'Ask AI', icon: '✦', group: 'Scrabbler', aliases: ['ai', 'ask', 'askai', 'writingtools', 'summarize', 'summarise', 'rewrite', 'proofread'], hint: 'Summarise, rewrite, explain or ask anything.', run: ({ host }) => host?.openAI() },
  { id: 'draw', title: 'Drawing', icon: '✎', group: 'Scrabbler', aliases: ['draw', 'drawing', 'sketch', 'pencil', 'ink', 'handwriting'], hint: 'Sketch with Apple Pencil.', run: ({ editor }) => {
      freshLine(editor);
      editor.chain().focus().insertDrawing({ paper: 'blank' }).run();
    } },
  { id: 'record', title: 'Record lecture', icon: '🎙', group: 'Scrabbler', aliases: ['record', 'lecture', 'mic', 'transcribe', 'voice'], hint: 'Record and transcribe into a new note.', run: ({ host }) => host && openModal({ type: 'recorder', folderId: host.folderId }) },
  { id: 'flashcards', title: 'Make flashcards', icon: '🗂', group: 'Scrabbler', aliases: ['flashcards', 'cards', 'deck', 'anki'], hint: 'Turn this note into a study deck.', run: ({ host }) => host && openModal({ type: 'generateDeck', from: { kind: 'note', noteId: host.noteId } }) },
  { id: 'quiz', title: 'Make a quiz', icon: '?', group: 'Scrabbler', aliases: ['quiz', 'test', 'exam'], hint: 'Quiz yourself on this note.', run: ({ host }) => host && openModal({ type: 'generateDeck', from: { kind: 'note', noteId: host.noteId }, quiz: true }) },
  { id: 'notebook', title: 'Open notebook', icon: '📓', group: 'Scrabbler', aliases: ['notebook', 'sources', 'addsource', 'chat', 'studio'], hint: 'Sources, chat and Studio for this folder.', run: () => nav({ notebookOpen: true }) },

  { id: 'turn', title: 'Turn into', icon: '⇄', group: 'Actions', aliases: ['turn', 'turninto', 'convert'], hint: 'Change this block’s type.', drill: 'turn' },
  { id: 'color', title: 'Colour', icon: 'A', group: 'Actions', aliases: ['color', 'colour', 'textcolor', 'background'], hint: 'Colour the text or background.', drill: 'color ' },
  { id: 'duplicate', title: 'Duplicate', icon: '⧉', group: 'Actions', aliases: ['duplicate', 'copy', 'clone'], shortcut: '⌘D', hint: 'Copy this block below itself.', run: ({ editor }) => duplicateCurrentBlock(editor) },
  { id: 'delete', title: 'Delete', icon: '🗑', group: 'Actions', aliases: ['delete', 'remove', 'del'], hint: 'Delete this block.', run: ({ editor }) => deleteCurrentBlock(editor) },
  { id: 'moveto', title: 'Move to', icon: '📁', group: 'Actions', aliases: ['moveto', 'move', 'folder'], hint: 'Move this note to another folder.', drill: 'moveto ' },
  { id: 'toggles', title: 'Open or close all toggles', icon: '▾', group: 'Actions', aliases: ['expandall', 'collapseall', 'toggleall'], shortcut: '⌘⌥T', hint: 'Expand or collapse every toggle.', run: ({ editor }) => setAllToggles(editor) },

  // Turn into… (listed once you type /turn)
  ...kinds.map(({ kind, title, icon }) => ({ id: `turn-${kind}`, title: `Turn into ${title}`, icon, group: 'Turn into', hidden: true, aliases: [`turn${kind}`, `turninto${kind}`, `turn${norm(title)}`], run: ({ editor }: { editor: Editor }) => turnInto(editor, kind) })),
  { id: 'turn-page', title: 'Turn into Page', icon: '📄', group: 'Turn into', hidden: true, aliases: ['turnpage', 'turnintopage', 'turnnote'], run: ({ editor, host }) => turnIntoPage(editor, host) },

  // Colours (listed once you type /red, /blue background, /color…)
  { id: 'color-default', title: 'Default', icon: 'A', group: 'Colour', hidden: true, swatch: { color: 'default' }, aliases: ['default', 'defaultcolor', 'colordefault', 'colourdefault'], run: ({ editor }) => colorBlock(editor, 'color', null) },
  ...BLOCK_COLORS.map((c) => ({ id: `color-${c}`, title: colorName(c), icon: 'A', group: 'Colour', hidden: true, swatch: { color: c }, aliases: [c, `color${c}`, `colour${c}`, `${c}text`], run: ({ editor }: { editor: Editor }) => colorBlock(editor, 'color', c) })),
  { id: 'bg-default', title: 'Default background', icon: 'A', group: 'Colour', hidden: true, swatch: { bg: 'default' }, aliases: ['defaultbackground', 'colordefaultbackground', 'nobackground'], run: ({ editor }) => colorBlock(editor, 'background', null) },
  ...BLOCK_COLORS.map((c) => ({ id: `bg-${c}`, title: `${colorName(c)} background`, icon: 'A', group: 'Colour', hidden: true, swatch: { bg: c }, aliases: [`${c}background`, `${c}bg`, `color${c}background`, `colour${c}background`], run: ({ editor }: { editor: Editor }) => colorBlock(editor, 'background', c) })),
];

// ------------------------------------------------------------------ notes, folders, emoji, dates

export async function recentNotes(exclude?: string, limit = 400): Promise<Note[]> {
  const all = await db.notes.orderBy('updatedAt').reverse().limit(limit).toArray();
  return all.filter((n) => !n.deletedAt && n.id !== exclude);
}

const noteTitle = (n: Note) => n.title.trim() || (n.kind === 'ink' ? 'Handwritten note' : 'Untitled');
const noteIcon = (n: Note) => (n.kind === 'ink' ? '✎' : n.kind === 'lecture' ? '🎙' : '📄');

/** Everything the / menu can offer for a query, notes and folders included. */
export async function slashItems(query: string, editor: Editor): Promise<SlashItem[]> {
  const q = norm(query);
  const host = getSlashHost(editor);
  let items = SLASH_ITEMS;
  if (q.startsWith('link') || q.startsWith('mention')) {
    const notes = (await recentNotes(host?.noteId)).slice(0, 200);
    items = items.concat(
      notes.map((n) => ({
        id: `note-${n.id}`,
        title: noteTitle(n),
        icon: noteIcon(n),
        group: 'Link to note',
        hidden: true,
        aliases: [`link${norm(noteTitle(n))}`, `mention${norm(noteTitle(n))}`],
        run: ({ editor }: { editor: Editor }) => editor.chain().focus().insertNoteLink({ id: n.id, title: noteTitle(n) }).run(),
      })),
    );
  }
  if (q.startsWith('move')) {
    const folders = await db.folders.orderBy('order').toArray();
    const here = host ? (await db.notes.get(host.noteId))?.folderId : undefined;
    items = items.concat(
      folders
        .filter((f) => f.id !== here)
        .map((f) => ({
          id: `folder-${f.id}`,
          title: `${f.emoji} ${f.name}`,
          icon: '📁',
          group: 'Move to',
          hidden: true,
          aliases: [`moveto${norm(f.name)}`, `move${norm(f.name)}`],
          run: async () => {
            if (!host) return;
            await db.notes.update(host.noteId, { folderId: f.id });
            toast(`Moved to ${f.name}`, 'success');
          },
        })),
    );
  }
  const ranked = rankItems(items, query);
  return q ? ranked.slice(0, 40) : ranked;
}

/** The @ menu: notes to mention, and Notion's @today / @tomorrow / @now dates. */
export async function mentionItems(query: string, editor: Editor): Promise<SlashItem[]> {
  const host = getSlashHost(editor);
  const notes = await recentNotes(host?.noteId);
  const dates: SlashItem[] = [
    { id: 'today', title: 'Today', hint: longDate(new Date()), icon: '📅', group: 'Date', aliases: ['today'], run: ({ editor }) => editor.chain().focus().insertContent(longDate(new Date()) + ' ').run() },
    { id: 'tomorrow', title: 'Tomorrow', hint: longDate(dayOffset(1)), icon: '📅', group: 'Date', aliases: ['tomorrow'], run: ({ editor }) => editor.chain().focus().insertContent(longDate(dayOffset(1)) + ' ').run() },
    { id: 'yesterday', title: 'Yesterday', hint: longDate(dayOffset(-1)), icon: '📅', group: 'Date', aliases: ['yesterday'], run: ({ editor }) => editor.chain().focus().insertContent(longDate(dayOffset(-1)) + ' ').run() },
    { id: 'now', title: 'Now', hint: new Date().toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' }), icon: '🕑', group: 'Date', aliases: ['now', 'time'], run: ({ editor }) => editor.chain().focus().insertContent(new Date().toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' }) + ' ').run() },
  ];
  const noteItems: SlashItem[] = notes.map((n) => ({
    id: `note-${n.id}`,
    title: noteTitle(n),
    icon: noteIcon(n),
    group: 'Notes',
    aliases: [],
    run: ({ editor }) => editor.chain().focus().insertNoteLink({ id: n.id, title: noteTitle(n) }).run(),
  }));
  if (!query) return [...noteItems.slice(0, 6), ...dates];
  return rankItems([...noteItems, ...dates], query).slice(0, 12);
}

/** The [[ menu: link a note, or make a new one with the typed title. */
export async function linkItems(query: string, editor: Editor): Promise<SlashItem[]> {
  const host = getSlashHost(editor);
  const notes = await recentNotes(host?.noteId);
  const items: SlashItem[] = notes.map((n) => ({
    id: `note-${n.id}`,
    title: noteTitle(n),
    icon: noteIcon(n),
    group: 'Link to note',
    aliases: [],
    run: ({ editor }) => editor.chain().focus().insertNoteLink({ id: n.id, title: noteTitle(n) }).run(),
  }));
  const title = query.replace(/\]+$/, '').trim();
  const ranked = title ? rankItems(items, title).slice(0, 10) : items.slice(0, 8);
  if (title && host)
    ranked.push({
      id: 'new-page',
      title: `New note “${title}”`,
      icon: '+',
      group: 'Link to note',
      aliases: [],
      run: async ({ editor }) => {
        const page = await createNote(host.folderId, { title, text: title, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }] } }, false);
        editor.chain().focus().insertNoteLink({ id: page.id, title }).run();
      },
    });
  return ranked;
}

/** The : menu (Notion's inline emoji search). */
export function emojiItems(query: string): SlashItem[] {
  const items: SlashItem[] = EMOJI.map(([e, words]) => ({
    id: e,
    title: words.split(' ')[0],
    hint: undefined,
    icon: e,
    aliases: words.split(' '),
    run: ({ editor }) => editor.chain().focus().insertContent(e).run(),
  }));
  if (!query) return items.slice(0, 24);
  if (query.length < 2) return [];
  return rankItems(items, query).slice(0, 24);
}
