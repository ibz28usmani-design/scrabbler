/** Nested folders: the tree, a folder's path, and which subject it counts toward. */
import type { Folder, ID } from '../db';

export const OTHER_SUBJECT = 'other';

export interface FolderNode {
  folder: Folder;
  depth: number;
  children: FolderNode[];
}

/** Folders as a tree in sidebar order. A folder whose parent is gone sits at the top. */
export function folderTree(folders: Folder[]): FolderNode[] {
  const ids = new Set(folders.map((f) => f.id));
  const byParent = new Map<string, Folder[]>();
  for (const f of folders) {
    const p = f.parentId && ids.has(f.parentId) && f.parentId !== f.id ? f.parentId : '';
    byParent.set(p, [...(byParent.get(p) ?? []), f]);
  }
  const seen = new Set<string>();
  const build = (parent: string, depth: number): FolderNode[] =>
    (byParent.get(parent) ?? [])
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
      .filter((f) => !seen.has(f.id) && seen.add(f.id))
      .map((f) => ({ folder: f, depth, children: build(f.id, depth + 1) }));
  return build('', 0);
}

/** The tree flattened in display order, skipping the insides of collapsed folders. */
export function visibleRows(tree: FolderNode[]): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (nodes: FolderNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (!n.folder.collapsed) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** The folder and everything inside it. */
export function descendantIds(folders: Folder[], id: ID): ID[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const f of folders) if (f.parentId === out[i] && !out.includes(f.id)) out.push(f.id);
  return out;
}

/** Top-level folder first: [Law, Contract, Offer & acceptance]. */
export function folderPath(folders: Folder[], id: ID | undefined): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: Folder[] = [];
  let f = id ? byId.get(id) : undefined;
  while (f && !out.includes(f)) {
    out.unshift(f);
    f = f.parentId ? byId.get(f.parentId) : undefined;
  }
  return out;
}

/** The subject a folder counts toward: its own, or the nearest folder above it with one. */
export function folderSubject(folders: Folder[], id: ID | undefined): string | undefined {
  const path = folderPath(folders, id);
  for (let i = path.length - 1; i >= 0; i--) if (path[i].subjectId) return path[i].subjectId;
  return undefined;
}

/** Can `id` be moved inside `into` without putting a folder inside itself? */
export function canNest(folders: Folder[], id: ID, into: ID | undefined): boolean {
  return !into || !descendantIds(folders, id).includes(into);
}
