import { lazy, type ComponentType } from 'react';

/**
 * React.lazy for a named export. After an update the old chunk may be gone
 * from the server; reloading once fetches the new ones instead of showing an
 * error.
 */
export function lazyNamed<M extends Record<string, unknown>, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(async () => {
    try {
      const m = await load();
      try {
        sessionStorage.removeItem('scrabbler.chunkReload');
      } catch {
        /* private mode */
      }
      return { default: m[name] as ComponentType<any> };
    } catch (e) {
      const key = 'scrabbler.chunkReload';
      if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        location.reload();
        return new Promise<never>(() => {});
      }
      throw e;
    }
  }) as unknown as M[K];
}
