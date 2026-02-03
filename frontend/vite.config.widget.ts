import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      jsxRuntime: 'automatic',
      jsxImportSource: 'react',
    }),
    tailwindcss(),
  ],
  build: {
    outDir: path.resolve(__dirname, '../backend/src/static/web-widget'),
    emptyOutDir: false,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/widget.tsx'),
      output: {
        format: 'iife',
        name: 'ChocoAIWidget',
        entryFileNames: 'choco-ai-widget.js',
        inlineDynamicImports: true,
        compact: true,
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return 'choco-ai-widget.css';
          }
          return assetInfo.name || 'asset';
        },
      },
      external: [],
      treeshake: {
        moduleSideEffects: 'no-external',
        preset: 'smallest',
        propertyReadSideEffects: false,
        tryCatchDeoptimization: false,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
