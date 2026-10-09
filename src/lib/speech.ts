/** Free on-device live captions via the Web Speech API (Safari/Chrome). */

export interface LiveCaptions {
  stop(): void;
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export function startLiveCaptions(
  onUpdate: (finalText: string, interim: string) => void,
  lang = navigator.language || 'en-US',
): LiveCaptions | null {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  let stopped = false;
  let finalText = '';
  let rec: any;
  const begin = () => {
    rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += (finalText ? ' ' : '') + r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      onUpdate(finalText, interim);
    };
    rec.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') stopped = true;
    };
    // Safari ends sessions after silence; restart until the user stops.
    rec.onend = () => {
      if (!stopped) setTimeout(() => !stopped && safeStart(), 250);
    };
    safeStart();
  };
  const safeStart = () => {
    try {
      rec.start();
    } catch {
      /* already started */
    }
  };
  begin();
  return {
    stop() {
      stopped = true;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    },
  };
}

// ---------------------------------------------------------------- device voices

export function deviceVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  const lang = (navigator.language || 'en').slice(0, 2);
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith(lang));
  // Prefer enhanced/premium voices the user has downloaded in iPadOS settings.
  return voices.sort((a, b) => score(b) - score(a));
}

function score(v: SpeechSynthesisVoice) {
  const n = v.name.toLowerCase();
  return (n.includes('premium') ? 4 : 0) + (n.includes('enhanced') ? 3 : 0) + (n.includes('siri') ? 2 : 0) + (v.localService ? 1 : 0);
}

export function speakLine(text: string, voice: SpeechSynthesisVoice | undefined, rate = 1.02, pitch = 1): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = rate;
    u.pitch = pitch;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}
