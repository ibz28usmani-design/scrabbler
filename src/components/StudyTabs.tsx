import { useEffect } from 'react';
import { openStudy, rememberStudyTab, STUDY_VIEWS, useNav, type StudyTab } from '../lib/nav';
import { isHidden } from '../lib/usage';
import { useSettings } from '../lib/settings';

const LABEL: Record<StudyTab, string> = { revision: 'Revision', study: 'Flashcards', tutor: 'Tutor' };

/** Revision, flashcards and the tutor share subjects and weak spots: one place, with tabs between them. */
export function StudyTabs() {
  const { view, session } = useNav();
  const { hiddenFeatures } = useSettings();
  const tabs = STUDY_VIEWS.filter((t) => t === view || !isHidden(t, hiddenFeatures));
  useEffect(() => {
    if ((STUDY_VIEWS as readonly string[]).includes(view)) rememberStudyTab(view as StudyTab);
  }, [view]);
  // A flashcard session has the whole screen.
  if (session || tabs.length < 2) return null;
  return (
    <nav className="study-tabs" aria-label="Study">
      {tabs.map((t) => (
        <button key={t} className={`study-tab ${view === t ? 'on' : ''}`} aria-current={view === t ? 'page' : undefined} onClick={() => openStudy(t)}>
          {LABEL[t]}
        </button>
      ))}
    </nav>
  );
}
