import { db, inkToNote, type Note, type StoredBlob } from '../db';

export const TABLES = ['folders', 'notes', 'sources', 'chunks', 'chats', 'studio', 'decks', 'cards', 'reviews', 'meta', 'subjects', 'lessons', 'reminderLists', 'reminders', 'studyTime', 'tutor', 'exams', 'papers', 'shares'] as const;

/**
 * Tables a backup leaves out: files go under files/ instead, and note history
 * is this device's undo, not your work (and would make every backup far bigger).
 */
export const NOT_BACKED_UP = ['blobs', 'versions'] as const;

/**
 * A zip: the tables as backup.json, and each file (recordings, attachments)
 * stored as itself under files/. Version 1 put the files inside the JSON as
 * base64, which made one string too big to build once there were a few
 * lecture recordings; those backups still import.
 */
export async function exportBackup(): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const data: Record<string, unknown> = { app: 'scrabbler', version: 2, exportedAt: Date.now() };
  for (const t of TABLES) data[t] = await (db as any)[t].toArray();
  const blobs = await db.blobs.toArray();
  data.blobs = blobs.map(({ blob: _, ...meta }) => meta);
  zip.file('backup.json', JSON.stringify(data));
  // Already-compressed media gains nothing from deflate: store it as is.
  for (const b of blobs) zip.file(`files/${b.id}`, b.blob, { compression: 'STORE' });
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE', streamFiles: true });
}

type BlobMeta = Omit<StoredBlob, 'blob'> & { data?: string };

export async function importBackup(file: Blob) {
  const zipped = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  let data: any;
  let fileFor: (b: BlobMeta) => Promise<Blob | null>;
  if (zipped[0] === 0x50 && zipped[1] === 0x4b) {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    data = JSON.parse((await zip.file('backup.json')?.async('string')) ?? 'null');
    fileFor = async (b) => (await zip.file(`files/${b.id}`)?.async('blob')) ?? null;
  } else {
    data = JSON.parse(await file.text());
    fileFor = async (b) => (b.data === undefined ? null : new Blob([Uint8Array.from(atob(b.data), (c) => c.charCodeAt(0))]));
  }
  if (data?.app !== 'scrabbler') throw new Error('That is not a Scrabbler backup file.');
  // Handwritten notes from before handwriting moved inline come back as sketches.
  if (Array.isArray(data.notes)) data.notes = data.notes.map((n: Note) => (n.kind === 'ink' && n.ink ? { ...n, ...inkToNote(n) } : n));
  // Read every file before the transaction: IndexedDB commits a transaction left waiting on other work.
  const files: StoredBlob[] = [];
  for (const b of (data.blobs ?? []) as BlobMeta[]) {
    const raw = await fileFor(b);
    if (raw) files.push({ id: b.id, name: b.name, mime: b.mime, createdAt: b.createdAt, ...(b.kind ? { kind: b.kind } : {}), blob: new Blob([raw], { type: b.mime }) });
  }
  await db.transaction('rw', [...TABLES.map((t) => (db as any)[t]), db.blobs], async () => {
    for (const t of TABLES) if (Array.isArray(data[t])) await (db as any)[t].bulkPut(data[t]);
    await db.blobs.bulkPut(files);
  });
  const { reindexAll } = await import('./notes');
  await reindexAll();
}

export async function eraseEverything() {
  await db.delete();
  localStorage.clear();
  location.reload();
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
