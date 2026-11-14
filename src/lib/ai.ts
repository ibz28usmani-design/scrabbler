/** Gemini (free tier, the user's own key) and everything the Study tab generates with it. */
import { db, uid, newNote, type Note } from './db';
import { getS, noteText, fileToDataUrl } from './ui';
import { inkPng } from './ink';
import { buildDeck, type Outline } from './slides';

type Part = { text: string } | { inlineData: { mimeType: string; data: string } } | { fileData: { mimeType: string; fileUri: string } };
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

async function call(model: string, body: unknown) {
  const key = getS().key;
  if (!key) throw new Error('Add your free Gemini API key in Settings first.');
  for (let i = 0; ; i++) {
    const r = await fetch(`${BASE}${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && i < 3) { await new Promise(s => setTimeout(s, 2500 * 2 ** i)); continue; }
    const e = await r.json().catch(() => null);
    throw new Error(e?.error?.message || `Gemini error ${r.status}`);
  }
}
export async function ask(parts: Part[] | string, o: { json?: boolean; system?: string } = {}): Promise<string> {
  const res = await call(getS().textModel, {
    contents: [{ role: 'user', parts: typeof parts === 'string' ? [{ text: parts }] : parts }],
    ...(o.system ? { systemInstruction: { parts: [{ text: o.system }] } } : {}),
    ...(o.json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
  });
  const text = (res.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
  if (!text) throw new Error('Gemini returned no answer. Try again, or use fewer sources.');
  return text;
}
const askJson = async (parts: Part[], instruction: string) =>
  JSON.parse((await ask([...parts, { text: instruction }], { json: true })).replace(/^```(?:json)?|```$/gm, '').trim());

/** The ticked notes and files as model input. Handwriting is sent as an image. */
export async function context(ids: string[]): Promise<Part[]> {
  const parts: Part[] = [];
  const notes = (await db.notes.bulkGet(ids)).filter(Boolean) as Note[];
  notes.forEach((n, i) => {
    parts.push({ text: `### Source ${i + 1}: ${n.title || 'Untitled'}\n${noteText(n)}` });
    if (n.ink?.length) parts.push({ inlineData: { mimeType: 'image/png', data: inkPng(n.ink) } });
  });
  for (const s of (await db.sources.bulkGet(ids)).filter(Boolean)) {
    parts.push({ text: `### Source file: ${s!.name}` }, { inlineData: { mimeType: s!.mime, data: s!.data } });
  }
  if (!parts.length) throw new Error('Tick at least one source first.');
  return parts;
}

export const chat = (ctx: Part[], history: { me: boolean; text: string }[], q: string) =>
  ask([...ctx, { text: `Conversation so far:\n${history.map(h => `${h.me ? 'Student' : 'Tutor'}: ${h.text}`).join('\n')}\n\nStudent: ${q}` }],
    { system: 'You are a study tutor. Answer only from the sources given, citing them as [Source n]. If the sources do not cover it, say so. Be concise and use plain text.' });

export async function makeCards(ctx: Part[], title: string, n = 15) {
  const out = await askJson(ctx, `Write ${n} flashcards that test the most examinable content of these sources. Return JSON: {"cards":[{"front":"question","back":"short answer"}]}`);
  const set = uid(), now = Date.now();
  await db.cardSets.add({ id: set, title, created: now });
  await db.cards.bulkAdd(out.cards.map((c: any) => ({ id: uid(), set, front: c.front, back: c.back, due: now, interval: 0, ease: 2.5, reps: 0 })));
  return set;
}
export async function makeQuiz(ctx: Part[], title: string, n = 10) {
  const out = await askJson(ctx, `Write a ${n}-question multiple-choice quiz on these sources, with plausible wrong options. Return JSON: {"questions":[{"q":"...","options":["a","b","c","d"],"answer":0,"explain":"why the answer is right"}]} where answer is the index of the correct option.`);
  const id = uid();
  await db.quizzes.add({ id, title, questions: out.questions, created: Date.now() });
  return id;
}
export async function makePodcast(ctx: Part[], title: string) {
  const out = await askJson(ctx, `Write a lively two-host podcast episode (about 5 minutes, 28-36 turns) that teaches these sources to an A-level student. Host A (Alex) leads; host B (Sam) asks the questions a student would and gives examples. Return JSON: {"script":[{"s":"A","t":"line"},{"s":"B","t":"line"}]}`);
  const id = uid();
  await db.podcasts.add({ id, title, script: out.script, created: Date.now() });
  return id;
}
export async function makeGuide(ctx: Part[], title: string) {
  const html = await ask([...ctx, { text: 'Write a study guide for these sources as HTML using only h2, h3, p, ul, ol, li, strong, em and table tags: key ideas, definitions, worked examples and five self-test questions with answers. Return HTML only.' }]);
  const n = newNote({ title: `Study guide: ${title}`, content: { body: html.replace(/^```(?:html)?|```$/gm, '') } });
  await db.notes.add(n);
  return n.id;
}
export async function makeDeck(ctx: Part[], topic: string, theme = 'poster', n = 8) {
  const out: Outline = await askJson(ctx, `Plan a ${n}-slide presentation${topic ? ` on "${topic}"` : ' on these sources'}. Return JSON: {"title":"deck title","slides":[{"layout":"title|bullets|two|section|quote|big","title":"...","sub":"subtitle (title/section)","bullets":["max 5 short bullets"],"left":["bullets"],"right":["bullets"],"quote":"...","by":"...","stat":"big number","caption":"...","notes":"speaker notes"}]}. Start with a title slide and vary the layouts.`);
  const deck = buildDeck(out, theme);
  await db.decks.add(deck);
  return deck.id;
}
export async function makeArtifact(prompt: string, ctx: Part[] = [], prev?: string) {
  const html = await ask([...ctx, { text: prev ? `Here is an existing web page:\n${prev}\n\nChange it as follows and return the complete updated page: ${prompt}` : `Build this as an interactive web page: ${prompt}` }],
    { system: 'You build self-contained interactive web artefacts for studying (simulations, visualisers, games, calculators, timelines). Return one complete HTML document with inline CSS and JavaScript, no external files except optional CDN scripts from cdnjs.cloudflare.com. Make it responsive, polished and usable by touch. Return only the HTML, no commentary.' });
  return html.replace(/^```(?:html)?\s*|```\s*$/gm, '').trim();
}

/** A file as model input: inline when small, through Gemini's File API when large (kept 48 hours on Google's side). */
export async function filePart(blob: Blob, mime: string): Promise<Part> {
  if (blob.size < 14e6) return { inlineData: { mimeType: mime, data: (await fileToDataUrl(blob)).split(',')[1] } };
  const key = getS().key, root = 'https://generativelanguage.googleapis.com';
  if (!key) throw new Error('Add your free Gemini API key in Settings first.');
  const start = await fetch(`${root}/upload/v1beta/files`, { method: 'POST', body: JSON.stringify({ file: { display_name: 'lecture' } }), headers: { 'x-goog-api-key': key, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(blob.size), 'X-Goog-Upload-Header-Content-Type': mime, 'Content-Type': 'application/json' } });
  const url = start.headers.get('x-goog-upload-url');
  if (!start.ok || !url) throw new Error('The upload to Gemini failed to start.');
  let file = (await (await fetch(url, { method: 'POST', headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: blob })).json()).file;
  for (let i = 0; file?.state === 'PROCESSING' && i < 120; i++) { await new Promise(r => setTimeout(r, 2500)); file = await (await fetch(`${root}/v1beta/${file.name}`, { headers: { 'x-goog-api-key': key } })).json(); }
  if (!file?.uri || file.state === 'FAILED') throw new Error('Gemini could not process that recording.');
  return { fileData: { mimeType: file.mimeType || mime, fileUri: file.uri } };
}
/** A lecture recording as study notes followed by a timestamped transcript (HTML). */
export async function transcribe(audio: Blob) {
  const html = await ask([await filePart(audio, audio.type || 'audio/mpeg'), { text: 'This is a recording of a lesson. Return HTML only, using h2, h3, p, ul, li, strong and em tags. First an <h2>Study notes</h2> section: the key ideas, definitions, examples and any homework or dates mentioned, organised under h3 headings. Then an <h2>Transcript</h2> section: the full transcript as paragraphs, each starting with <strong>[mm:ss] Speaker:</strong>. Label speakers Teacher or Student where you can tell.' }]);
  return html.replace(/^```(?:html)?\s*|```\s*$/gm, '').trim();
}

/** Two-voice audio from Gemini's speech model, as a WAV file. */
export async function ttsWav(script: { s: string; t: string }[]): Promise<Blob> {
  const text = 'TTS the following conversation between Alex and Sam:\n' + script.map(l => `${l.s === 'A' ? 'Alex' : 'Sam'}: ${l.t}`).join('\n');
  const voice = (speaker: string, voiceName: string) => ({ speaker, voiceConfig: { prebuiltVoiceConfig: { voiceName } } });
  const res = await call(getS().ttsModel, {
    contents: [{ parts: [{ text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { multiSpeakerVoiceConfig: { speakerVoiceConfigs: [voice('Alex', 'Kore'), voice('Sam', 'Puck')] } } },
  });
  const b64 = res.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData?.data;
  if (!b64) throw new Error('Gemini returned no audio. Use the device voices instead.');
  const pcm = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const h = new DataView(new ArrayBuffer(44)), rate = 24000;
  const str = (o: number, s: string) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); h.setUint32(4, 36 + pcm.length, true); str(8, 'WAVEfmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true);
  h.setUint16(22, 1, true); h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  str(36, 'data'); h.setUint32(40, pcm.length, true);
  return new Blob([h.buffer, pcm], { type: 'audio/wav' });
}
