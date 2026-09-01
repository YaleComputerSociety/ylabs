import { defineConfig } from 'tsup';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'build',
  clean: true,
  sourcemap: false,
  splitting: false,
  bundle: true,
  // The bundle collapses all modules into build/index.js, so the .md prompt
  // files (read at runtime by src/scrapers/prompts) must be copied alongside it.
  onSuccess: async () => {
    const promptsSrc = path.resolve('src/scrapers/prompts');
    const promptsDest = path.resolve('build/scrapers/prompts');
    fs.mkdirSync(promptsDest, { recursive: true });
    for (const file of fs.readdirSync(promptsSrc)) {
      if (file.endsWith('.md')) {
        fs.copyFileSync(path.join(promptsSrc, file), path.join(promptsDest, file));
      }
    }
  },
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
