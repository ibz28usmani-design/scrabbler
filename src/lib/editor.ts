/** The rich-text editor's extensions, shared by the note editor and the importers. */
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { Mathematics } from '@tiptap/extension-mathematics';

let active: Editor | null = null;
export const setActiveEditor = (e: Editor | null) => { active = e; };
/** Tap an equation to edit its LaTeX; clear it to delete the equation. */
const editMath = (block: boolean) => (node: any, pos: number) => {
  const latex = prompt('Edit equation (LaTeX). Clear it to delete.', node.attrs.latex);
  if (latex === null || !active) return;
  const c = active.chain().setNodeSelection(pos);
  if (block) (latex ? c.updateBlockMath({ latex, pos }) : c.deleteBlockMath({ pos })).run();
  else (latex ? c.updateInlineMath({ latex, pos }) : c.deleteInlineMath({ pos })).run();
};
export const EXT = [
  StarterKit.configure({ link: { openOnClick: false } }), TaskList, TaskItem.configure({ nested: true }), TableKit,
  Highlight.configure({ multicolor: true }), Image.configure({ allowBase64: true }), TextAlign.configure({ types: ['heading', 'paragraph'] }), TextStyleKit,
  Mathematics.configure({ inlineOptions: { onClick: editMath(false) }, blockOptions: { onClick: editMath(true) }, katexOptions: { throwOnError: false } }),
];
