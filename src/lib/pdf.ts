import type { RawPage } from './retrieval';

// pdf.js draws pages with Map#getOrInsertComputed, a newer built-in than
// Safari and Chromium ship yet. Add the standard behaviour where it's missing.
for (const C of [Map, WeakMap]) {
  const proto = C.prototype as any;
  proto.getOrInsert ??= function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
    if (!this.has(key)) this.set(key, value);
    return this.get(key);
  };
  proto.getOrInsertComputed ??= function (this: Map<unknown, unknown>, key: unknown, make: (k: unknown) => unknown) {
    if (!this.has(key)) this.set(key, make(key));
    return this.get(key);
  };
}

/** Extracts text per page with pdf.js (runs locally, free, offline). */
export async function extractPdf(file: Blob): Promise<{ pages: RawPage[]; title?: string }> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: RawPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let text = '';
    let lastY: number | null = null;
    for (const item of tc.items as any[]) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) {
        // A larger vertical jump usually means a new paragraph.
        text += Math.abs(y - lastY) > (item.height || 10) * 1.6 ? '\n\n' : '\n';
      }
      text += item.str;
      if (item.hasEOL) text += '\n';
      lastY = y ?? lastY;
    }
    pages.push({ page: i, text: text.replace(/[ \t]+\n/g, '\n').replace(/-\n(?=[a-z])/g, '') });
    page.cleanup();
  }
  let title: string | undefined;
  try {
    const meta: any = await doc.getMetadata();
    title = meta?.info?.Title || undefined;
  } catch {
    /* no metadata */
  }
  await task.destroy();
  return { pages, title };
}

/** The first page of a PDF drawn as a JPEG data URL, and its page count. */
export async function pdfFirstPage(file: Blob, width = 480): Promise<{ image: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport } as any).promise;
    return { image: canvas.toDataURL('image/jpeg', 0.8), pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}
