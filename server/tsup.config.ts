import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'build',
  clean: true,
  sourcemap: true,
  splitting: false,
  bundle: true,
  external: [
    'mongoose',
    'express',
    'passport',
    'passport-cas',
    'passport-strategy',
    'cookie-session',
    'cors',
    'express-rate-limit',
    'axios',
    'dotenv',
    'meilisearch',
  ],
});
