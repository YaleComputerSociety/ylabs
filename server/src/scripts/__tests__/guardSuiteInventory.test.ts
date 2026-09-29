import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SERVER_ROOT = path.resolve(__dirname, '../../..');
const IN_MEMORY_MONGO_IMPORT = /from\s+['"]mongodb-memory-server(?:-core)?['"]/;

const guardScript = (): string => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8'));
  return packageJson.scripts['test:guards'];
};

const guardSuiteFiles = (script: string): string[] =>
  script.split(/\s+/).filter((token) => /\.(?:test|spec)\.ts$/.test(token));

const startsInMemoryMongo = (file: string): boolean =>
  IN_MEMORY_MONGO_IMPORT.test(fs.readFileSync(path.join(SERVER_ROOT, file), 'utf8'));

describe('the server guard suite that CI runs ahead of the full suite', () => {
  const files = guardSuiteFiles(guardScript());

  it('names at least the registration guards it was created for', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'src/scrapers/__tests__/sourceDispatch.test.ts',
        'src/scrapers/__tests__/seedSources.test.ts',
        'src/scripts/__tests__/humanRunWriteScriptGuard.test.ts',
      ]),
    );
  });

  it('names only files that exist, so a renamed guard cannot silently drop out', () => {
    expect(files.filter((file) => !fs.existsSync(path.join(SERVER_ROOT, file)))).toEqual([]);
  });

  it('names no file that starts an in-memory MongoDB, so the step stays seconds long', () => {
    expect(files.filter(startsInMemoryMongo)).toEqual([]);
  });

  it('includes this inventory, so the list is checked before the full suite too', () => {
    expect(files).toContain(path.relative(SERVER_ROOT, __filename));
  });
});

describe('the guard file scan', () => {
  it('reads test files out of a vitest command line', () => {
    expect(
      guardSuiteFiles(
        'cross-env NODE_ENV=test vitest run src/a.test.ts src/b.spec.ts --reporter dot',
      ),
    ).toEqual(['src/a.test.ts', 'src/b.spec.ts']);
  });
});
