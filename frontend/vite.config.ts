import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  // In some local environments, the dependency pre-bundling step (esbuild-based)
  // can hang/time out on large node_modules trees. This configuration disables
  // the deps optimizer in dev to keep the server responsive; initial page load
  // may be slower.
  optimizeDeps: {
    noDiscovery: true,
    include: [],
  },
  build: {
    // Build admin UI into the backend static folder, so `backend/src/static/index.html`
    // and the `/assets/*` bundle are served directly by the backend.
    outDir: path.resolve(__dirname, '../backend/src/static'),
    emptyOutDir: false,
  },
});
