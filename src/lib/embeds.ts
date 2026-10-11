/** Turning a pasted link into something a note can show inline. */

export type EmbedKind = 'video' | 'audio' | 'embed' | 'bookmark';

/** A safe http(s) URL, adding https:// when the scheme was left off — or null. */
export function cleanUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** The player URL for video sites that only play inside their own frame. */
export function playerUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v') ?? /^\/(?:embed|shorts|live)\/([^/?#]+)/.exec(u.pathname)?.[1] ?? null;
  }
  if (id && /^[\w-]{6,}$/.test(id)) {
    const t = Number.parseInt(u.searchParams.get('t') ?? '', 10);
    return `https://www.youtube-nocookie.com/embed/${id}${t > 0 ? `?start=${t}` : ''}`;
  }
  const vimeo = host === 'vimeo.com' && /^\/(\d+)/.exec(u.pathname)?.[1];
  if (vimeo) return `https://player.vimeo.com/video/${vimeo}`;
  const loom = host === 'loom.com' && /^\/share\/([\w-]+)/.exec(u.pathname)?.[1];
  if (loom) return `https://www.loom.com/embed/${loom}`;
  return null;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|oga|aac|flac|opus)(\?|#|$)/i;

/** How to render a URL: a site's player frame, a bare media file, or a link card. */
export function embedPlan(url: string, kind: EmbedKind): { as: 'frame' | 'video' | 'audio' | 'card'; src: string } {
  const player = playerUrl(url);
  if (kind === 'bookmark') return { as: 'card', src: url };
  if (player) return { as: 'frame', src: player };
  if (AUDIO_EXT.test(url) || (kind === 'audio' && !VIDEO_EXT.test(url))) return { as: 'audio', src: url };
  if (VIDEO_EXT.test(url) || kind === 'video') return { as: 'video', src: url };
  return { as: 'frame', src: url };
}
