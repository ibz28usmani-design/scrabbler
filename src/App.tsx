import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { db, deleteNotesForever } from './db';
import { closeModal, nav, setSidebarInline, useNav } from './lib/nav';
import { useApplyTheme } from './lib/theme';
import { restoreNote } from './lib/notes';
import { hasTextKey } from './lib/llm';
import { Sidebar } from './components/Sidebar';
import { NoteList } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import { InkEditor } from './components/InkEditor';
import { FocusChrome, useFocusShortcuts } from './components/FocusMode';
import { NotebookPanel, SourceViewer } from './components/NotebookPanel';
import { StudyView } from './components/StudyView';
import { Recorder } from './components/Recorder';
import { SettingsModal } from './components/SettingsModal';
import { GenerateDeckDialog, ImportDeckDialog } from './components/DeckDialogs';
import { ConfirmHost, Empty, ErrorBoundary, PromptHost, Toasts, useMediaQuery } from './components/ui';
import { ICompose, ISparkle } from './components/Icons';
import { createNote } from './lib/notes';
import { mdToHtml } from './lib/markdown';

export default function App() {
  useApplyTheme();
  useFocusShortcuts();
  const s = useNav();
  const narrow = useMediaQuery('(max-width: 699px)');
  const wide = useMediaQuery('(min-width: 1100px)');
  const xwide = useMediaQuery('(min-width: 1440px)');
  const roomy = useMediaQuery('(min-width: 1250px)');
  const folders = useLiveQuery(() => db.folders.orderBy('order').toArray(), []);
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

  const isStudy = s.view === 'study';
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
            note.kind === 'ink' ? (
              <InkEditor key={note.id} note={note} narrow={narrow && !focus} wide={focus || showSidebar || showList} />
            ) : (
              <NoteEditor key={note.id} note={note} narrow={narrow && !focus} wide={focus || showSidebar || showList} />
            )
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
          <ErrorBoundary label="Study">
            <StudyView narrow={narrow} showSidebarToggle={!showSidebar} />
          </ErrorBoundary>
        </main>
      )}
      {notebookDocked && (
        <ErrorBoundary label="the notebook">
          <NotebookPanel folderId={notebookFolder!} overlay={false} />
        </ErrorBoundary>
      )}
      {notebookOverlay && (
        <div className="drawer-backdrop right" onClick={() => nav({ notebookOpen: false })}>
          <div className="drawer right" onClick={(e) => e.stopPropagation()}>
            <ErrorBoundary label="the notebook">
              <NotebookPanel folderId={notebookFolder!} overlay />
            </ErrorBoundary>
          </div>
        </div>
      )}

      {focus && <FocusChrome folderId={notebookFolder ?? null} />}

      {s.modal?.type === 'settings' && <SettingsModal />}
      {s.modal?.type === 'recorder' && <Recorder folderId={s.modal.folderId} />}
      {s.modal?.type === 'generateDeck' && <GenerateDeckDialog from={s.modal.from} quiz={s.modal.quiz} />}
      {s.modal?.type === 'importDeck' && <ImportDeckDialog />}
      {s.modal?.type === 'source' && <SourceViewer sourceId={s.modal.sourceId} chunkId={s.modal.chunkId} onClose={closeModal} />}
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
