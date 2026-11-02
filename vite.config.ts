/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built app works from any static host path
  // (e.g. GitHub Pages at /investment-tracker/).
  base: './',
  test: {
    environment: 'node',
  },
});
