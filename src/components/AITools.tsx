import type { Editor } from '@tiptap/react';
import { useRef, useState } from 'react';
import type { Note } from '../db';
import { runWritingTool, WRITING_TOOLS, type WritingTool } from '../lib/ai';
import { hasKey } from '../lib/gemini';
import { mdToEditorHtml, mdToHtml } from '../lib/markdown';
import { openModal } from '../lib/nav';
import { toast, toastError } from '../lib/events';
import { Menu, Modal, Spinner, useMenu } from './ui';
import { ICards, ICopy, ISparkle } from './Icons';

interface Result {
  title: string;
  md: string | null;
  replace: boolean;
  range: { from: number; to: number };
}

export function AIToolsButton({ editor, note }: { editor: Editor; note: Note }) {
  const [anchor, open, close] = useMenu();
  const [result, setResult] = useState<Result | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const abort = useRef<AbortController | null>(null);

  const run = async (tool: WritingTool | 'custom', instruction?: string) => {
    if (!hasKey()) {
      toast('Add your free Gemini key in Settings to use AI tools.', 'error');
      openModal({ type: 'settings' });
      return;
    }
    const { from, to, empty } = editor.state.selection;
    const text = empty ? editor.getText({ blockSeparator: '\n' }) : editor.state.doc.textBetween(from, to, '\n');
    if (!text.trim()) return toast('Write something first, or select text to transform.', 'info');
    const range = empty ? { from: editor.state.doc.content.size, to: editor.state.doc.content.size } : { from, to };
    const replace = !empty && tool !== 'continue' && tool !== 'actions';
    setResult({ title: tool === 'custom' ? instruction! : WRITING_TOOLS[tool].label, md: null, replace, range });
    abort.current = new AbortController();
    try {
      const md = await runWritingTool(tool, text, instruction, abort.current.signal);
      setResult((r) => (r ? { ...r, md } : r));
    } catch (e) {
      toastError(e);
      setResult(null);
    }
  };

  const apply = (mode: 'replace' | 'insert') => {
    if (!result?.md) return;
    const html = mdToEditorHtml(result.md);
    if (mode === 'replace') editor.chain().focus().insertContentAt(result.range, html).run();
    else editor.chain().focus().insertContentAt(result.range.to, html).run();
    setResult(null);
  };

  const tools = Object.entries(WRITING_TOOLS) as [WritingTool, (typeof WRITING_TOOLS)[WritingTool]][];

  return (
    <>
      <button className="icon-btn ai" onClick={(e) => open(e.currentTarget)} aria-label="AI tools">
        <ISparkle />
        <span className="btn-label">AI</span>
      </button>
      {anchor && (
        <Menu
          anchor={anchor}
          onClose={close}
          items={[
            { label: 'Ask AI to…', icon: <ISparkle size={17} />, onClick: () => setCustomOpen(true), hint: 'custom' },
            { divider: true, label: '' },
            ...tools.map(([k, t]) => ({ label: t.label, onClick: () => run(k) })),
            { divider: true, label: '' },
            { label: 'Flashcards from this note', icon: <ICards size={17} />, onClick: () => openModal({ type: 'generateDeck', from: { kind: 'note', noteId: note.id } }) },
            { label: 'Quiz me on this note', icon: <ICards size={17} />, onClick: () => openModal({ type: 'generateDeck', from: { kind: 'note', noteId: note.id }, quiz: true }) },
          ]}
        />
      )}
      {customOpen && (
        <Modal title="Ask AI" onClose={() => setCustomOpen(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!custom.trim()) return;
              setCustomOpen(false);
              run('custom', custom.trim());
            }}
          >
            <p className="muted">Applies to your selection, or the whole note if nothing is selected.</p>
            <textarea className="input" rows={3} autoFocus placeholder="e.g. Turn this into a revision checklist with mnemonics" value={custom} onChange={(e) => setCustom(e.target.value)} />
            <div className="confirm-actions">
              <button type="submit" className="btn primary">
                <ISparkle size={16} /> Run
              </button>
            </div>
          </form>
        </Modal>
      )}
      {result && (
        <Modal
          title={
            <>
              <ISparkle size={18} /> {result.title}
            </>
          }
          onClose={() => {
            abort.current?.abort();
            setResult(null);
          }}
          wide
          footer={
            result.md && (
              <>
                <button
                  className="btn"
                  onClick={() => {
                    navigator.clipboard.writeText(result.md!);
                    toast('Copied', 'success');
                  }}
                >
                  <ICopy size={16} /> Copy
                </button>
                <span className="spacer" />
                <button className="btn" onClick={() => apply('insert')}>
                  Insert below
                </button>
                {result.replace && (
                  <button className="btn primary" onClick={() => apply('replace')}>
                    Replace selection
                  </button>
                )}
              </>
            )
          }
        >
          {result.md === null ? (
            <div className="center pad">
              <Spinner size={22} />
            </div>
          ) : (
            <div className="prose md" dangerouslySetInnerHTML={{ __html: mdToHtml(result.md) }} />
          )}
        </Modal>
      )}
    </>
  );
}
