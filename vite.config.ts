/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built app works from any static host path
  // (e.g. GitHub Pages at /investment-tracker/).
  base: './',
  // sqlite-wasm loads its .wasm file relative to its own module; pre-bundling breaks that.
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
  },
});
