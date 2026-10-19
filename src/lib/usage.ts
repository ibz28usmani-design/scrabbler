/**
 * Which parts of the app get used. Counted on this device only, never sent
 * anywhere: Settings shows when each was last opened and suggests hiding what
 * hasn't been touched in a month, so the sidebar and Studio carry what you use.
 */
import { useSyncExternalStore } from 'react';
import { getSettings, updateSettings } from './settings';

export type Feature =
  | 'today'
  | 'revision'
  | 'tutor'
  | 'study'
  | 'calendar'
  | 'reminders'
  | 'graph'
  | 'notebook'
  | 'lecture'
  | 'studio:podcast'
  | 'studio:briefing'
  | 'studio:studyguide'
  | 'studio:mindmap'
  | 'studio:faq'
  | 'studio:timeline'
  | 'studio:cheatsheet';

export interface FeatureInfo {
  id: Feature;
  label: string;
  where: 'sidebar' | 'studio' | 'other';
  /** Can be hidden; the notes themselves always stay. */
  hideable: boolean;
}

export const FEATURES: FeatureInfo[] = [
  { id: 'today', label: 'Today', where: 'sidebar', hideable: true },
  { id: 'revision', label: 'Revision', where: 'sidebar', hideable: true },
  { id: 'study', label: 'Flashcards & Quizzes', where: 'sidebar', hideable: true },
  { id: 'tutor', label: 'Tutor', where: 'sidebar', hideable: true },
  { id: 'calendar', label: 'Calendar', where: 'sidebar', hideable: true },
  { id: 'reminders', label: 'Reminders', where: 'sidebar', hideable: true },
  { id: 'graph', label: 'Graph', where: 'sidebar', hideable: true },
  { id: 'notebook', label: 'Notebook (sources & chat)', where: 'other', hideable: false },
  { id: 'lecture', label: 'Lecture recording', where: 'other', hideable: false },
  { id: 'studio:podcast', label: 'Audio Overview', where: 'studio', hideable: true },
  { id: 'studio:briefing', label: 'Briefing Doc', where: 'studio', hideable: true },
  { id: 'studio:studyguide', label: 'Study Guide', where: 'studio', hideable: true },
  { id: 'studio:mindmap', label: 'Mind Map', where: 'studio', hideable: true },
  { id: 'studio:faq', label: 'FAQ', where: 'studio', hideable: true },
  { id: 'studio:timeline', label: 'Timeline', where: 'studio', hideable: true },
  { id: 'studio:cheatsheet', label: 'Cheat Sheet', where: 'studio', hideable: true },
];

export interface Use {
  count: number;
  last: number;
}

interface Store {
  /** When counting began on this device. */
  since: number;
  uses: Partial<Record<Feature, Use>>;
}

const KEY = 'scrabbler.usage';
const DAY = 86400000;
/** Unused this long, and counting for at least this long, suggests hiding. */
export const STALE_DAYS = 30;

function load(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && typeof s.since === 'number' && s.uses) return s;
  } catch {
    /* private mode */
  }
  return { since: Date.now(), uses: {} };
}

let store = load();
const listeners = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

/** Counts one use (at most once a minute per feature, so re-renders don't inflate it). */
export function noteUse(feature: Feature, now = Date.now()) {
  const u = store.uses[feature];
  if (u && now - u.last < 60_000) return;
  store = { ...store, uses: { ...store.uses, [feature]: { count: (u?.count ?? 0) + 1, last: now } } };
  save();
}

export function getUsage(): Store {
  return store;
}

export function useUsage(): Store {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => store,
  );
}

/** Features worth hiding: counted for a month, and not used in it. */
export function staleFeatures(s: Store = store, now = Date.now()): Feature[] {
  if (now - s.since < STALE_DAYS * DAY) return [];
  return FEATURES.filter((f) => f.hideable && (!s.uses[f.id] || now - s.uses[f.id]!.last > STALE_DAYS * DAY)).map((f) => f.id);
}

export function isHidden(f: Feature, hidden = getSettings().hiddenFeatures): boolean {
  return hidden.includes(f);
}

export function setHidden(f: Feature, hide: boolean) {
  const cur = new Set(getSettings().hiddenFeatures);
  if (hide) cur.add(f);
  else cur.delete(f);
  updateSettings({ hiddenFeatures: [...cur] });
}

export function lastUsedText(u: Use | undefined, now = Date.now()): string {
  if (!u) return 'Never used here';
  const d = Math.floor((now - u.last) / DAY);
  const when = d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  return `Last used ${when} · ${u.count} time${u.count === 1 ? '' : 's'}`;
}

/** For tests. */
export function resetUsage(s?: Store) {
  store = s ?? { since: Date.now(), uses: {} };
  save();
}
