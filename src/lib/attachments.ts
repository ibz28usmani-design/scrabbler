/**
 * Files inside typed notes, as Notion has them: PDFs, video, audio and any
 * other file, stored on the device with the rest of the note's data.
 */
import type { Editor } from '@tiptap/core';
import { putBlob } from '../db';
import { toast, toastError } from './events';

/** Backups hold every file as text in one JSON file; past this they get unwieldy. */
export const MAX_ATTACHMENT = 100 * 1024 * 1024;

export type AttachmentKind = 'pdf' | 'video' | 'audio' | 'image' | 'file';

export function attachmentKind(mime: string, name = ''): AttachmentKind {
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (mime.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(name)) return 'video';
  if (mime.startsWith('audio/') || /\.(mp3|m4a|wav|aac|ogg|flac|opus)$/i.test(name)) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  return 'file';
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/**
 * Opens the system file picker. Call it straight from a tap or key press: iPadOS
 * only shows the picker inside a user gesture. Resolves to [] if cancelled.
 */
export function pickFiles(accept = '', multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}

export async function downscaleImage(file: Blob, max = 1600): Promise<string> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.86);
}

/**
 * Puts files into a note at a position (or the cursor): pictures as images,
 * everything else as an attachment block, then a line to keep typing on.
 * Returns how many went in.
 */
export async function insertFiles(editor: Editor, files: File[], at?: number): Promise<number> {
  const nodes: Record<string, unknown>[] = [];
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT) {
      toast(`“${file.name}” is ${formatBytes(file.size)} — files up to ${formatBytes(MAX_ATTACHMENT)} can go in a note.`, 'error');
      continue;
    }
    try {
      const kind = attachmentKind(file.type, file.name);
      nodes.push(
        kind === 'image' && file.type !== 'image/svg+xml'
          ? { type: 'image', attrs: { src: await downscaleImage(file) } }
          : { type: 'attachment', attrs: { blobId: await putBlob(file, file.name, 'attachment'), name: file.name, mime: file.type || 'application/octet-stream', size: file.size } },
      );
    } catch (e) {
      toastError(e);
    }
  }
  if (!nodes.length || editor.isDestroyed) return 0;
  const chain = editor.chain().focus();
  if (at !== undefined) chain.setTextSelection(at);
  // The trailing line keeps the new block from staying selected, where the next
  // keystroke would replace it.
  chain.insertContent([...nodes, { type: 'paragraph' }]).run();
  return nodes.length;
}

/** /file, /pdf, /video, /audio: pick from the device and attach. */
export async function attachFromPicker(editor: Editor, accept: string) {
  const files = await pickFiles(accept, true);
  if (!files.length) return editor.commands.focus();
  await insertFiles(editor, files);
}
