import { useSyncExternalStore } from 'react';

export interface Settings {
  apiKey: string;
  textModel: string;
  proModel: string;
  ttsModel: string;
  hostA: string;
  hostB: string;
  voiceA: string;
  voiceB: string;
  theme: 'system' | 'light' | 'dark';
  fingerDrawing: boolean;
  dailyGoal: number;
  newPerDay: number;
  liveCaptions: boolean;
  transcribeLanguage: string;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  textModel: 'gemini-2.5-flash',
  proModel: 'gemini-2.5-pro',
  ttsModel: 'gemini-2.5-flash-preview-tts',
  hostA: 'Alex',
  hostB: 'Sam',
  voiceA: 'Puck',
  voiceB: 'Kore',
  theme: 'system',
  fingerDrawing: false,
  dailyGoal: 20,
  newPerDay: 20,
  liveCaptions: true,
  transcribeLanguage: 'auto',
};

const KEY = 'scrabbler.settings';
let current: Settings = load();
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS };
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export const GEMINI_VOICES = [
  'Puck', 'Kore', 'Charon', 'Zephyr', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi',
  'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird',
  'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
];
