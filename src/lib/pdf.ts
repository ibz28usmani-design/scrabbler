import type { RawPage } from './retrieval';

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
