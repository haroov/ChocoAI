import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Build the embeddable web widget bundle into the backend static folder.
// The backend serves it from `/web-widget/*`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(__dirname, '../backend/src/static/web-widget'),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'src/widget.tsx'),
      name: 'ChocoAIWidget',
      fileName: () => 'choco-ai-widget.js',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) return 'choco-ai-widget.css';
          return '[name][extname]';
        },
      },
    },
  },
});

