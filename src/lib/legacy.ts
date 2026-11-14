/** Brings notes and folders across from the previous Scrabbler, whose database is still on this device. */
import Dexie from 'dexie';
import { generateHTML } from '@tiptap/core';
import { db, newNote } from './db';
import { EXT } from './editor';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
export async function importLegacy(): Promise<number> {
  if (!(await Dexie.exists('scrabbler'))) return 0;
  const old = new Dexie('scrabbler');
  await old.open();
  try {
    const names = old.tables.map(t => t.name);
    if (!names.includes('notes')) return 0;
    for (const f of names.includes('folders') ? await old.table('folders').toArray() : [])
      if (!(await db.folders.get(f.id))) await db.folders.add({ id: f.id, name: f.name || 'Folder', color: '#1f8a70' });
    let count = 0;
    for (const n of await old.table('notes').toArray()) {
      if (n.deletedAt || (await db.notes.get(n.id))) continue;
      let body = '';
      try { body = generateHTML(n.content, EXT); } catch { body = String(n.text || '').split('\n').map(l => `<p>${esc(l)}</p>`).join(''); }
      await db.notes.add(newNote({ id: n.id, title: n.title || '', folder: (await db.folders.get(n.folderId)) ? n.folderId : 'notes', pinned: !!n.pinned, created: n.createdAt || Date.now(), updated: n.updatedAt || Date.now(), content: { body } }));
      count++;
    }
    return count;
  } finally { old.close(); }
}
