import { beforeEach, describe, expect, it } from 'vitest';
import { getUsage, lastUsedText, noteUse, resetUsage, staleFeatures } from '../lib/usage';

const DAY = 86400000;

describe('feature use', () => {
  beforeEach(() => resetUsage({ since: 0, uses: {} }));

  it('counts a use at most once a minute', () => {
    noteUse('graph', 1000);
    noteUse('graph', 2000);
    noteUse('graph', 70_000);
    expect(getUsage().uses.graph).toEqual({ count: 2, last: 70_000 });
    expect(lastUsedText(getUsage().uses.graph, 70_000)).toBe('Last used today · 2 times');
    expect(lastUsedText(undefined)).toBe('Never used here');
  });

  it('suggests hiding what has gone a month unused, once there is a month to judge by', () => {
    const now = 100 * DAY;
    noteUse('graph', now - 40 * DAY);
    noteUse('calendar', now - 2 * DAY);
    const stale = staleFeatures(undefined, now);
    expect(stale).toContain('graph');
    expect(stale).toContain('studio:timeline');
    expect(stale).not.toContain('calendar');
    // Notes and lectures can't be hidden, so are never suggested.
    expect(stale).not.toContain('lecture');
    resetUsage({ since: now - 5 * DAY, uses: {} });
    expect(staleFeatures(undefined, now)).toEqual([]);
  });
});
