import { db } from '../db';
import { blobToBase64 } from './gemini';

const TABLES = ['folders', 'notes', 'sources', 'chunks', 'chats', 'studio', 'decks', 'cards', 'reviews', 'meta'] as const;

export async function exportBackup(): Promise<Blob> {
  const data: Record<string, unknown> = { app: 'scrabbler', version: 1, exportedAt: Date.now() };
  for (const t of TABLES) data[t] = await (db as any)[t].toArray();
  const blobs = await db.blobs.toArray();
  data.blobs = await Promise.all(blobs.map(async (b) => ({ ...b, blob: undefined, data: await blobToBase64(b.blob) })));
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export async function importBackup(file: Blob) {
  const data = JSON.parse(await file.text());
  if (data?.app !== 'scrabbler') throw new Error('That is not a Scrabbler backup file.');
  await db.transaction('rw', [...TABLES.map((t) => (db as any)[t]), db.blobs], async () => {
    for (const t of TABLES) if (Array.isArray(data[t])) await (db as any)[t].bulkPut(data[t]);
    for (const b of data.blobs ?? []) {
      const bin = atob(b.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await db.blobs.put({ id: b.id, name: b.name, mime: b.mime, createdAt: b.createdAt, blob: new Blob([bytes], { type: b.mime }) });
    }
  });
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
