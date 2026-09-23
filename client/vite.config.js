/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: './postcss.config.js',
  },
  server: {
    port: 3000,
  },
  test: {
    globals: false,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Must stay well above the 5000ms `asyncUtilTimeout` in src/setupTests.ts so a test with
    // several waits reports the assertion that failed rather than a harness timeout.
    testTimeout: 20000,
  },
});
