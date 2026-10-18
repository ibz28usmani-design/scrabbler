import { createPortal } from 'react-dom';
import { useLayoutEffect, useRef, useState, useEffect } from 'react';
import { ICONS } from './AppIcon';

/** A grid of the app's icons to choose one from, anchored like a menu. */
export function IconPicker({ anchor, icons, onPick, onClose }: { anchor: HTMLElement; icons: string[]; onPick: (name: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const el = ref.current!;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8));
    let top = r.bottom + 6;
    if (top + el.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - el.offsetHeight - 6);
    setPos({ top, left });
  }, [anchor]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div className="menu icon-picker" ref={ref} style={pos} role="menu" aria-label="Choose an icon">
      {icons.map((name) => {
        const G = ICONS[name];
        return (
          <button
            key={name}
            role="menuitem"
            className="menu-item"
            aria-label={name}
            title={name}
            onClick={() => {
              onClose();
              onPick(name);
            }}
          >
            <G size={20} />
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
