import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: false });

export function mdToHtml(md: string | undefined | null): string {
  return DOMPurify.sanitize(marked.parse(md ?? '', { async: false }) as string);
}

/** Converts GFM task lists into TipTap's taskList/taskItem markup. */
export function mdToEditorHtml(md: string | undefined | null): string {
  const html = mdToHtml(md);
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  doc.querySelectorAll('ul').forEach((ul) => {
    const items = Array.from(ul.children).filter((c) => c.tagName === 'LI');
    if (!items.length || !items.every((li) => li.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]'))) return;
    ul.setAttribute('data-type', 'taskList');
    items.forEach((li) => {
      const box = li.querySelector('input[type=checkbox]') as HTMLInputElement;
      li.setAttribute('data-type', 'taskItem');
      li.setAttribute('data-checked', box.checked ? 'true' : 'false');
      box.remove();
    });
  });
  return doc.body.firstElementChild!.innerHTML;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
