import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SERVER_SRC = path.resolve(__dirname, '..');
const HOOK_MODULES = /servedCheckStudentSession|servedCheckStudentCore/;

const productionSources = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : productionSources(full);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : [];
  });

describe('only the served-check student entry reaches the student hook (#6079)', () => {
  it('is imported by the entry and its core and by no other production module', () => {
    const importers = productionSources(SERVER_SRC)
      .filter((file) => HOOK_MODULES.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SERVER_SRC, file))
      .sort();
    expect(importers).toEqual([
      path.join('scripts', 'servedCheckStudent.ts'),
      path.join('scripts', 'servedCheckStudentCore.ts'),
    ]);
  });
});
