/**
 * Chart inks for subjects. The timetable's own subject colours are muted
 * newsprint tints that read as one grey to colour-blind eyes, so charts use
 * these instead: three press inks checked for separation (all pairs, light
 * and dark), in the order of the subjects you revise. Any further subject
 * folds into Other rather than getting a fourth hue that can't be told apart.
 */
export const SERIES = {
  light: ['#2a5fa8', '#c8501e', '#1c8a63'],
  dark: ['#5b8fd9', '#e0703c', '#2a9d74'],
  otherLight: '#8a8578',
  otherDark: '#7d786d',
};

/** 0-based ink slot for a subject, or null when it counts as Other. */
export function seriesSlot(subjectId: string | undefined, revised: string[]): number | null {
  const i = subjectId ? revised.indexOf(subjectId) : -1;
  return i >= 0 && i < SERIES.light.length ? i : null;
}

/** The CSS colour for a subject's marks. */
export function seriesVar(subjectId: string | undefined, revised: string[]): string {
  const i = seriesSlot(subjectId, revised);
  return i === null ? 'var(--series-other)' : `var(--series-${i + 1})`;
}

export function seriesHex(subjectId: string | undefined, revised: string[], dark: boolean): string {
  const i = seriesSlot(subjectId, revised);
  if (i === null) return dark ? SERIES.otherDark : SERIES.otherLight;
  return (dark ? SERIES.dark : SERIES.light)[i];
}
