/**
 * Lecture recorder: captures the mic as PCM and encodes 16 kHz mono MP3 on the
 * fly (~14 MB/hour) — compact to store and a format Gemini accepts directly.
 */

const TARGET_RATE = 16000;

const WORKLET = `
class Capture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('scrabbler-capture', Capture);
`;

export interface RecorderHandle {
  pause(): void;
  resume(): void;
  stop(): Promise<Blob>;
  readonly elapsed: number;
  readonly paused: boolean;
}

export async function startRecording(onLevel: (level: number) => void): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const ctx = new AudioContext();
  await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const encoder = new Mp3Encoder(1, TARGET_RATE, 32);
  const chunks: Uint8Array[] = [];
  const ratio = ctx.sampleRate / TARGET_RATE;
  let carry = new Float32Array(0);
  let paused = false;
  let elapsedMs = 0;
  let lastTick = performance.now();

  const consume = (input: Float32Array) => {
    const now = performance.now();
    if (!paused) elapsedMs += now - lastTick;
    lastTick = now;
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    onLevel(paused ? 0 : Math.min(1, Math.sqrt(sum / input.length) * 4));
    if (paused) return;
    const data = new Float32Array(carry.length + input.length);
    data.set(carry);
    data.set(input, carry.length);
    const outLen = Math.floor(data.length / ratio);
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      // Box-filter decimation: average the source samples for each output sample.
      const start = Math.floor(i * ratio);
      const end = Math.min(data.length, Math.floor((i + 1) * ratio));
      let acc = 0;
      for (let j = start; j < end; j++) acc += data[j];
      const v = Math.max(-1, Math.min(1, acc / Math.max(1, end - start)));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    carry = data.slice(Math.floor(outLen * ratio));
    const mp3 = encoder.encodeBuffer(out);
    if (mp3.length) chunks.push(new Uint8Array(mp3));
  };

  let node: AudioNode;
  if (ctx.audioWorklet) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const w = new AudioWorkletNode(ctx, 'scrabbler-capture');
    w.port.onmessage = (e) => consume(e.data as Float32Array);
    node = w;
  } else {
    const sp = ctx.createScriptProcessor(4096, 1, 1);
    sp.onaudioprocess = (e) => consume(new Float32Array(e.inputBuffer.getChannelData(0)));
    node = sp;
  }
  // Route through a muted gain so the graph keeps pulling audio without echoing it.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  src.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);

  let wakeLock: any = null;
  try {
    wakeLock = await (navigator as any).wakeLock?.request('screen');
  } catch {
    /* wake lock unsupported */
  }

  return {
    get elapsed() {
      return elapsedMs / 1000;
    },
    get paused() {
      return paused;
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      lastTick = performance.now();
    },
    async stop() {
      src.disconnect();
      node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close();
      try {
        await wakeLock?.release();
      } catch {
        /* ignore */
      }
      const tail = encoder.flush();
      if (tail.length) chunks.push(new Uint8Array(tail));
      return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
    },
  };
}

/** Wraps raw 16-bit little-endian PCM in a WAV container. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number, channels = 1): Blob {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const write = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  write(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  write(36, 'data');
  v.setUint32(40, pcm.length, true);
  return new Blob([header, pcm as BlobPart], { type: 'audio/wav' });
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Silence between podcast segments so joins don't sound clipped. */
export function silence(ms: number, sampleRate: number): Uint8Array {
  return new Uint8Array(Math.floor((sampleRate * ms) / 1000) * 2);
}

/** Maps uploaded file types to MIME types Gemini understands. */
export function geminiMime(file: Blob & { name?: string }): string {
  const t = file.type;
  const name = (file.name ?? '').toLowerCase();
  if (t === 'audio/x-m4a' || t === 'audio/m4a' || name.endsWith('.m4a')) return 'audio/mp4';
  if (t === 'audio/mpeg' || name.endsWith('.mp3')) return 'audio/mp3';
  if (t === 'audio/x-wav' || name.endsWith('.wav')) return 'audio/wav';
  if (t === 'video/quicktime' || name.endsWith('.mov')) return 'video/mov';
  if (t) return t;
  if (name.endsWith('.mp4')) return 'video/mp4';
  if (name.endsWith('.ogg')) return 'audio/ogg';
  if (name.endsWith('.flac')) return 'audio/flac';
  if (name.endsWith('.aac')) return 'audio/aac';
  return 'audio/mp3';
}
