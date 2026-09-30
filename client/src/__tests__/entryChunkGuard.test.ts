import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const ENTRY = join(SRC, 'index.tsx');

/**
 * A type-only import erases at build time, so it is not an edge in this graph.
 *
 * Rollup puts a module in the entry chunk when it is reachable from the entry by
 * static import alone, so the entry's first-load cost is a property of this
 * graph rather than of the bundler's settings. A `import()` is a chunk boundary
 * and therefore ends the walk. Measured on the build this guard was written for:
 * the eager first load of `/research` was 951 kB raw, 293 kB gzip, and became
 * 583 kB raw, 185 kB gzip (#3947).
 */
const STATIC_IMPORT = /(?:^|[\s;}])(?:import|export)(?!\s+type\s)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT = /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g;

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

const resolveLocal = (fromFile: string, specifier: string): string | null => {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    ...EXTENSIONS.map((extension) => `${base}${extension}`),
    ...EXTENSIONS.map((extension) => join(base, `index${extension}`)),
  ];
  return (
    candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
  );
};

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const entryGraph = (): { files: Set<string>; packages: Set<string> } => {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [ENTRY];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const pattern of [STATIC_IMPORT, BARE_IMPORT]) {
      pattern.lastIndex = 0;
      let match = pattern.exec(source);
      while (match) {
        const specifier = match[1];
        if (specifier.startsWith('.')) {
          const resolved = resolveLocal(file, specifier);
          if (resolved) queue.push(resolved);
        } else if (!specifier.endsWith('.css')) {
          packages.add(specifier);
        }
        match = pattern.exec(source);
      }
    }
  }

  return { files, packages };
};

const graph = entryGraph();
const entryModules = new Set(Array.from(graph.files).map((file) => relative(SRC, file)));

describe('entry chunk guard', () => {
  it('keeps libraries that the default first load never executes out of the entry graph', () => {
    const deferred = Array.from(graph.packages).filter((name) =>
      /^(@sentry\/|react-virtuoso$|sweetalert$)/.test(name),
    );

    expect(deferred).toEqual([]);
  });

  it('keeps every route page except the research landing out of the entry graph', () => {
    const eagerPages = Array.from(entryModules)
      .filter((name) => /^pages\//.test(name))
      .sort();

    expect(eagerPages).toEqual([
      'pages/notFound.tsx',
      'pages/research.tsx',
      'pages/rootRedirect.tsx',
    ]);
  });

  it('keeps the research landing eager so the main journey costs no extra round trip', () => {
    expect(entryModules.has('pages/research.tsx')).toBe(true);
  });
});
