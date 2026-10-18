/**
 * The tutor: exercises that make you retrieve and explain rather than reread
 * (blurting, the Feynman technique, exam questions and mock papers marked
 * like a mark scheme, a Socratic tutor), grounded in your own notes and
 * sources for the subject, plus where you're weakest.
 */
import { db, uid, type TutorAttempt, type TutorTool } from '../db';
import { getCorpus, type CorpusChunk } from './ai';
import { folderSubject } from './folders';
import { S } from './gemini';
import { generate, generateJSON } from './llm';
import { selectChunks } from './retrieval';

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);
const num = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Folders whose notes and sources are this subject's. */
export async function subjectFolders(subjectId: string): Promise<string[]> {
  const folders = await db.folders.toArray();
  return folders.filter((f) => folderSubject(folders, f.id) === subjectId).map((f) => f.id);
}

/**
 * The passages of a subject's notes and sources most about `topic`, for the
 * tutor to mark against. Empty when the subject has no material yet, and the
 * tutor then says it is marking from general A-level knowledge.
 */
export async function subjectMaterial(subjectId: string, topic: string, budget = 40_000): Promise<string> {
  const chunks: CorpusChunk[] = [];
  for (const id of await subjectFolders(subjectId)) chunks.push(...(await getCorpus(id)));
  if (!chunks.length) return '';
  return selectChunks(chunks, topic, budget, 20)
    .map((c) => `(${c.title}) ${c.text}`)
    .join('\n\n');
}

function grounding(material: string) {
  return material
    ? `The student's own notes and sources on this (mark against these first; where they're silent, use accurate A-level knowledge):\n"""\n${material}\n"""`
    : 'The student has no notes on this yet: mark against accurate, specification-level A-level knowledge.';
}

export interface Ctx {
  subject: string;
  /** Exam board and qualification, e.g. "AQA A-level Economics". */
  board: string;
  topic: string;
  material: string;
}

// ---------------------------------------------------------------- blurting

export interface BlurtResult {
  /** How much of what matters was recalled, 0–100. */
  score: number;
  covered: string[];
  missed: string[];
  wrong: string[];
  feedback: string;
}

/** Blurting: everything you can remember about a topic, marked for what you left out. */
export async function markBlurt(c: Ctx, answer: string): Promise<BlurtResult> {
  const r = await generateJSON<Record<string, unknown>>({
    system: 'You are a rigorous but encouraging A-level tutor marking a "blurt": a student wrote down everything they could remember about a topic, from memory.',
    prompt: `${c.board} — ${c.subject}. Topic: ${c.topic}\n\n${grounding(c.material)}\n\nThe student's blurt:\n"""\n${answer}\n"""\n\nList the key points they recalled correctly, the important points they missed (most exam-relevant first, each a short self-contained fact), and anything they got wrong. Score recall 0–100 against what a top answer would include. Feedback: two or three sentences in Markdown, specific, ending with what to revise next.`,
    schema: S.obj({ score: S.int(), covered: S.arr(S.str()), missed: S.arr(S.str()), wrong: S.arr(S.str()), feedback: S.str() }),
    temperature: 0.2,
  });
  return { score: num(r.score, 100), covered: strs(r.covered), missed: strs(r.missed), wrong: strs(r.wrong), feedback: str(r.feedback) };
}

// ---------------------------------------------------------------- Feynman

export interface FeynmanResult {
  /** 0–10. */
  score: number;
  jargon: string[];
  gaps: string[];
  followUps: string[];
  feedback: string;
}

/** The Feynman technique: explain it simply enough for a twelve-year-old, then find the holes. */
export async function markFeynman(c: Ctx, explanation: string): Promise<FeynmanResult> {
  const r = await generateJSON<Record<string, unknown>>({
    system: 'You are an A-level tutor using the Feynman technique. The student has explained a concept as if teaching a curious twelve-year-old.',
    prompt: `${c.board} — ${c.subject}. Concept: ${c.topic}\n\n${grounding(c.material)}\n\nThe student's explanation:\n"""\n${explanation}\n"""\n\nScore 0–10 for accuracy and clarity together. List jargon they used without explaining, gaps or errors in their understanding, and three probing follow-up questions a curious learner would ask that would expose any shaky understanding. Feedback: short Markdown, specific.`,
    schema: S.obj({ score: S.int(), jargon: S.arr(S.str()), gaps: S.arr(S.str()), followUps: S.arr(S.str()), feedback: S.str() }),
    temperature: 0.3,
  });
  return { score: num(r.score, 10), jargon: strs(r.jargon), gaps: strs(r.gaps), followUps: strs(r.followUps), feedback: str(r.feedback) };
}

// ---------------------------------------------------------------- exam questions

export interface ExamQuestion {
  question: string;
  marks: number;
  /** Minutes to spend, at the board's pace. */
  minutes: number;
}

export async function examQuestion(c: Ctx, marks: number): Promise<ExamQuestion> {
  const r = await generateJSON<Record<string, unknown>>({
    system: 'You are an experienced A-level examiner who writes questions exactly in the style of the named exam board: its command words, its scenario or extract conventions, and its mark allocations.',
    prompt: `Write one ${marks}-mark question for ${c.board} — ${c.subject}, on: ${c.topic}.\n${c.material ? `Base it on this content the student has studied:\n"""\n${c.material.slice(0, 12_000)}\n"""` : ''}\nInclude any scenario, extract or data the question needs, as the board would. Give the minutes a student should spend on it at the board's usual pace.`,
    schema: S.obj({ question: S.str(), minutes: S.int() }),
    temperature: 0.8,
  });
  return { question: str(r.question), marks, minutes: num(r.minutes, 120) || Math.round(marks * 1.5) };
}

export interface ExamMark {
  mark: number;
  outOf: number;
  /** The levels-of-response level, e.g. "Level 3 (7–9)"; empty for points-based questions. */
  level: string;
  /** Per assessment objective, as the board names them. */
  objectives: { ao: string; comment: string }[];
  strengths: string[];
  improvements: string[];
  /** A paragraph showing how to reach the top band. */
  model: string;
  /** Knowledge the answer lacked, short and self-contained. */
  gaps: string[];
}

export async function markExam(c: Ctx, q: ExamQuestion, answer: string): Promise<ExamMark> {
  const r = await generateJSON<Record<string, unknown>>({
    system: 'You are a senior A-level examiner. Mark strictly to the named board\'s published mark scheme conventions: its assessment objectives, its levels-of-response descriptors for extended answers, and point-based marking for short ones. Be fair, specific and honest; never inflate a mark.',
    prompt: `${c.board} — ${c.subject}\n\nQuestion (${q.marks} marks):\n"""\n${q.question}\n"""\n\n${grounding(c.material)}\n\nThe student's answer:\n"""\n${answer}\n"""\n\nMark it out of ${q.marks}. Give the level (if levels-based), a comment for each assessment objective (e.g. AO1 knowledge, AO2 application, AO3 analysis, AO4 evaluation — as this board defines them), the strengths, the most valuable improvements, one model paragraph showing what a top-band answer adds, and the knowledge the answer was missing.`,
    schema: S.obj({
      mark: S.int(),
      level: S.str(),
      objectives: S.arr(S.obj({ ao: S.str(), comment: S.str() })),
      strengths: S.arr(S.str()),
      improvements: S.arr(S.str()),
      model: S.str(),
      gaps: S.arr(S.str()),
    }),
    temperature: 0.1,
  });
  const objectives = Array.isArray(r.objectives) ? (r.objectives as { ao?: unknown; comment?: unknown }[]).map((o) => ({ ao: str(o?.ao), comment: str(o?.comment) })).filter((o) => o.ao && o.comment) : [];
  return { mark: num(r.mark, q.marks), outOf: q.marks, level: str(r.level), objectives, strengths: strs(r.strengths), improvements: strs(r.improvements), model: str(r.model), gaps: strs(r.gaps) };
}

/** A short timed paper: questions across the topics, adding up to the time allowed. */
export async function mockPaper(c: Ctx, minutes: number): Promise<{ title: string; questions: ExamQuestion[] }> {
  const r = await generateJSON<Record<string, unknown>>({
    system: 'You are an A-level examiner setting a short mock paper in the exact style of the named board.',
    prompt: `Set a ${minutes}-minute mock paper for ${c.board} — ${c.subject}${c.topic ? `, covering: ${c.topic}` : ''}. Mix short and extended questions as the board's papers do, with mark allocations that fit ${minutes} minutes at the board's pace. Include any extracts, data or scenarios the questions need.${c.material ? `\nDraw on what the student has studied:\n"""\n${c.material.slice(0, 16_000)}\n"""` : ''}`,
    schema: S.obj({ title: S.str(), questions: S.arr(S.obj({ question: S.str(), marks: S.int() })) }),
    temperature: 0.7,
  });
  const qs = Array.isArray(r.questions) ? (r.questions as { question?: unknown; marks?: unknown }[]) : [];
  const total = qs.reduce((a, q) => a + num(q.marks, 50), 0) || 1;
  return {
    title: str(r.title) || `${c.subject} mock`,
    questions: qs.map((q) => ({ question: str(q.question), marks: num(q.marks, 50), minutes: Math.round((num(q.marks, 50) / total) * minutes) })).filter((q) => q.question && q.marks),
  };
}

// ---------------------------------------------------------------- Socratic tutor

export function socraticSystem(c: Ctx): string {
  return `You are a Socratic A-level tutor for ${c.board} — ${c.subject}, working on: ${c.topic || 'whatever the student brings'}.
Teach by questioning. Never hand over the answer or write the essay. Ask one short question at a time that moves the student one step further; when they're right, say so briefly and push deeper (why? what if? how would an examiner want this applied?); when they're wrong or stuck, give the smallest hint that lets them correct themselves, then ask again. Every few turns, ask them to state the idea in their own words. Keep replies under 90 words, in Markdown.
${grounding(c.material)}`;
}

export async function socraticSummary(c: Ctx, transcript: string): Promise<{ summary: string; gaps: string[] }> {
  const r = await generateJSON<Record<string, unknown>>({
    prompt: `A Socratic tutoring session on ${c.subject} (${c.topic}) has ended. From the transcript, summarise in two Markdown sentences what the student now understands, and list the specific ideas they still found hard (short and self-contained).\n\nTranscript:\n"""\n${transcript.slice(-20_000)}\n"""`,
    schema: S.obj({ summary: S.str(), gaps: S.arr(S.str()) }),
    temperature: 0.2,
  });
  return { summary: str(r.summary), gaps: strs(r.gaps) };
}

/** Flashcards for exactly what an exercise showed you don't know yet. */
export async function cardsForGaps(subject: string, topic: string, gaps: string[]): Promise<{ front: string; back: string }[]> {
  const r = await generateJSON<Record<string, unknown>>({
    prompt: `Write one clear flashcard (question → answer) for each of these points a student missed in ${subject} (${topic}). Keep answers to one or two sentences.\n${gaps.map((g) => `- ${g}`).join('\n')}`,
    schema: S.obj({ cards: S.arr(S.obj({ front: S.str(), back: S.str() })) }),
    temperature: 0.3,
  });
  return (Array.isArray(r.cards) ? (r.cards as { front?: unknown; back?: unknown }[]) : []).map((c) => ({ front: str(c.front), back: str(c.back) })).filter((c) => c.front && c.back);
}

export async function saveAttempt(a: Omit<TutorAttempt, 'id' | 'createdAt'>) {
  await db.tutor.add({ ...a, id: uid(), createdAt: Date.now() });
}

export async function explainSimply(subject: string, idea: string): Promise<string> {
  return generate({ prompt: `Explain this ${subject} point to an A-level student in under 150 words, with one concrete example and how an examiner would expect it used:\n${idea}`, temperature: 0.5 });
}

// ---------------------------------------------------------------- weak spots

export interface WeakSpot {
  subjectId: string;
  label: string;
  /** How often it came up: missed points, lapses, wrong answers. */
  weight: number;
  from: 'tutor' | 'cards';
}

/**
 * Where you're weakest: ideas the tutor found missing more than once lately,
 * and the flashcards you keep forgetting, by subject.
 */
export async function weakSpots(subjectOfDeck: (deckId: string) => string | undefined, since = Date.now() - 45 * 86400000): Promise<WeakSpot[]> {
  const out = new Map<string, WeakSpot>();
  const add = (subjectId: string, label: string, weight: number, from: WeakSpot['from']) => {
    const key = `${subjectId}|${label.toLowerCase()}`;
    const prev = out.get(key);
    out.set(key, { subjectId, label, weight: (prev?.weight ?? 0) + weight, from });
  };
  for (const a of await db.tutor.where('createdAt').above(since).toArray()) for (const g of a.gaps ?? []) add(a.subjectId ?? 'other', g, 1, 'tutor');
  const cards = await db.cards.filter((c) => c.sched.lapses >= 2 && !c.suspended).toArray();
  for (const c of cards) add(subjectOfDeck(c.deckId) ?? 'other', c.front.replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, '…').slice(0, 140), c.sched.lapses, 'cards');
  return [...out.values()].sort((a, b) => b.weight - a.weight);
}

export const TOOL_LABEL: Record<TutorTool, string> = { blurt: 'Blurt', feynman: 'Feynman', exam: 'Exam question', socratic: 'Socratic', mock: 'Mock paper' };
