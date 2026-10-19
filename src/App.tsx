import { useLiveQuery } from 'dexie-react-hooks';
import { Suspense, useEffect } from 'react';
import { db, deleteNotesForever } from './db';
import { closeModal, nav, PAGE_VIEWS, setSidebarInline, useNav } from './lib/nav';
import { usePushSync } from './lib/calendarData';
import { useApplyTheme } from './lib/theme';
import { restoreNote } from './lib/notes';
import { hasTextKey } from './lib/llm';
import { Sidebar } from './components/Sidebar';
import { NoteList } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import { FocusChrome, useFocusShortcuts } from './components/FocusMode';
import { TimerChip, useTimerEngine } from './components/RevisionTimer';
import { ConfirmHost, confirmDialog, Empty, ErrorBoundary, PromptHost, Spinner, Toasts, useMediaQuery } from './components/ui';
import { lazyNamed } from './lib/lazy';

// Each page loads the first time it is opened, so the app starts on the notes alone.
const CalendarView = lazyNamed(() => import('./components/CalendarView'), 'CalendarView');
const RemindersView = lazyNamed(() => import('./components/RemindersView'), 'RemindersView');
const RevisionView = lazyNamed(() => import('./components/RevisionView'), 'RevisionView');
const GraphView = lazyNamed(() => import('./components/GraphView'), 'GraphView');
const TutorView = lazyNamed(() => import('./components/TutorView'), 'TutorView');
const StudyView = lazyNamed(() => import('./components/StudyView'), 'StudyView');
const NotebookPanel = lazyNamed(() => import('./components/NotebookPanel'), 'NotebookPanel');
const SourceViewer = lazyNamed(() => import('./components/NotebookPanel'), 'SourceViewer');
const SettingsModal = lazyNamed(() => import('./components/SettingsModal'), 'SettingsModal');
const Recorder = lazyNamed(() => import('./components/Recorder'), 'Recorder');
const GenerateDeckDialog = lazyNamed(() => import('./components/DeckDialogs'), 'GenerateDeckDialog');
const ImportDeckDialog = lazyNamed(() => import('./components/DeckDialogs'), 'ImportDeckDialog');

function Loading() {
  return (
    <div className="page-loading" role="status" aria-label="Loading">
      <Spinner size={22} />
    </div>
  );
}
import { ICompose, ISparkle } from './components/Icons';
import { createNote } from './lib/notes';
import { mdToHtml } from './lib/markdown';
import { SafetyBanner } from './components/SafetyBanner';

const PAGE_LABEL: Partial<Record<string, string>> = { calendar: 'Calendar', reminders: 'Reminders', revision: 'Revision', graph: 'the graph', tutor: 'the tutor' };

export default function App() {
  useApplyTheme();
  useFocusShortcuts();
  useTimerEngine();
  const s = useNav();
  const narrow = useMediaQuery('(max-width: 699px)');
  const wide = useMediaQuery('(min-width: 1100px)');
  const xwide = useMediaQuery('(min-width: 1440px)');
  const roomy = useMediaQuery('(min-width: 1250px)');
  const folders = useLiveQuery(() => db.folders.orderBy('order').toArray(), []);
  usePushSync();

  // A tapped notification opens the calendar or reminders (?open=… on launch, a message if already open).
  useEffect(() => {
    const open = (url: string) => {
      const view = new URL(url, location.href).searchParams.get('open');
      if (view === 'calendar' || view === 'reminders') nav({ view, pane: 'list', drawer: false });
    };
    open(location.href);
    if (location.search.includes('open=')) history.replaceState(null, '', location.pathname + location.hash);
    const onMsg = (e: MessageEvent) => e.data?.type === 'scrabbler-open' && open(e.data.url);
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, []);
  const note = useLiveQuery(() => (s.noteId ? db.notes.get(s.noteId) : undefined), [s.noteId]);

  // Keep the selected folder valid.
  useEffect(() => {
    if (!folders?.length) return;
    if (!s.folderId || !folders.some((f) => f.id === s.folderId)) nav({ folderId: folders[0].id });
  }, [folders, s.folderId]);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'n' && s.folderId) {
        e.preventDefault();
        createNote(s.folderId);
      }
      if (mod && e.key === ',') {
        e.preventDefault();
        nav({ modal: { type: 'settings' } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.folderId]);

  if (!folders) return null;

  // Study, Calendar and Reminders each fill the main area on their own.
  const isStudy = PAGE_VIEWS.includes(s.view);
  const notebookFolder = note?.folderId ?? s.folderId;
  // Full-screen focus: only the page stays; panels float in on demand (FocusChrome).
  const focus = s.focus && !isStudy && !!note && !note.deletedAt;
  // On iPad landscape the notebook docks beside the editor and the side panes fold away.
  const notebookDocked = !focus && s.notebookOpen && wide && !isStudy && !!notebookFolder;
  const notebookOverlay = !focus && s.notebookOpen && !notebookDocked && !isStudy && !!notebookFolder;
  const canInline = wide && (!notebookDocked || xwide);
  setSidebarInline(canInline);
  const showSidebar = !focus && (narrow ? s.pane === 'sidebar' : canInline && s.sidebarOpen);
  const sidebarOverlay = !focus && !narrow && !showSidebar && s.drawer;

  const showList = !focus && !isStudy && (narrow ? s.pane === 'list' : !notebookDocked || roomy);
  const showEditor = focus || (!isStudy && (narrow ? s.pane === 'editor' : true));
  const showStudy = isStudy && (narrow ? s.pane !== 'sidebar' : true);

  return (
    <div className={`app ${narrow ? 'narrow' : wide ? 'wide' : 'medium'}${focus ? ' focus' : ''}`}>
      {showSidebar && (
        <ErrorBoundary label="the sidebar">
          <Sidebar />
        </ErrorBoundary>
      )}
      {sidebarOverlay && (
        <div className="drawer-backdrop" onClick={() => nav({ drawer: false })}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <Sidebar />
          </div>
        </div>
      )}
      {showList && (
        <ErrorBoundary label="the note list">
          <NoteList narrow={narrow} showSidebarToggle={!showSidebar} />
        </ErrorBoundary>
      )}
      {showEditor && (
        <main className="main">
          <ErrorBoundary label="the editor" key={s.noteId ?? 'none'}>
          {note && !note.deletedAt ? (
            <NoteEditor key={note.id} note={note} narrow={narrow && !focus} wide={focus || showSidebar || showList} />
          ) : note?.deletedAt ? (
            <DeletedPreview id={note.id} title={note.title} text={note.text} />
          ) : (
            <div className="editor-empty">
              <Empty icon={<ICompose size={34} />} title="No note selected">
                Pick a note, or create one.
                <div className="empty-actions">
                  {s.folderId && (
                    <button className="btn primary" onClick={() => createNote(s.folderId!)}>
                      New note
                    </button>
                  )}
                  {!hasTextKey() && (
                    <button className="btn" onClick={() => nav({ modal: { type: 'settings' } })}>
                      <ISparkle size={16} /> Set up free AI
                    </button>
                  )}
                </div>
              </Empty>
            </div>
          )}
          </ErrorBoundary>
        </main>
      )}
      {showStudy && (
        <main className="main study-main">
          <ErrorBoundary label={PAGE_LABEL[s.view] ?? 'Study'} key={s.view}>
            <Suspense fallback={<Loading />}>
            {s.view === 'calendar' ? (
              <CalendarView narrow={narrow} showSidebarToggle={!showSidebar} />
            ) : s.view === 'reminders' ? (
              <RemindersView narrow={narrow} showSidebarToggle={!showSidebar} />
            ) : s.view === 'revision' ? (
              <RevisionView narrow={narrow} showSidebarToggle={!showSidebar} />
            ) : s.view === 'graph' ? (
              <GraphView narrow={narrow} showSidebarToggle={!showSidebar} />
            ) : s.view === 'tutor' ? (
              <TutorView narrow={narrow} showSidebarToggle={!showSidebar} />
            ) : (
              <StudyView narrow={narrow} showSidebarToggle={!showSidebar} />
            )}
            </Suspense>
          </ErrorBoundary>
        </main>
      )}
      {notebookDocked && (
        <ErrorBoundary label="the notebook">
          <Suspense fallback={<Loading />}>
            <NotebookPanel folderId={notebookFolder!} overlay={false} />
          </Suspense>
        </ErrorBoundary>
      )}
      {notebookOverlay && (
        <div className="drawer-backdrop right" onClick={() => nav({ notebookOpen: false })}>
          <div className="drawer right" onClick={(e) => e.stopPropagation()}>
            <ErrorBoundary label="the notebook">
              <Suspense fallback={<Loading />}>
                <NotebookPanel folderId={notebookFolder!} overlay />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      )}

      {focus && <FocusChrome folderId={notebookFolder ?? null} />}

      <Suspense fallback={null}>
        {s.modal?.type === 'settings' && <SettingsModal />}
        {s.modal?.type === 'recorder' && <Recorder folderId={s.modal.folderId} />}
        {s.modal?.type === 'generateDeck' && <GenerateDeckDialog from={s.modal.from} quiz={s.modal.quiz} />}
        {s.modal?.type === 'importDeck' && <ImportDeckDialog />}
        {s.modal?.type === 'source' && <SourceViewer sourceId={s.modal.sourceId} chunkId={s.modal.chunkId} onClose={closeModal} />}
      </Suspense>
      <TimerChip />
      <SafetyBanner />
      <Toasts />
      <ConfirmHost />
      <PromptHost />
    </div>
  );
}

function DeletedPreview({ id, title, text }: { id: string; title: string; text: string }) {
  return (
    <div className="deleted-preview">
      <div className="deleted-banner">
        This note is in Recently Deleted.
        <button className="btn small primary" onClick={() => restoreNote(id)}>
          Recover
        </button>
        <button
          className="btn small danger"
          onClick={async () => {
            if (!(await confirmDialog('Delete this note for good? This can’t be undone.', 'Delete permanently'))) return;
            await deleteNotesForever([id]);
            nav({ noteId: null });
          }}
        >
          Delete permanently
        </button>
      </div>
      <div className="editor-scroll">
        <div className="prose md" dangerouslySetInnerHTML={{ __html: mdToHtml(`# ${title}\n\n${text.split('\n').slice(1).join('\n\n')}`) }} />
      </div>
    </div>
  );
}
