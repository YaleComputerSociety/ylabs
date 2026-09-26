import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `client/vite.config.js` sets no `build.target`, so Vite's default `modules`
 * floor applies (es2020 / safari14 / chrome87 / firefox78) and esbuild
 * transpiles syntax only: it never polyfills a built-in method. A newer
 * built-in therefore ships as-is and throws at runtime on a browser inside the
 * support floor, which no test can catch because Node and jsdom both have them.
 * #2195 shipped `Object.hasOwn` into the browse filter path, where it ran on
 * every facet response and would have taken the Research page down on Safari 14
 * rather than degrading.
 */
const POST_ES2020_BUILTINS: ReadonlyArray<{ pattern: RegExp; since: string }> = [
  { pattern: /\bObject\.hasOwn\s*\(/, since: 'ES2022' },
  { pattern: /\.replaceAll\s*\(/, since: 'ES2021' },
  { pattern: /\.findLast\s*\(/, since: 'ES2023' },
  { pattern: /\.findLastIndex\s*\(/, since: 'ES2023' },
  { pattern: /\btoSorted\s*\(/, since: 'ES2023' },
  { pattern: /\btoReversed\s*\(/, since: 'ES2023' },
  { pattern: /\btoSpliced\s*\(/, since: 'ES2023' },
  { pattern: /\bstructuredClone\s*\(/, since: 'ES2022 host API' },
  { pattern: /\bArray\.prototype\.at\b/, since: 'ES2022' },
  { pattern: /\bObject\.groupBy\s*\(/, since: 'ES2024' },
];

const SOURCE_ROOT = join(__dirname, '..', '..');

const isExcluded = (path: string): boolean =>
  path.includes('__tests__') || path.includes('testUtils') || /\.test\.tsx?$/.test(path);

const collectSourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return collectSourceFiles(path);
    if (!/\.tsx?$/.test(path) || isExcluded(path)) return [];
    return [path];
  });

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('client build target', () => {
  it('ships no built-in newer than the default Vite modules target', () => {
    const offenders = collectSourceFiles(SOURCE_ROOT).flatMap((path) => {
      const source = withoutComments(readFileSync(path, 'utf8'));
      return POST_ES2020_BUILTINS.filter(({ pattern }) => pattern.test(source)).map(
        ({ pattern, since }) => `${relative(SOURCE_ROOT, path)} uses ${String(pattern)} (${since})`,
      );
    });

    expect(offenders).toEqual([]);
  });
});
