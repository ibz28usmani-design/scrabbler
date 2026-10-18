import { useEffect, useRef } from 'react';
import type { StudyActivity } from '../db';
import { closeAuto, touchStudy } from './studyTime';

/** One touch per this long is plenty: a session only needs to know you're still there. */
const EVERY_MS = 10_000;

/**
 * Counts this screen's time toward a subject while you're actually using it:
 * any tap, keystroke, stroke or scroll keeps the session going, and it stops
 * by itself once you've been idle a couple of minutes (see lib/studyTime.ts).
 */
export function useStudyPresence(activity: StudyActivity, where: { folderId?: string; subjectId?: string } | null) {
  const latest = useRef({ activity, where });
  latest.current = { activity, where };
  useEffect(() => {
    let last = 0;
    const touch = () => {
      const { activity: a, where: w } = latest.current;
      const now = Date.now();
      if (!w || now - last < EVERY_MS) return;
      last = now;
      void touchStudy(a, w, now);
    };
    const onHide = () => document.visibilityState === 'hidden' && void closeAuto();
    const events = ['pointerdown', 'keydown', 'wheel', 'touchmove'] as const;
    events.forEach((ev) => window.addEventListener(ev, touch, { capture: true, passive: true }));
    window.addEventListener('scroll', touch, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onHide);
    touch();
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, touch, { capture: true }));
      window.removeEventListener('scroll', touch, { capture: true });
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [where?.folderId, where?.subjectId]);
}
