/** High-level AI features built on the Gemini client. */
import { db, type CardType, type Citation, type ChatMessage, type MindNode, type PodcastLine, type StudioKind, type TranscriptSegment } from '../db';
import { blobPart, S, tts, type Content } from './gemini';
import { generate, generateJSON, stream } from './llm';
import { citedNumbers, chunkText, sampleChunks, selectChunks } from './retrieval';
import { getSettings } from './settings';
import { parseClock } from './dates';
import { concatBytes, pcmToWav, silence } from './audio';

// ---------------------------------------------------------------- corpus

export interface CorpusChunk {
  id: string;
  sourceId: string;
  idx: number;
  text: string;
  page?: number;
  title: string;
}

export async function getCorpus(folderId: string): Promise<CorpusChunk[]> {
  const folder = await db.folders.get(folderId);
  const sources = (await db.sources.where('folderId').equals(folderId).toArray()).filter((s) => s.enabled && s.status === 'ready');
  const titles = new Map(sources.map((s) => [s.id, s.title]));
  const chunks: CorpusChunk[] = (await db.chunks.where('folderId').equals(folderId).toArray())
    .filter((c) => titles.has(c.sourceId))
    .sort((a, b) => (a.sourceId === b.sourceId ? a.idx - b.idx : a.sourceId.localeCompare(b.sourceId)))
    .map((c) => ({ ...c, title: titles.get(c.sourceId)! }));
  if (folder?.notesAsSources) {
    const notes = (await db.notes.where('folderId').equals(folderId).toArray()).filter((n) => !n.deletedAt && n.text.trim().length > 20);
    for (const n of notes) {
      for (const c of chunkText([{ text: n.text }])) {
        chunks.push({ id: `note:${n.id}:${c.idx}`, sourceId: `note:${n.id}`, idx: c.idx, text: c.text, title: `Note: ${n.title || 'Untitled'}` });
      }
    }
  }
  return chunks;
}

function formatPassages(chunks: CorpusChunk[]): string {
  return chunks
    .map((c, i) => `[${i + 1}] (Source: "${c.title}"${c.page ? `, p. ${c.page}` : ''})\n${c.text}`)
    .join('\n\n');
}

function formatPlain(chunks: CorpusChunk[]): string {
  let last = '';
  let out = '';
  for (const c of chunks) {
    if (c.sourceId !== last) {
      out += `\n\n=== ${c.title} ===\n`;
      last = c.sourceId;
    }
    out += c.text + '\n';
  }
  return out.trim();
}

// ---------------------------------------------------------------- chat

const CHAT_SYSTEM = `You are Scrabbler, a meticulous research and study assistant. Answer using the numbered source passages provided.
Rules:
- Ground every factual statement in the passages and cite them inline with bracketed numbers, e.g. "…mitochondria [3]." or "[2][5]". Only cite numbers that exist.
- If the passages don't contain the answer, say so plainly. You may then add general knowledge, clearly labelled "**Beyond your sources:**".
- Be clear and well structured: short paragraphs, bullet lists, tables or bold key terms when helpful. Use Markdown.
- Match the user's language.`;

export interface ChatResult {
  text: string;
  citations: Citation[];
}

export async function answerQuestion(
  folderId: string,
  question: string,
  history: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const corpus = await getCorpus(folderId);
  const recent = history.filter((m) => !m.error).slice(-8);
  const query = [question, ...recent.filter((m) => m.role === 'user').slice(-2).map((m) => m.text)].join(' ');
  const picked = selectChunks(corpus, query);
  const contents: Content[] = recent.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
  const ctx = picked.length
    ? `SOURCE PASSAGES:\n\n${formatPassages(picked)}\n\n---\nQUESTION: ${question}`
    : `(This notebook has no sources yet — answer from general knowledge and suggest adding sources for grounded answers.)\n\nQUESTION: ${question}`;
  contents.push({ role: 'user', parts: [{ text: ctx }] });
  let text = '';
  for await (const delta of stream({ system: CHAT_SYSTEM, contents, temperature: 0.3, signal })) {
    text += delta;
    onDelta(text);
  }
  const citations: Citation[] = citedNumbers(text)
    .filter((n) => n >= 1 && n <= picked.length)
    .map((n) => {
      const c = picked[n - 1];
      return { n, sourceId: c.sourceId, chunkId: c.id, title: c.title, text: c.text, page: c.page };
    });
  return { text, citations };
}

export async function notebookOverview(folderId: string): Promise<{ summary: string; questions: string[] }> {
  const corpus = sampleChunks(await getCorpus(folderId), 200_000);
  if (!corpus.length) throw new Error('Add a source first.');
  const r = await generateJSON<{ summary?: string; questions?: string[] }>({
    prompt: `Here are the user's sources:\n\n${formatPlain(corpus)}\n\nWrite a 3–5 sentence overview of what these sources cover together (bold the key topics with **), and suggest 4 insightful questions the user could ask.`,
    schema: S.obj({ summary: S.str(), questions: S.arr(S.str()) }),
    temperature: 0.4,
  });
  return { summary: String(r.summary ?? ''), questions: Array.isArray(r.questions) ? r.questions.filter((q) => typeof q === 'string') : [] };
}

// ---------------------------------------------------------------- studio

const STUDIO_PROMPTS: Record<Exclude<StudioKind, 'mindmap' | 'podcast'>, { title: string; prompt: string }> = {
  briefing: {
    title: 'Briefing Doc',
    prompt:
      'Write a briefing document: an executive summary, then the main themes and most important ideas/facts as sections with headings, notable quotes (with who said them, if known), and open questions. Use Markdown.',
  },
  studyguide: {
    title: 'Study Guide',
    prompt:
      'Write a study guide: a short-answer quiz of 10 questions, then an answer key, then 5 essay-format questions (no answers), then a glossary of key terms with definitions. Use Markdown headings and numbered lists.',
  },
  faq: {
    title: 'FAQ',
    prompt: 'Write an FAQ of the 10–15 most important questions someone would ask about this material, each with a clear, specific answer. Format each question as a "### " heading.',
  },
  cheatsheet: {
    title: 'Cheat Sheet',
    prompt:
      'Write a dense one-page exam cheat sheet: the must-know definitions, formulas/rules, key facts, comparisons (as compact tables) and common pitfalls, grouped under short "## " headings. Maximum signal, minimum words. Use Markdown.',
  },
  timeline: {
    title: 'Timeline',
    prompt:
      'Build a detailed chronological timeline of the main events in the sources (bulleted, date in bold first), followed by a "Cast of characters" section with a short bio of each key person/entity. If the material has no chronology, give a logical sequence of concepts instead. Use Markdown.',
  },
};

export async function generateStudioDoc(folderId: string, kind: keyof typeof STUDIO_PROMPTS, signal?: AbortSignal) {
  const corpus = sampleChunks(await getCorpus(folderId));
  if (!corpus.length) throw new Error('Add at least one source (or enable notes as sources) first.');
  const { title, prompt } = STUDIO_PROMPTS[kind];
  const markdown = await generate({
    system: 'You create excellent study and research documents strictly from the provided sources. Do not invent facts.',
    prompt: `SOURCES:\n\n${formatPlain(corpus)}\n\n---\nTASK: ${prompt}`,
    temperature: 0.4,
    signal,
  });
  return { title, markdown };
}

const leaf = S.obj({ label: S.str() });
const lvl3 = S.obj({ label: S.str(), children: S.arr(leaf) }, ['label']);
const lvl2 = S.obj({ label: S.str(), children: S.arr(lvl3) }, ['label']);
const lvl1 = S.obj({ label: S.str(), children: S.arr(lvl2) }, ['label']);

export async function generateMindMap(folderId: string, signal?: AbortSignal): Promise<MindNode> {
  const corpus = sampleChunks(await getCorpus(folderId));
  if (!corpus.length) throw new Error('Add at least one source first.');
  const root = await generateJSON<MindNode>({
    prompt: `SOURCES:\n\n${formatPlain(corpus)}\n\n---\nCreate a mind map of these sources: a central topic, 4–7 main branches, each with 2–5 sub-branches and optional leaf details. Labels must be short (max ~6 words).`,
    schema: lvl1,
    temperature: 0.3,
    signal,
  });
  if (!root?.label) throw new Error('The mind map came back empty — try again.');
  return root;
}

export type PodcastLength = 'short' | 'default' | 'long';

export async function generatePodcastScript(folderId: string, length: PodcastLength, focus: string, signal?: AbortSignal) {
  const corpus = sampleChunks(await getCorpus(folderId));
  if (!corpus.length) throw new Error('Add at least one source first.');
  const { hostA, hostB } = getSettings();
  const turns = length === 'short' ? '14–20' : length === 'long' ? '60–80' : '30–40';
  const res = await generateJSON<{ title: string; lines: PodcastLine[] }>({
    system: `You write "Audio Overview" podcast scripts: two warm, curious hosts — ${hostA} and ${hostB} — having a natural, energetic deep-dive conversation about the user's sources. They explain ideas with analogies, react to each other ("Right!", "Wait, so…"), occasionally disagree, and connect concepts. Stay faithful to the sources. Never mention that this is a script or reference "the sources" too mechanically — say things like "in this material".`,
    prompt: `SOURCES:\n\n${formatPlain(corpus)}\n\n---\nWrite the episode as ${turns} dialogue turns alternating mostly between ${hostA} and ${hostB}. Open with a hook, cover the most important ideas in a logical arc, and close with a memorable takeaway.${focus ? `\nFocus especially on: ${focus}` : ''}\nEach line's "speaker" must be exactly "${hostA}" or "${hostB}".`,
    schema: S.obj({ title: S.str(), lines: S.arr(S.obj({ speaker: S.enum([hostA, hostB]), text: S.str() })) }),
    temperature: 0.85,
    maxOutputTokens: 32000,
    signal,
  });
  const lines = (res?.lines ?? []).filter((l) => l && typeof l.text === 'string' && l.text.trim());
  if (!lines.length) throw new Error('The podcast script came back empty — try again.');
  return { title: res.title || 'Audio Overview', lines };
}

/** Renders the script with Gemini multi-speaker TTS, in batches to stay under limits. */
export async function renderPodcastAudio(lines: PodcastLine[], onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<Blob> {
  const s = getSettings();
  const speakers = [
    { name: s.hostA, voice: s.voiceA },
    { name: s.hostB, voice: s.voiceB },
  ];
  const batches: PodcastLine[][] = [];
  let cur: PodcastLine[] = [];
  let chars = 0;
  for (const l of lines) {
    if (chars + l.text.length > 2400 && cur.length) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(l);
    chars += l.text.length;
  }
  if (cur.length) batches.push(cur);
  const pcm: Uint8Array[] = [];
  let rate = 24000;
  for (let i = 0; i < batches.length; i++) {
    onProgress(i, batches.length);
    const script = batches[i].map((l) => `${l.speaker}: ${l.text}`).join('\n');
    const r = await tts(script, speakers, signal);
    rate = r.sampleRate;
    pcm.push(r.pcm, silence(350, rate));
  }
  onProgress(batches.length, batches.length);
  return pcmToWav(concatBytes(pcm), rate);
}

// ---------------------------------------------------------------- transcription

export interface TranscribeOptions {
  context?: string;
  language?: string;
  signal?: AbortSignal;
}

/** Closes a truncated JSON array of objects so partial transcripts are kept. */
export function salvageSegments(text: string): any[] {
  try {
    const j = JSON.parse(text);
    return Array.isArray(j) ? j : j.segments ?? [];
  } catch {
    const start = text.indexOf('[');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < 0) return [];
    try {
      return JSON.parse(text.slice(start, end + 1) + ']');
    } catch {
      return [];
    }
  }
}

export async function transcribe(blob: Blob, mime: string, name: string, o: TranscribeOptions = {}): Promise<TranscriptSegment[]> {
  const part = await blobPart(blob, mime, name, o.signal);
  const lang = o.language && o.language !== 'auto' ? `The audio is in ${o.language}; transcribe in that language.` : 'Transcribe in the language spoken (do not translate).';
  const text = await generate({
    model: getSettings().textModel,
    parts: [part],
    prompt: `Produce a complete, accurate, verbatim transcript of this recording.
- ${lang}
- Split into segments of 1–3 sentences (roughly 10–30 seconds each).
- "start" is the segment start time from the beginning of the recording as "mm:ss" (or "h:mm:ss").
- Label speakers consistently: use their names if they are stated, otherwise "Speaker 1", "Speaker 2"… (a lecture with one voice is just "Lecturer").
- Remove filler words (um, uh) and false starts, but never paraphrase or summarise.
- Spell technical terms, names and formulas correctly.${o.context ? `\n- Context and vocabulary to expect: ${o.context}` : ''}
Return only JSON: an array of {"start","speaker","text"}.`,
    schema: S.arr(S.obj({ start: S.str(), speaker: S.str(), text: S.str() })),
    temperature: 0,
    maxOutputTokens: 65536,
    signal: o.signal,
  });
  const segs = salvageSegments(text);
  if (!segs.length) throw new Error('Transcription came back empty. Is there speech in the recording?');
  return segs
    .filter((s) => s && typeof s.text === 'string' && s.text.trim())
    .map((s) => ({ start: parseClock(String(s.start ?? '0')), speaker: s.speaker || undefined, text: s.text.trim() }));
}

export function transcriptToText(segs: TranscriptSegment[]): string {
  let out = '';
  let last = '';
  for (const s of segs) {
    const spk = s.speaker && s.speaker !== last ? `${s.speaker}: ` : '';
    last = s.speaker ?? last;
    out += `${spk}${s.text}\n`;
  }
  return out.trim();
}

const NOTES_PROMPT = `Turn this lecture transcript into outstanding study notes in Markdown — the kind a top student would write.
Structure:
1. A first line "# <Clear descriptive title>"
2. "## Summary" — 3–5 sentences.
3. "## Key Takeaways" — bullet list.
4. Detailed notes organised into "## " sections following the lecture's flow, using "### " subsections, bullets, **bold key terms**, tables for comparisons, and LaTeX-free plain formulas.
5. "## Definitions" — term: definition bullets.
6. "## Examples & Applications" when relevant.
7. "## Review Questions" — 5 questions as a checklist ("- [ ] question").
Be faithful to the transcript; fix obvious speech-recognition errors.`;

export async function lectureNotes(transcript: string, hint?: string, signal?: AbortSignal): Promise<{ title: string; markdown: string }> {
  const md = await generate({
    prompt: `${NOTES_PROMPT}${hint ? `\nTopic/context: ${hint}` : ''}\n\nTRANSCRIPT:\n${transcript}`,
    temperature: 0.3,
    signal,
  });
  const m = md.match(/^#\s+(.+)$/m);
  return { title: m?.[1]?.trim() || 'Lecture notes', markdown: md };
}

// ---------------------------------------------------------------- flashcards & quizzes

export interface GeneratedCard {
  type: CardType;
  front: string;
  back: string;
  options?: string[];
  answer?: number;
  explanation?: string;
}

export async function generateCards(material: string, count: number, types: CardType[], signal?: AbortSignal): Promise<GeneratedCard[]> {
  const typeHelp: Record<CardType, string> = {
    basic: '"basic": front = question/term, back = concise answer',
    cloze: '"cloze": front = a full sentence with the key term wrapped like {{c1::term}}, back = optional extra context',
    mcq: '"mcq": front = question, options = 4 plausible choices, answer = index of the correct option (0-3), back = the correct option text',
    tf: '"tf": front = a statement, answer = 1 if true or 0 if false, back = "True" or "False"',
    typed: '"typed": front = question with a short exact answer (a term, name, number), back = the expected answer',
  };
  const res = await generateJSON<{ cards: GeneratedCard[] }>({
    system: 'You are an expert learning designer. You write atomic, unambiguous flashcards that test understanding, not trivia. Each card tests one idea.',
    prompt: `MATERIAL:\n${material.slice(0, 400_000)}\n\n---\nCreate ${count} high-quality study cards covering the most important concepts, spread across the whole material. Use these card types (mix them evenly): ${types.map((t) => typeHelp[t]).join('; ')}. Add a one-sentence "explanation" to every card explaining why the answer is right.`,
    schema: S.obj({
      cards: S.arr(
        S.obj(
          {
            type: S.enum(types),
            front: S.str(),
            back: S.str(),
            options: S.arr(S.str()),
            answer: S.int(),
            explanation: S.str(),
          },
          ['type', 'front', 'back', 'explanation'],
        ),
      ),
    }),
    temperature: 0.5,
    signal,
  });
  return (res.cards ?? []).filter((c) => {
    if (!c.front) return false;
    if (c.type === 'mcq') return Array.isArray(c.options) && c.options.length >= 2 && typeof c.answer === 'number' && c.answer >= 0 && c.answer < c.options.length;
    if (c.type === 'tf') return c.answer === 0 || c.answer === 1;
    if (c.type === 'cloze') return /\{\{c\d+::/.test(c.front);
    return !!c.back;
  });
}

export async function folderMaterial(folderId: string): Promise<string> {
  return formatPlain(sampleChunks(await getCorpus(folderId), 300_000));
}

export async function gradeTyped(question: string, expected: string, given: string): Promise<{ correct: boolean; feedback: string }> {
  return generateJSON({
    prompt: `Flashcard question: ${question}\nExpected answer: ${expected}\nStudent answered: ${given}\n\nIs the student's answer correct in meaning (ignore spelling slips, synonyms and word order)? Give one short sentence of feedback.`,
    schema: S.obj({ correct: S.bool(), feedback: S.str() }),
    temperature: 0,
  });
}

export async function explainCard(question: string, answer: string, given?: string): Promise<string> {
  return generate({
    prompt: `Explain this flashcard to a student in a friendly tutor voice, in under 120 words, with a memorable hook or mnemonic.\nQuestion: ${question}\nCorrect answer: ${answer}${given ? `\nThe student answered: ${given} — briefly address the misconception.` : ''}`,
    temperature: 0.6,
  });
}

// ---------------------------------------------------------------- writing tools

export const WRITING_TOOLS = {
  summarize: { label: 'Summarize', prompt: 'Summarize this into a short paragraph followed by key bullet points.' },
  keypoints: { label: 'Key points', prompt: 'Extract the key points as a concise bulleted list.' },
  table: { label: 'Make a table', prompt: 'Reorganize this information into a well-structured Markdown table (add a short intro line).' },
  proofread: { label: 'Proofread', prompt: 'Proofread and correct spelling, grammar and punctuation. Keep wording and formatting otherwise identical. Return only the corrected text.' },
  rewrite: { label: 'Rewrite', prompt: 'Rewrite this to be clearer and better organized while keeping all information.' },
  concise: { label: 'Make concise', prompt: 'Rewrite this to be about half as long without losing important information.' },
  friendly: { label: 'Friendly tone', prompt: 'Rewrite this in a warm, friendly tone.' },
  professional: { label: 'Professional tone', prompt: 'Rewrite this in a polished, professional tone.' },
  explain: { label: 'Explain like I’m new', prompt: 'Explain this simply, as to a smart beginner, with an analogy and an example.' },
  continue: { label: 'Continue writing', prompt: 'Continue writing naturally from where this text ends, matching style and format. Return only the continuation.' },
  outline: { label: 'Make an outline', prompt: 'Turn this into a hierarchical outline with headings and nested bullets.' },
  actions: { label: 'Action items', prompt: 'Extract all action items and to-dos as a Markdown checklist ("- [ ] ..."). If none, say so.' },
} as const;

export type WritingTool = keyof typeof WRITING_TOOLS;

export async function runWritingTool(tool: WritingTool | 'custom', text: string, custom?: string, signal?: AbortSignal): Promise<string> {
  const instruction = tool === 'custom' ? custom ?? '' : WRITING_TOOLS[tool].prompt;
  return generate({
    system: 'You are a writing assistant inside a notes app. Output Markdown only — no preamble like "Here is".',
    prompt: `${instruction}\n\nTEXT:\n${text}`,
    temperature: 0.4,
    signal,
  });
}

export async function handwritingToText(png: Blob): Promise<string> {
  return generate({
    parts: [await blobPart(png, 'image/png', 'handwriting.png')],
    prompt:
      'Transcribe the handwriting in this image into clean Markdown text, preserving structure (headings, bullets, numbered lists). Write math in plain text. Describe any diagrams briefly in [brackets]. Return only the transcription.',
    temperature: 0,
  });
}
