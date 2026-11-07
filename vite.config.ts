/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `--mode android` builds the screens bundled in the Android app (ADR 0006): no service worker, the app itself keeps
// everything offline.
export default defineConfig(({ mode }) => ({
  root: 'src/client',
  publicDir: 'public',
  build: {
    outDir: mode === 'android' ? '../../dist/android' : '../../dist/client',
    emptyOutDir: true,
  },
  plugins: [
    react(),
    VitePWA({
      disable: mode === 'android',
      registerType: 'autoUpdate',
      manifest: {
        name: 'tmy_garage',
        short_name: 'tmy_garage',
        description: 'Maintenance logbook for your cars and motorcycles',
        theme_color: '#1f2937',
        background_color: '#000000',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // The app shell is cached by the service worker; garage data is cached in IndexedDB by the app.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    proxy: {
      // A regex so that the client's own src/client/api.ts module is not sent to the server.
      '^/api/': 'http://localhost:3000',
    },
  },
  test: {
    root: '.',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}));
