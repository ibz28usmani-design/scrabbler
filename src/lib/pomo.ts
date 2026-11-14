/** The Pomodoro timer. Lives outside React so it keeps running while you use other screens. */
import { useSyncExternalStore } from 'react';
import { db, uid } from './db';
import { beep, getS, notify } from './ui';

export type Phase = 'work' | 'short' | 'long';
type State = { phase: Phase; running: boolean; end: number; left: number; round: number; subject: string };
const len = (p: Phase) => getS()[p] * 60000;
let st: State = { phase: 'work', running: false, end: 0, left: len('work'), round: 1, subject: 'Mathematics' };
let timer: ReturnType<typeof setInterval> | undefined;
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach(f => f()); };

function finish() {
  beep();
  if (st.phase === 'work') {
    db.sessions.add({ id: uid(), subject: st.subject, start: Date.now() - len('work'), mins: getS().work });
    const long = st.round % getS().rounds === 0;
    notify('Focus session done', long ? 'Take a long break.' : 'Take a short break.');
    go(long ? 'long' : 'short', st.round);
  } else {
    notify('Break over', 'Ready for the next session.');
    go('work', st.round + 1);
  }
}
function go(phase: Phase, round: number) { clearInterval(timer); set({ phase, round, running: false, left: len(phase) }); }
export const pomo = {
  start() {
    if (st.running) return;
    set({ running: true, end: Date.now() + st.left });
    timer = setInterval(() => { const left = st.end - Date.now(); if (left <= 0) finish(); else set({ left }); }, 250);
  },
  pause() { clearInterval(timer); set({ running: false, left: Math.max(0, st.end - Date.now()) }); },
  reset() { go(st.phase, st.round); },
  skip() { if (st.phase === 'work') go(st.round % getS().rounds === 0 ? 'long' : 'short', st.round); else go('work', st.round + 1); },
  phase(p: Phase) { go(p, st.round); },
  subject(subject: string) { set({ subject }); },
  /** Call after the session lengths change in Settings. */
  refresh() { if (!st.running) set({ left: len(st.phase) }); },
};
export const usePomo = () => useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => st);
export const mmss = (ms: number) => { const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
