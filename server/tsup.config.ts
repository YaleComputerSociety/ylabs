import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'build',
  clean: true,
  sourcemap: false,
  splitting: false,
  bundle: true,
  external: [
    'mongoose',
    'express',
    'passport',
    'passport-cas',
    'cookie-session',
    'cors',
    'express-rate-limit',
    'axios',
    'dotenv',
    'meilisearch',
  ],
});
