import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useToasts } from '../lib/events';
import { IX } from './Icons';

export function Modal({
  title,
  onClose,
  children,
  wide,
  footer,
  className = '',
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true">
        {title !== undefined && (
          <div className="modal-head">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <IX />
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  hint?: string;
}

/** Anchored popover menu, repositioned to stay inside the viewport. */
export function Menu({ anchor, items, onClose, align = 'left' }: { anchor: HTMLElement; items: MenuItem[]; onClose: () => void; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const el = ref.current!;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = align === 'right' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    setPos({ top, left });
  }, [anchor, align]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div className="menu" ref={ref} style={pos} role="menu">
      {items.map((it, i) =>
        it.divider ? (
          <div key={i} className="menu-divider" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            {it.icon && <span className="menu-icon">{it.icon}</span>}
            <span className="menu-label">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Small helper hook: returns [element|null, open(el), close()] for menus. */
export function useMenu() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return [anchor, (el: HTMLElement) => setAnchor((a) => (a === el ? null : el)), () => setAnchor(null)] as const;
}

export function Toasts() {
  const [toasts, dismiss] = useToasts();
  return createPortal(
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

let confirmImpl: ((msg: string, danger?: string) => Promise<boolean>) | null = null;

export function confirmDialog(message: string, dangerLabel = 'Delete'): Promise<boolean> {
  if (confirmImpl) return confirmImpl(message, dangerLabel);
  return Promise.resolve(window.confirm(message));
}

export function ConfirmHost() {
  const [state, setState] = useState<{ msg: string; label: string; resolve: (v: boolean) => void } | null>(null);
  useEffect(() => {
    confirmImpl = (msg, label = 'Delete') => new Promise((resolve) => setState({ msg, label, resolve }));
    return () => {
      confirmImpl = null;
    };
  }, []);
  if (!state) return null;
  const done = (v: boolean) => {
    state.resolve(v);
    setState(null);
  };
  return (
    <Modal onClose={() => done(false)} className="confirm">
      <p className="confirm-msg">{state.msg}</p>
      <div className="confirm-actions">
        <button className="btn" onClick={() => done(false)}>
          Cancel
        </button>
        <button className="btn danger" autoFocus onClick={() => done(true)}>
          {state.label}
        </button>
      </div>
    </Modal>
  );
}

let promptImpl: ((title: string, initial: string, placeholder?: string) => Promise<string | null>) | null = null;

export function promptDialog(title: string, initial = '', placeholder?: string): Promise<string | null> {
  if (promptImpl) return promptImpl(title, initial, placeholder);
  return Promise.resolve(window.prompt(title, initial));
}

export function PromptHost() {
  const [state, setState] = useState<{ title: string; value: string; placeholder?: string; resolve: (v: string | null) => void } | null>(null);
  useEffect(() => {
    promptImpl = (title, initial, placeholder) => new Promise((resolve) => setState({ title, value: initial, placeholder, resolve }));
    return () => {
      promptImpl = null;
    };
  }, []);
  if (!state) return null;
  const done = (v: string | null) => {
    state.resolve(v);
    setState(null);
  };
  return (
    <Modal title={state.title} onClose={() => done(null)} className="prompt">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          done(state.value.trim() || null);
        }}
      >
        <input className="input" autoFocus value={state.value} placeholder={state.placeholder} onChange={(e) => setState({ ...state, value: e.target.value })} />
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={() => done(null)}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            OK
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export function useObjectUrl(blob: Blob | undefined | null) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/** Keeps one crashing panel from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <div className="empty-title">Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}.</div>
        <div className="muted small">{this.state.error.message}</div>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
