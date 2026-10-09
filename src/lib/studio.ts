import { db, putBlob, uid, type StudioItem } from '../db';
import { generateMindMap, generatePodcastScript, generateStudioDoc, renderPodcastAudio, type PodcastLength } from './ai';
import { toast, toastError } from './events';

/** Typed wrapper — Dexie's key-path types recurse on MindNode. */
const patch = (id: string, p: Partial<StudioItem>) => (db.studio as any).update(id, p) as Promise<number>;

const TITLES: Record<StudioItem['kind'], string> = {
  podcast: 'Audio Overview',
  briefing: 'Briefing Doc',
  studyguide: 'Study Guide',
  faq: 'FAQ',
  timeline: 'Timeline',
  cheatsheet: 'Cheat Sheet',
  mindmap: 'Mind Map',
};

export async function runStudio(folderId: string, kind: StudioItem['kind'], opts: { length?: PodcastLength; focus?: string } = {}) {
  const id = uid();
  await db.studio.add({ id, folderId, kind, title: TITLES[kind], status: 'working', progress: kind === 'podcast' ? 'Writing the script…' : 'Reading your sources…', createdAt: Date.now() });
  try {
    if (kind === 'mindmap') {
      const mind = await generateMindMap(folderId);
      await patch(id, { mind, title: `Mind Map · ${mind.label}`, status: 'ready' });
    } else if (kind === 'podcast') {
      const { title, lines } = await generatePodcastScript(folderId, opts.length ?? 'default', opts.focus ?? '');
      await patch(id, { script: lines, title: title || 'Audio Overview', progress: 'Recording voices…' });
      await renderPodcastVoices(id);
      return;
    } else {
      const { title, markdown } = await generateStudioDoc(folderId, kind);
      await patch(id, { markdown, title, status: 'ready' });
    }
    toast(`${TITLES[kind]} is ready`, 'success');
  } catch (e) {
    await patch(id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
    toastError(e);
  }
}

/** Renders studio-quality voices; on failure the script still plays with device voices. */
export async function renderPodcastVoices(id: string) {
  const item = await db.studio.get(id);
  if (!item?.script) return;
  await patch(id, { status: 'working', progress: 'Recording voices…', error: undefined });
  try {
    const wav = await renderPodcastAudio(item.script, (done, total) => {
      patch(id, { progress: `Recording voices ${Math.min(done + 1, total)}/${total}…` });
    });
    if (item.audioBlobId) await db.blobs.delete(item.audioBlobId);
    const audioBlobId = await putBlob(wav, `${item.title}.wav`);
    await patch(id, { audioBlobId, status: 'ready', progress: undefined });
    toast('Audio Overview is ready 🎧', 'success');
  } catch (e) {
    await patch(id, {
      status: 'ready',
      progress: undefined,
      error: `Studio voices unavailable (${e instanceof Error ? e.message : e}). You can play it with your device's voices.`,
    });
    toast('Script ready — studio voices hit a limit, so it will play with device voices.', 'info');
  }
}
