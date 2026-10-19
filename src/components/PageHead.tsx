import type { ReactNode } from 'react';
import { nav, toggleSidebar } from '../lib/nav';
import { IChevL, ISidebar } from './Icons';

/** The head of a full-page view: the way back on a phone, the title, then actions. */
export function PageHead({ title, narrow, showSidebarToggle, children }: { title: ReactNode; narrow: boolean; showSidebarToggle: boolean; children?: ReactNode }) {
  return (
    <div className="study-head">
      {narrow ? (
        <button aria-label="Folders" className="icon-btn accent" onClick={() => nav({ pane: 'sidebar' })}>
          <IChevL /> <span className="back-label">Folders</span>
        </button>
      ) : (
        showSidebarToggle && (
          <button className="icon-btn" onClick={toggleSidebar} aria-label="Toggle sidebar">
            <ISidebar />
          </button>
        )
      )}
      <h1>{title}</h1>
      <span className="spacer" />
      {children}
    </div>
  );
}
