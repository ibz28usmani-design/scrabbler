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
  const isTask = (li: Element) => !!li.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]');
  doc.querySelectorAll('ul').forEach((ul) => {
    const items = Array.from(ul.children).filter((c) => c.tagName === 'LI');
    if (!items.some(isTask)) return;
    // A list mixing bullets and checkboxes becomes consecutive bullet and task lists.
    const runs: Element[][] = [];
    for (const li of items) {
      const last = runs[runs.length - 1];
      if (last && isTask(last[0]) === isTask(li)) last.push(li);
      else runs.push([li]);
    }
    const lists = runs.map((run) => {
      const list = doc.createElement('ul');
      run.forEach((li) => list.appendChild(li));
      if (isTask(run[0])) {
        list.setAttribute('data-type', 'taskList');
        run.forEach((li) => {
          const box = li.querySelector('input[type=checkbox]') as HTMLInputElement;
          li.setAttribute('data-type', 'taskItem');
          li.setAttribute('data-checked', box.checked ? 'true' : 'false');
          box.remove();
        });
      }
      return list;
    });
    ul.replaceWith(...lists);
  });
  return doc.body.firstElementChild!.innerHTML;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
