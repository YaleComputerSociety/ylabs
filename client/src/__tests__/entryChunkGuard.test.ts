// @vitest-environment node
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative, resolve, sep } from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLIENT_ROOT = join(__dirname, '..', '..');
const VITE_BIN = join(CLIENT_ROOT, 'node_modules', '.bin', 'vite');

type ManifestEntry = { file: string; isEntry?: boolean };
type SourceMap = { sources: string[] };

/**
 * The entry chunk is read from a real production build rather than from the
 * source, because what reaches the first load is decided by the bundler.
 * Measured on the build this guard was written for: the eager first load of
 * `/research` was 951 kB raw, 293 kB gzip, and became 583 kB raw, 185 kB gzip
 * (#3947).
 */
const buildEntryModules = (outDir: string): string[] => {
  execFileSync(
    VITE_BIN,
    [
      'build',
      '--outDir',
      outDir,
      '--emptyOutDir',
      '--manifest',
      '--sourcemap',
      '--minify',
      'false',
      '--logLevel',
      'silent',
    ],
    { cwd: CLIENT_ROOT, stdio: 'pipe' },
  );
  const manifest = JSON.parse(
    readFileSync(join(outDir, '.vite', 'manifest.json'), 'utf8'),
  ) as Record<string, ManifestEntry>;
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry);
  if (!entry) throw new Error('the build emitted no entry chunk');
  const entryFile = join(outDir, entry.file);
  const sourceMap = JSON.parse(readFileSync(`${entryFile}.map`, 'utf8')) as SourceMap;
  return sourceMap.sources.map((source) => resolve(join(entryFile, '..'), source));
};

let outDir = '';
let entryModules: string[] = [];

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'ylabs-entry-chunk-'));
  entryModules = buildEntryModules(outDir);
}, 120000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe('entry chunk guard', () => {
  it('keeps libraries that the default first load never executes out of the entry chunk', () => {
    const deferred = entryModules.filter(
      (path) =>
        /[\\/]node_modules[\\/](@sentry[\\/]|react-virtuoso[\\/]|@mui[\\/]material[\\/](esm[\\/])?Dialog[\\/])/.test(
          path,
        ) ||
        /[\\/]src[\\/](utils[\\/]appDialogs|components[\\/]shared[\\/]AppDialog)\.tsx$/.test(path),
    );

    expect(deferred).toEqual([]);
  });

  it('keeps every route page except the research landing out of the entry chunk', () => {
    const pagesDir = join(CLIENT_ROOT, 'src', 'pages');
    const eagerPages = entryModules
      .filter((path) => path.startsWith(pagesDir))
      .map((path) => relative(pagesDir, path).split(sep).join('/'))
      .sort();

    expect(eagerPages).toEqual(['notFound.tsx', 'research.tsx', 'rootRedirect.tsx']);
  });
});
