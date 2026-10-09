import { useSyncExternalStore } from 'react';

export interface Settings {
  apiKey: string;
  /** Which engine runs plain-text generation. Gemini still handles media and web tools. */
  textProvider: 'gemini' | 'compat';
  /** Which preset the compat endpoint came from (nim, bytez, openrouter, groq, proxy, custom). */
  compatPreset: string;
  compatBaseUrl: string;
  compatKey: string;
  compatModel: string;
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
  textProvider: 'gemini',
  compatPreset: 'nim',
  compatBaseUrl: 'https://integrate.api.nvidia.com/v1',
  compatKey: '',
  compatModel: '',
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
    if (raw) return migrate({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS };
}

/** Carries the old Bytez-only fields onto the generic OpenAI-compatible ones. */
function migrate(s: Settings & { bytezKey?: string; bytezModel?: string }): Settings {
  if ((s.textProvider as string) === 'bytez') {
    s.textProvider = 'compat';
    s.compatPreset = 'bytez';
    s.compatBaseUrl = s.compatBaseUrl || 'https://api.bytez.com/models/v2/openai/v1';
  }
  if (s.bytezKey && !s.compatKey) s.compatKey = s.bytezKey;
  if (s.bytezModel && !s.compatModel) s.compatModel = s.bytezModel;
  return s;
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
