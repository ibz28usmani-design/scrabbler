/** Getting a generated file onto the device: the iOS share sheet ("Save to Files") or a download. */
import { download } from '../backup';

export interface OutFile {
  name: string;
  blob: Blob;
}

const asFile = (f: OutFile) => new File([f.blob], f.name, { type: f.blob.type || 'application/octet-stream' });

export function canShareFiles(files: OutFile[]): boolean {
  try {
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files: files.map(asFile) });
  } catch {
    return false;
  }
}

/** Must be called straight from a tap — Safari only allows sharing inside a user gesture. */
export async function shareFiles(files: OutFile[], title?: string): Promise<'shared' | 'cancelled'> {
  try {
    await navigator.share({ files: files.map(asFile), title });
    return 'shared';
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
    throw e;
  }
}

export function downloadFiles(files: OutFile[]) {
  files.forEach((f, i) => setTimeout(() => download(f.blob, f.name), i * 250));
}

/** Opens the system print dialog for a standalone HTML document (also "Save as PDF" on every OS). */
export function printHtml(html: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0';
  document.body.appendChild(frame);
  frame.onload = () => {
    const w = frame.contentWindow;
    if (!w) return;
    w.focus();
    // Let fonts and images settle before the print snapshot.
    setTimeout(() => {
      w.print();
      setTimeout(() => frame.remove(), 60_000);
    }, 250);
  };
  frame.srcdoc = html;
}
