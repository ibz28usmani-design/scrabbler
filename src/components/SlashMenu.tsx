/**
 * The / menu, plus Notion's other typing triggers: @ to mention a note or
 * date, [[ to link a note, and : for emoji. All four share one popup.
 */
import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Glyph } from './AppIcon';
import { emojiItems, getSlashHost, linkItems, mentionItems, slashItems, type SlashItem } from '../lib/slashCommands';

interface ListProps {
  items: SlashItem[];
  query: string;
  loading: boolean;
  grouped: boolean;
  command: (item: SlashItem) => void;
}

export interface ListHandle {
  onKeyDown: (e: KeyboardEvent) => boolean;
}

const SuggestionList = forwardRef<ListHandle, ListProps>(function SuggestionList({ items: incoming, query, loading, grouped, command }, ref) {
  // Keep the last results on screen while the next ones load, rather than flicker.
  const last = useRef<SlashItem[]>([]);
  if (!loading) last.current = incoming;
  const items = loading ? last.current : incoming;
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setSel(0), [items]);
  useLayoutEffect(() => {
    listRef.current?.querySelector('.slash-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [sel, items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (!items.length) return false;
      if (e.key === 'ArrowDown') {
        setSel((s) => (s + 1) % items.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        setSel((s) => (s - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const it = items[Math.min(sel, items.length - 1)];
        if (it) command(it);
        return true;
      }
      return false;
    },
  }));

  if (!items.length) return null;
  const showGroups = grouped && !query.trim();
  return (
    <div className="slash-menu" ref={listRef} role="listbox" onMouseDown={(e) => e.preventDefault()}>
      {items.map((it, i) => (
        <div key={it.id} className="slash-row">
          {showGroups && it.group && it.group !== items[i - 1]?.group && <div className="slash-group">{it.group}</div>}
          <button
            role="option"
            aria-selected={i === sel}
            className={`slash-item ${i === sel ? 'on' : ''}`}
            // Only a moving pointer picks: a menu opening under a resting one must not.
            onMouseMove={(e) => (e.movementX || e.movementY) && sel !== i && setSel(i)}
            onClick={() => command(it)}
          >
            <span
              className="slash-icon"
              data-color={it.swatch?.color && it.swatch.color !== 'default' ? it.swatch.color : undefined}
              data-bg={it.swatch?.bg && it.swatch.bg !== 'default' ? it.swatch.bg : undefined}
            >
              <Glyph icon={it.icon} />
            </span>
            <span className="slash-text">
              <span className="slash-title">{it.title}</span>
              {it.hint && <span className="slash-hint">{it.hint}</span>}
            </span>
            {it.shortcut && <kbd className="slash-key">{it.shortcut}</kbd>}
          </button>
        </div>
      ))}
    </div>
  );
});

/** Runs a picked item: drill-downs retype the query, everything else replaces it. */
async function pick(editor: Editor, range: Range, item: SlashItem, char: string) {
  if (item.drill) {
    editor.chain().focus().insertContentAt({ from: range.from + char.length, to: range.to }, item.drill).run();
    return;
  }
  editor.chain().focus().deleteRange(range).run();
  await item.run?.({ editor, host: getSlashHost(editor) });
}

function trigger(name: string, char: string, opts: { items: (query: string, editor: Editor) => SlashItem[] | Promise<SlashItem[]>; allowSpaces?: boolean; grouped?: boolean; inCode?: boolean }) {
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          pluginKey: new PluginKey(name),
          editor: this.editor,
          char,
          allowSpaces: opts.allowSpaces ?? false,
          allowedPrefixes: [' ', ' '],
          allow: ({ state, range }) => {
            const $ = state.doc.resolve(range.from);
            return opts.inCode || !$.parent.type.spec.code;
          },
          items: ({ query, editor }) => opts.items(query, editor),
          command: ({ editor, range, props }) => void pick(editor, range, props, char),
          render: () => {
            let r: ReactRenderer<ListHandle, ListProps> | null = null;
            let unmount: (() => void) | undefined;
            const toList = (p: SuggestionProps<SlashItem, SlashItem>): ListProps => ({ items: p.items, query: p.query, loading: p.loading, grouped: !!opts.grouped, command: p.command });
            return {
              onStart: (p) => {
                r = new ReactRenderer(SuggestionList, { props: toList(p), editor: p.editor });
                r.element.classList.add('slash-pop');
                unmount = p.mount(r.element as HTMLElement);
              },
              onUpdate: (p) => r?.updateProps(toList(p)),
              onKeyDown: ({ event }) => r?.ref?.onKeyDown(event) ?? false,
              onExit: () => {
                unmount?.();
                r?.destroy();
                r = null;
              },
            };
          },
        }),
      ];
    },
  });
}

export const SlashCommands = trigger('slashCommands', '/', { items: slashItems, allowSpaces: true, grouped: true });
export const MentionMenu = trigger('mentionMenu', '@', { items: mentionItems, allowSpaces: true });
export const LinkMenu = trigger('linkMenu', '[[', { items: linkItems, allowSpaces: true });
export const EmojiMenu = trigger('emojiMenu', ':', { items: (q) => emojiItems(q) });

export const menuExtensions = [SlashCommands, MentionMenu, LinkMenu, EmojiMenu];
