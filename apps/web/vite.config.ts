import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // .env lives at the repo root (written by scripts/write-env.mjs).
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true },
  // Pre-bundle lazily imported heavy deps so the dev server never reloads mid-session.
  optimizeDeps: { include: ['@react-pdf/renderer', 'recharts'] },
  preview: { port: 4173, strictPort: true },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});
