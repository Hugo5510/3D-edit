import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Ścieżka bazowa: na GitHub Pages to /<nazwa-repozytorium>/ (ustawiana w CI przez BASE_PATH).
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: '3D Edit – projektowanie pod druk 3D',
        short_name: '3D Edit',
        description: 'Modelowanie brył B-rep pod druk 3D: szkice, wyciągnięcia, otwory, zaokrąglenia, eksport STL/3MF/STEP.',
        lang: 'pl',
        theme_color: '#1f4fa8',
        background_color: '#eef1f5',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        file_handlers: [
          {
            action: '.',
            accept: {
              'model/stl': ['.stl'],
              'model/3mf': ['.3mf'],
              'model/step': ['.step', '.stp'],
            },
          },
        ],
      },
      workbox: {
        // jądro OCCT (~21 MB) i manifold są w pamięci podręcznej od pierwszego uruchomienia – praca offline
        globPatterns: ['**/*.{js,css,html,svg,png,wasm}'],
        globIgnores: ['**/opencascade_full*.wasm'],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // pełny build OpenCascade (IGES) – pobierany dopiero przy pierwszym użyciu, potem z pamięci
            urlPattern: /opencascade_full.*\.wasm$/,
            handler: 'CacheFirst',
            options: { cacheName: 'occt-full', expiration: { maxEntries: 2 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['occt-wasm', 'manifold-3d', '@taucad/opencascade.js'] },
  server: { host: true },
});
