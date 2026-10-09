import { useSyncExternalStore } from 'react';

export type View = 'folder' | 'search' | 'deleted' | 'study';
export type NotebookTab = 'sources' | 'chat' | 'studio';
export type Pane = 'sidebar' | 'list' | 'editor';

export type ModalState =
  | null
  | { type: 'settings' }
  | { type: 'recorder'; folderId: string }
  | { type: 'generateDeck'; from: { kind: 'note'; noteId: string } | { kind: 'folder'; folderId: string } | { kind: 'text' }; quiz?: boolean }
  | { type: 'importDeck' }
  | { type: 'source'; sourceId: string; chunkId?: string };

export interface NavState {
  view: View;
  folderId: string | null;
  noteId: string | null;
  query: string;
  notebookOpen: boolean;
  notebookTab: NotebookTab;
  pane: Pane;
  sidebarOpen: boolean;
  /** Sidebar shown as a slide-over drawer (when it can't sit inline). */
  drawer: boolean;
  modal: ModalState;
  deckId: string | null;
  session: null | { deckIds: string[]; mode: 'study' | 'quiz' };
}

const KEY = 'scrabbler.nav';

function initial(): NavState {
  let saved: Partial<NavState> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    /* ignore */
  }
  return {
    view: saved.view === 'study' ? 'study' : 'folder',
    folderId: saved.folderId ?? null,
    noteId: saved.noteId ?? null,
    query: '',
    notebookOpen: saved.notebookOpen ?? false,
    notebookTab: saved.notebookTab ?? 'sources',
    pane: 'list',
    sidebarOpen: saved.sidebarOpen ?? true,
    drawer: false,
    modal: null,
    deckId: null,
    session: null,
  };
}

let state = initial();
const listeners = new Set<() => void>();

export function nav(patch: Partial<NavState> | ((s: NavState) => Partial<NavState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  try {
    const { view, folderId, noteId, notebookOpen, notebookTab, sidebarOpen } = state;
    localStorage.setItem(KEY, JSON.stringify({ view, folderId, noteId, notebookOpen, notebookTab, sidebarOpen }));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function getNav() {
  return state;
}

export function useNav(): NavState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export const openModal = (modal: ModalState) => nav({ modal });
export const closeModal = () => nav({ modal: null });

let sidebarInline = true;

/** Called by the layout so toggles know whether the sidebar is inline or a drawer. */
export function setSidebarInline(v: boolean) {
  sidebarInline = v;
}

export function toggleSidebar() {
  if (sidebarInline) nav((s) => ({ sidebarOpen: !s.sidebarOpen }));
  else nav((s) => ({ drawer: !s.drawer }));
}
