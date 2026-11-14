import { defineConfig } from 'vite';

/** Bundles the push server into one readable file, push-server/worker.js, to paste into Cloudflare. */
export default defineConfig({
  // The app's public/ files (icons, its service worker) aren't the worker's.
  publicDir: false,
  build: {
    outDir: 'push-server',
    emptyOutDir: false,
    minify: false,
    target: 'es2022',
    lib: { entry: 'push-server/src/worker.ts', formats: ['es'], fileName: () => 'worker.js' },
  },
});
