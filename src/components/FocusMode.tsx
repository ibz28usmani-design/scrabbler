import { useEffect } from 'react';
import { nav, useNav } from '../lib/nav';
import { Sidebar } from './Sidebar';
import { NoteList } from './NoteList';
import { NotebookPanel } from './NotebookPanel';
import { ErrorBoundary } from './ui';
import { IBook, IExpand, IShrink, ISidebar } from './Icons';

/**
 * Full-screen focus: the page fills the screen and the side panels retract.
 * They return as floating "liquid glass" panels — translucent, blurred, springing
 * in from the edges — when you tap a handle, hover the screen edge, or use ⌘\ / ⌘⇧N.
 */

function enterFullscreen() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  // Home Screen apps are already full screen; browsers may refuse, which is fine.
  try {
    if (!document.fullscreenElement && !window.matchMedia('(display-mode: standalone)').matches) {
      const p = el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.();
      (p as Promise<void> | undefined)?.catch?.(() => {});
    }
  } catch {
    /* unsupported */
  }
}

function exitFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch {
    /* unsupported */
  }
}

export function setFocus(on: boolean) {
  nav({ focus: on, focusPanel: null, drawer: false });
  if (on) enterFullscreen();
  else exitFullscreen();
}

export function FocusButton() {
  const { focus } = useNav();
  return (
    <button
      className={`icon-btn ${focus ? 'on' : ''}`}
      onClick={() => setFocus(!focus)}
      aria-label={focus ? 'Exit full screen' : 'Full screen'}
      title={focus ? 'Exit full screen (Esc)' : 'Full screen (⌘⇧F)'}
    >
      {focus ? <IShrink /> : <IExpand />}
    </button>
  );
}

/** Global shortcuts for focus mode. */
export function useFocusShortcuts() {
  const { focus, focusPanel } = useNav();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFocus(!focus);
      }
      if (!focus) return;
      if (e.key === 'Escape') {
        if (document.querySelector('.modal-backdrop, .menu')) return;
        if (focusPanel) nav({ focusPanel: null });
        else setFocus(false);
      }
      if (mod && e.key === '\\') {
        e.preventDefault();
        nav({ focusPanel: focusPanel === 'library' ? null : 'library' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, focusPanel]);

  // Leaving browser full screen (e.g. the Esc key handled by the browser) leaves focus too.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && focus && window.matchMedia('(display-mode: browser)').matches) nav({ focus: false, focusPanel: null });
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [focus]);
}

/** Floating panels and edge handles shown while in focus mode. */
export function FocusChrome({ folderId }: { folderId: string | null }) {
  const { focusPanel } = useNav();
  const open = (p: 'library' | 'notebook') => nav({ focusPanel: focusPanel === p ? null : p });
  return (
    <>
      {/* Hover the screen edge with a mouse, trackpad or Pencil to peek a panel. */}
      <div className="edge-zone left" onPointerEnter={(e) => e.pointerType !== 'touch' && !focusPanel && nav({ focusPanel: 'library' })} />
      <div className="edge-zone right" onPointerEnter={(e) => e.pointerType !== 'touch' && !focusPanel && folderId && nav({ focusPanel: 'notebook' })} />

      <button className={`edge-handle glass left ${focusPanel === 'library' ? 'hidden' : ''}`} onClick={() => open('library')} aria-label="Show folders and notes">
        <ISidebar size={18} />
      </button>
      {folderId && (
        <button className={`edge-handle glass right ${focusPanel === 'notebook' ? 'hidden' : ''}`} onClick={() => open('notebook')} aria-label="Show notebook">
          <IBook size={18} />
        </button>
      )}

      {focusPanel && <div className="glass-scrim" onPointerDown={() => nav({ focusPanel: null })} />}

      <aside className={`glass-panel glass left ${focusPanel === 'library' ? 'open' : ''}`} aria-hidden={focusPanel !== 'library'} inert={focusPanel !== 'library' ? true : undefined}>
        <ErrorBoundary label="the sidebar">
          <Sidebar />
        </ErrorBoundary>
        <ErrorBoundary label="the note list">
          <NoteList narrow={false} showSidebarToggle={false} />
        </ErrorBoundary>
      </aside>
      {folderId && (
        <aside className={`glass-panel glass right ${focusPanel === 'notebook' ? 'open' : ''}`} aria-hidden={focusPanel !== 'notebook'} inert={focusPanel !== 'notebook' ? true : undefined}>
          {focusPanel === 'notebook' && (
            <ErrorBoundary label="the notebook">
              <NotebookPanel folderId={folderId} overlay />
            </ErrorBoundary>
          )}
        </aside>
      )}
    </>
  );
}
