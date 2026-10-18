import { createContext, useContext } from 'react';
import type { Paper } from './paper';

/** What blocks inside a note's text need to know about the note around them. */
export interface NoteContextValue {
  noteId: string;
  folderId: string;
  title: string;
  /** The note's paper; sketches without one of their own use it. */
  paper: Paper;
}

export const NoteContext = createContext<NoteContextValue | null>(null);

export const useNoteContext = () => useContext(NoteContext);
