import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      // main.tsx applies an update when it's safe to reload.
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Scrabbler',
        short_name: 'Scrabbler',
        description: 'AI notes, sources, lectures and flashcards in one place.',
        theme_color: '#1a1a1a',
        background_color: '#f3eee3',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,mjs,ttf,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api/],
        // Shows push notifications and opens the app when one is tapped.
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  test: {
    environment: 'node',
    // The college's zone, so date tests mean the same on any machine.
    env: { TZ: 'Europe/London' },
  },
} as any);
