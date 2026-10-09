import StarterKit from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import { Highlight } from '@tiptap/extension-highlight';
import { Image } from '@tiptap/extension-image';
import { TextAlign } from '@tiptap/extension-text-align';
import { Drawing } from './DrawingNode';

/** The typed-note schema, shared by the editor and the exporters. */
export const editorExtensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit.configure({ table: { resizable: false } }),
  Highlight.configure({ multicolor: true }),
  Image.configure({ allowBase64: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Drawing,
];
