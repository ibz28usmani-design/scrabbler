import type { Editor } from '@tiptap/core';

/** What the / menu and note blocks need from the screen showing the note. */
export interface SlashHost {
  noteId: string;
  folderId: string;
  pickImage: () => void;
  openAI: () => void;
}

const hosts = new WeakMap<Editor, SlashHost>();
export const setSlashHost = (editor: Editor, host: SlashHost) => hosts.set(editor, host);
export const getSlashHost = (editor: Editor) => hosts.get(editor);
