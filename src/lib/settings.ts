import { useSyncExternalStore } from 'react';

export type Orientation = 'portrait' | 'landscape';
export type ByOrientation<T> = Record<Orientation, T>;

export interface Settings {
  apiKey: string;
  /** Which engine runs plain-text generation. Gemini still handles media and web tools. */
  textProvider: 'gemini' | 'compat';
  /** Which preset the compat endpoint came from (nim, bytez, openrouter, groq, proxy, custom). */
  compatPreset: string;
  compatBaseUrl: string;
  compatKey: string;
  compatModel: string;
  /** The compat model can read images (handwriting, PDFs rendered to pages). */
  compatVision: boolean;
  textModel: string;
  proModel: string;
  ttsModel: string;
  hostA: string;
  hostB: string;
  voiceA: string;
  voiceB: string;
  theme: 'system' | 'light' | 'dark';
  fingerDrawing: boolean;
  /** The handwriting tool palette is expanded (false = collapsed to a circle). */
  inkToolbarOpen: boolean;
  /** Which edge the open palette centres on — remembered per orientation, since
      what is out of the way in portrait is in the way in landscape. */
  inkToolbarEdge: ByOrientation<'top' | 'bottom' | 'left' | 'right'>;
  /** Which corner the tucked-away circle rests in, per orientation. */
  inkToolbarSpot: ByOrientation<'tl' | 'tr' | 'bl' | 'br'>;
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
  compatVision: false,
  textModel: 'gemini-2.5-flash',
  proModel: 'gemini-2.5-pro',
  ttsModel: 'gemini-2.5-flash-preview-tts',
  hostA: 'Alex',
  hostB: 'Sam',
  voiceA: 'Puck',
  voiceB: 'Kore',
  theme: 'system',
  fingerDrawing: false,
  inkToolbarOpen: true,
  inkToolbarEdge: { portrait: 'bottom', landscape: 'bottom' },
  inkToolbarSpot: { portrait: 'tr', landscape: 'tr' },
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
export function migrate(s: Settings & { bytezKey?: string; bytezModel?: string }): Settings {
  if ((s.textProvider as string) === 'bytez') {
    s.textProvider = 'compat';
    s.compatPreset = 'bytez';
    s.compatBaseUrl = s.compatBaseUrl || 'https://api.bytez.com/models/v2/openai/v1';
  }
  if (s.bytezKey && !s.compatKey) s.compatKey = s.bytezKey;
  if (s.bytezModel && !s.compatModel) s.compatModel = s.bytezModel;
  // The palette's place used to be one value for the whole app, and the tucked
  // circle briefly rested on the sides as well as the corners. Carry either
  // shape forward: a bare value becomes the same place in both orientations,
  // and a side becomes the nearest corner, which the CSS can actually position.
  const corners: Record<string, 'tl' | 'tr' | 'bl' | 'br'> = { top: 'tr', bottom: 'br', left: 'tl', right: 'tr' };
  const pair = <T,>(v: unknown, fix: (x: unknown) => T): ByOrientation<T> =>
    v && typeof v === 'object'
      ? { portrait: fix((v as ByOrientation<T>).portrait), landscape: fix((v as ByOrientation<T>).landscape) }
      : { portrait: fix(v), landscape: fix(v) };
  const edge = (x: unknown) => (['top', 'bottom', 'left', 'right'].includes(x as string) ? (x as 'top') : 'bottom');
  const spot = (x: unknown) => (corners[x as string] ?? (['tl', 'tr', 'bl', 'br'].includes(x as string) ? (x as 'tr') : 'tr'));
  s.inkToolbarEdge = pair(s.inkToolbarEdge, edge);
  s.inkToolbarSpot = pair(s.inkToolbarSpot, spot);
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
