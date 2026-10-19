import { useSyncExternalStore } from 'react';

export type View = 'folder' | 'search' | 'deleted' | 'today' | 'study' | 'calendar' | 'reminders' | 'graph' | 'revision' | 'tutor';

/** Views that fill the main area on their own, without the note list and editor. */
export const PAGE_VIEWS: View[] = ['today', 'study', 'calendar', 'reminders', 'graph', 'revision', 'tutor'];

/** The three parts of Study, one place with tabs between them. */
export const STUDY_VIEWS = ['revision', 'study', 'tutor'] as const;
export type StudyTab = (typeof STUDY_VIEWS)[number];
export type NotebookTab = 'sources' | 'chat' | 'studio';
export type Pane = 'sidebar' | 'list' | 'editor';

export type ModalState =
  | null
  | { type: 'settings' }
  | { type: 'recorder'; folderId: string }
  | { type: 'generateDeck'; from: { kind: 'note'; noteId: string } | { kind: 'folder'; folderId: string } | { kind: 'text'; title?: string; text?: string }; quiz?: boolean }
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
  /** Full-screen writing: side panels retract and float over the page on demand. */
  focus: boolean;
  focusPanel: null | 'library' | 'notebook';
  modal: ModalState;
  deckId: string | null;
  session: null | { deckIds: string[]; mode: 'study' | 'quiz' };
  /** The note the graph centres on (its local graph); null for the whole vault. */
  graphFocus: string | null;
}

const KEY = 'scrabbler.nav';

function initial(): NavState {
  let saved: Partial<NavState> | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    /* ignore */
  }
  // A first launch opens on Today; after that, wherever you left off.
  const first = !saved;
  saved ??= {};
  return {
    view: saved.view && PAGE_VIEWS.includes(saved.view) ? saved.view : first ? 'today' : 'folder',
    folderId: saved.folderId ?? null,
    noteId: saved.noteId ?? null,
    query: '',
    notebookOpen: saved.notebookOpen ?? false,
    notebookTab: saved.notebookTab ?? 'sources',
    pane: 'list',
    sidebarOpen: saved.sidebarOpen ?? true,
    drawer: false,
    focus: false,
    focusPanel: null,
    modal: null,
    deckId: null,
    session: null,
    graphFocus: null,
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

let lastStudy: StudyTab = 'revision';
try {
  const v = localStorage.getItem('scrabbler.lastStudy');
  if ((STUDY_VIEWS as readonly string[]).includes(v ?? '')) lastStudy = v as StudyTab;
} catch {
  /* ignore */
}

/** Opens Study on whichever of its tabs was used last. */
export function openStudy(tab?: StudyTab) {
  const view = tab ?? lastStudy;
  nav({ view, pane: 'list', drawer: false, ...(view === 'study' ? { deckId: null, session: null } : {}) });
}

export function lastStudyTab(): StudyTab {
  return lastStudy;
}

export function rememberStudyTab(tab: StudyTab) {
  lastStudy = tab;
  try {
    localStorage.setItem('scrabbler.lastStudy', tab);
  } catch {
    /* ignore */
  }
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
