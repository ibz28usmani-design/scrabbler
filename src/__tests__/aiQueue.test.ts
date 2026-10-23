import { describe, expect, it } from 'vitest';
import { aiQueueState, getAiWait, inSlot, MAX_CONCURRENT, waitBusy } from '../lib/aiQueue';

describe('the AI queue', () => {
  it('runs at most two requests at once, in the order they came', async () => {
    const order: number[] = [];
    let peak = 0;
    const release: (() => void)[] = [];
    const jobs = [0, 1, 2, 3].map((n) =>
      inSlot(async () => {
        peak = Math.max(peak, aiQueueState().running);
        order.push(n);
        await new Promise<void>((r) => release.push(r));
        return n;
      }),
    );
    await new Promise((r) => setTimeout(r));
    expect(aiQueueState()).toEqual({ running: MAX_CONCURRENT, queued: 2 });
    expect(getAiWait()?.kind).toBe('queued');
    while (release.length || aiQueueState().running) {
      release.shift()?.();
      await new Promise((r) => setTimeout(r));
    }
    expect(await Promise.all(jobs)).toEqual([0, 1, 2, 3]);
    expect(order).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(MAX_CONCURRENT);
    expect(getAiWait()).toBeNull();
  });

  it('gives up its place when the request is cancelled', async () => {
    const hold: (() => void)[] = [];
    const a = inSlot(() => new Promise<void>((r) => hold.push(r)));
    const b = inSlot(() => new Promise<void>((r) => hold.push(r)));
    const ctrl = new AbortController();
    const c = inSlot(async () => 'never', ctrl.signal);
    ctrl.abort();
    await expect(c).rejects.toThrow(/Aborted/);
    expect(aiQueueState().queued).toBe(0);
    hold.forEach((r) => r());
    await Promise.all([a, b]);
  });

  it('shows when a rate-limited request will try again', async () => {
    const p = waitBusy(30, 'Gemini');
    expect(getAiWait()).toMatchObject({ kind: 'busy', provider: 'Gemini' });
    expect(getAiWait()!.until! - Date.now()).toBeLessThanOrEqual(30);
    await p;
    expect(getAiWait()).toBeNull();
  });
});
