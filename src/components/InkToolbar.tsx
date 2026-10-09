import type { ReactNode } from 'react';
import { displayColor, HIGHLIGHTS, INK_PALETTE, setTool, setToolColor, setToolSize, useTool, type Tool } from '../lib/ink';
import { updateSettings, useSettings } from '../lib/settings';
import { useDark } from '../lib/theme';
import { IEraser, IHighlighter, ILasso, IMarker, IPencil, IRedo, ITrash, IUndo } from './Icons';

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

/** PencilKit-style tool palette, shared by handwritten notes and inline sketches. */
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
  const { fingerDrawing } = useSettings();
  const dark = useDark();
  const palette = tool.ink === 'marker' ? HIGHLIGHTS : INK_PALETTE;
  return (
    <div className={`ink-toolbar glass ${className}`} onPointerDown={(e) => e.stopPropagation()} role="toolbar" aria-label="Drawing tools">
      <div className="ink-tools">
        {TOOLS.map(([t, icon, label]) => (
          <button key={t} className={`ink-tool ${tool.tool === t ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={tool.tool === t} onClick={() => setTool(t)}>
            {icon}
          </button>
        ))}
      </div>
      <span className="ink-sep" />
      <div className="ink-colors">
        {palette.map(({ c, name }) => (
          <button
            key={c}
            className={`swatch ${tool.color === c && tool.tool !== 'eraser' && tool.tool !== 'lasso' ? 'on' : ''}`}
            style={{ ['--sw' as string]: displayColor(c, dark) }}
            aria-label={name}
            title={name}
            onClick={() => setToolColor(c)}
          />
        ))}
        <label className="swatch custom" title="Custom colour">
          <input type="color" value={tool.color} onChange={(e) => setToolColor(e.target.value)} aria-label="Custom colour" />
        </label>
      </div>
      <span className="ink-sep" />
      <div className="ink-sizes">
        {SIZES[tool.ink].map((s) => (
          <button key={s} className={`size-dot ${tool.size === s ? 'on' : ''}`} onClick={() => setToolSize(s)} aria-label={`Width ${s}`}>
            <span style={{ width: 2 + s * (tool.ink === 'marker' ? 1.6 : 1.2), height: 2 + s * (tool.ink === 'marker' ? 1.6 : 1.2) }} />
          </button>
        ))}
      </div>
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
        <label className="finger-toggle" title="Draw with finger (off: only Apple Pencil draws, fingers scroll)">
          <input type="checkbox" checked={fingerDrawing} onChange={(e) => updateSettings({ fingerDrawing: e.target.checked })} />
          <span>Finger</span>
        </label>
        {children}
      </div>
    </div>
  );
}
