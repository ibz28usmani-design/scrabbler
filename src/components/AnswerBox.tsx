import type { Stroke } from '../lib/ink';
import { transcribeHandwriting } from '../lib/ai';
import { renderInkPages } from '../lib/inkRender';
import { canReadImages } from '../lib/llm';
import { PAGE_H } from '../lib/paper';
import { useDark } from '../lib/theme';
import { SketchCanvas } from './SketchCanvas';
import { Segmented } from './ui';

/*
 * An answer typed, or written by hand with the Pencil on lined paper: the
 * tutor's exercises and flashcards that ask you to write the answer.
 */

export interface Answer {
  mode: 'typed' | 'hand';
  text: string;
  strokes: Stroke[];
  height: number;
}

export const emptyAnswer = (): Answer => ({ mode: 'typed', text: '', strokes: [], height: PAGE_H });

/** The answer as text: typed as it is, handwriting read by the AI first. */
export async function answerText(a: Answer): Promise<string> {
  if (a.mode === 'typed') return a.text.trim();
  if (!a.strokes.length) return '';
  if (!canReadImages()) throw new Error('Reading handwriting needs a model that can see images: add a Gemini key in Settings.');
  const pages = await renderInkPages({ strokes: a.strokes, paper: 'lines' }, { scale: 1.5, template: false });
  return (await transcribeHandwriting(pages, 'formatted', 'lines')).trim();
}

/** Typed, or written by hand with the Pencil on lined paper. */
export function AnswerBox({ value, onChange, placeholder, rows = 10, compact = false }: { value: Answer; onChange: (a: Answer) => void; placeholder: string; rows?: number; compact?: boolean }) {
  const dark = useDark();
  return (
    <div className="answer-box">
      {/* A flashcard has its own Write / Type switch beside Check. */}
      {!compact && (
        <Segmented
          value={value.mode}
          onChange={(mode) => onChange({ ...value, mode })}
          options={[
            { value: 'typed', label: 'Type' },
            { value: 'hand', label: 'Write by hand' },
          ]}
        />
      )}
      {value.mode === 'typed' ? (
        <textarea className="input answer-text" rows={rows} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} placeholder={placeholder} />
      ) : (
        <div className={`editor-pane answer-ink${compact ? ' compact' : ''}`}>
          <div className="editor-scroll">
            <SketchCanvas
              paper="lines"
              page
              strokes={value.strokes}
              height={value.height}
              dark={dark}
              active
              onActivate={() => {}}
              onChange={(p) => onChange({ ...value, ...(p.strokes ? { strokes: p.strokes } : {}), ...(p.height ? { height: p.height } : {}) })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

