import { useEffect, useRef, useState, type ReactNode } from 'react';
import { displayColor, HIGHLIGHTS, INK_PALETTE, setTool, setToolColor, setToolSize, useTool, type Tool } from '../lib/ink';
import { updateSettings, useSettings } from '../lib/settings';
import { useDark } from '../lib/theme';
import { IChevD, IEraser, IHighlighter, ILasso, IMarker, IPencil, IRedo, ITrash, IUndo } from './Icons';

const TOOLS: [Tool, ReactNode, string][] = [
  ['pen', <IPencil key="p" />, 'Pen'],
  ['pencil', <IMarker key="m" />, 'Pencil'],
  ['marker', <IHighlighter key="h" />, 'Highlighter'],
  ['eraser', <IEraser key="e" />, 'Eraser'],
  ['lasso', <ILasso key="l" />, 'Lasso'],
];

const SIZES: Record<'pen' | 'pencil' | 'marker', number[]> = {
  pen: [2, 3, 5, 8],
  pencil: [2, 3, 5, 8],
  marker: [3, 5, 8, 12],
};

const iconFor = (t: Tool) => TOOLS.find(([k]) => k === t)![1];
const labelFor = (t: Tool) => TOOLS.find(([k]) => k === t)![2];

/**
 * PencilKit-style tool palette, shared by handwritten notes and inline sketches.
 *
 * Only the controls you reach for mid-stroke stay on the bar — the five tools,
 * the current colour, undo and redo. Colours, widths and the finger switch live
 * in a popover behind the colour chip, because a single row holding all of them
 * is wider than an iPad and silently hides whatever does not fit (undo included).
 * The whole bar collapses to a pill so it never sits on top of what you wrote.
 */
export function InkToolbar({
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onDeleteSelection,
  className = '',
  children,
}: {
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onDeleteSelection?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const tool = useTool();
  const { fingerDrawing, inkToolbarOpen } = useSettings();
  const dark = useDark();
  const [options, setOptions] = useState(false);
  const dock = useRef<HTMLDivElement>(null);
  const palette = tool.ink === 'marker' ? HIGHLIGHTS : INK_PALETTE;
  const swatch = displayColor(tool.color, dark);

  // The popover is a menu: a tap outside or Escape puts it away.
  useEffect(() => {
    if (!options) return;
    const onDown = (e: PointerEvent) => {
      if (!dock.current?.contains(e.target as Node)) setOptions(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOptions(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [options]);

  const setOpen = (open: boolean) => {
    setOptions(false);
    updateSettings({ inkToolbarOpen: open });
  };

  if (!inkToolbarOpen) {
    return (
      <div className={`ink-dock collapsed ${className}`} ref={dock} onPointerDown={(e) => e.stopPropagation()}>
        <div className="ink-toolbar glass" role="toolbar" aria-label="Drawing tools">
          <button className="ink-tool on" onClick={() => setOpen(true)} aria-label={`${labelFor(tool.tool)} — show drawing tools`} title="Show drawing tools">
            {iconFor(tool.tool)}
            {tool.tool !== 'eraser' && tool.tool !== 'lasso' && <span className="tool-ink" style={{ ['--sw' as string]: swatch }} />}
          </button>
          <button className="icon-btn" onClick={onUndo} disabled={!canUndo} aria-label="Undo">
            <IUndo />
          </button>
          <button className="ink-collapse" onClick={() => setOpen(true)} aria-label="Show drawing tools" title="Show drawing tools">
            <IChevD />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`ink-dock ${className}`} ref={dock} onPointerDown={(e) => e.stopPropagation()}>
      <div className="ink-toolbar glass" role="toolbar" aria-label="Drawing tools">
        <div className="ink-tools">
          {TOOLS.map(([t, icon, label]) => (
            <button
              key={t}
              className={`ink-tool ${tool.tool === t ? 'on' : ''}`}
              title={label}
              aria-label={label}
              aria-pressed={tool.tool === t}
              onClick={() => {
                // Tapping the tool you are already using opens its options, as PencilKit does.
                if (tool.tool === t && t !== 'eraser' && t !== 'lasso') setOptions((o) => !o);
                else {
                  setTool(t);
                  setOptions(false);
                }
              }}
            >
              {icon}
              {tool.tool === t && t !== 'eraser' && t !== 'lasso' && <span className="tool-ink" style={{ ['--sw' as string]: swatch }} />}
            </button>
          ))}
        </div>
        <span className="ink-sep" />
        <button
          className={`ink-chip ${options ? 'on' : ''}`}
          style={{ ['--sw' as string]: swatch }}
          onClick={() => setOptions((o) => !o)}
          aria-label="Colour and width"
          aria-expanded={options}
          title="Colour and width"
        >
          <span className="ink-chip-dot" />
          <IChevD size={13} />
        </button>
        <span className="ink-sep" />
        <div className="ink-actions">
          <button className="icon-btn" onClick={onUndo} disabled={!canUndo} aria-label="Undo">
            <IUndo />
          </button>
          <button className="icon-btn" onClick={onRedo} disabled={!canRedo} aria-label="Redo">
            <IRedo />
          </button>
          {onDeleteSelection && (
            <button className="icon-btn danger" aria-label="Delete selection" onClick={onDeleteSelection}>
              <ITrash />
            </button>
          )}
          {children}
        </div>
        <button className="ink-collapse" onClick={() => setOpen(false)} aria-label="Hide drawing tools" title="Hide drawing tools">
          <IChevD />
        </button>
      </div>

      {options && (
        <div className="ink-options glass" role="dialog" aria-label="Colour and width">
          <div className="ink-opt-row">
            <span className="ink-opt-label">{tool.ink === 'marker' ? 'Highlight' : 'Ink'}</span>
            <div className="ink-colors">
              {palette.map(({ c, name }) => (
                <button
                  key={c}
                  className={`swatch ${tool.color === c ? 'on' : ''}`}
                  style={{ ['--sw' as string]: displayColor(c, dark) }}
                  aria-label={name}
                  aria-pressed={tool.color === c}
                  title={name}
                  onClick={() => setToolColor(c)}
                />
              ))}
              <label className="swatch custom" title="Custom colour">
                <input type="color" value={tool.color} onChange={(e) => setToolColor(e.target.value)} aria-label="Custom colour" />
              </label>
            </div>
          </div>
          <div className="ink-opt-row">
            <span className="ink-opt-label">Width</span>
            <div className="ink-sizes">
              {SIZES[tool.ink].map((s) => (
                <button key={s} className={`size-dot ${tool.size === s ? 'on' : ''}`} onClick={() => setToolSize(s)} aria-label={`Width ${s}`} aria-pressed={tool.size === s}>
                  <span style={{ width: 2 + s * (tool.ink === 'marker' ? 1.6 : 1.2), height: 2 + s * (tool.ink === 'marker' ? 1.6 : 1.2) }} />
                </button>
              ))}
            </div>
          </div>
          <label className="check finger-check" title="Off: only Apple Pencil draws, fingers scroll">
            <input type="checkbox" checked={fingerDrawing} onChange={(e) => updateSettings({ fingerDrawing: e.target.checked })} />
            Draw with finger
          </label>
        </div>
      )}
    </div>
  );
}
