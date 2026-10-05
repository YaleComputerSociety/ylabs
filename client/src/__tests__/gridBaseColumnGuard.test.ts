import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const CLASS_LIST = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;
const BREAKPOINT_COLUMNS = /^(?:sm|md|lg|xl|2xl):grid-cols-/;
const BASE_COLUMNS = /^grid-cols-/;

const lacksBaseColumn = (classes: string[]): boolean =>
  classes.includes('grid') &&
  classes.some((name) => BREAKPOINT_COLUMNS.test(name)) &&
  !classes.some((name) => BASE_COLUMNS.test(name));

const gridsWithoutBaseColumn = (): string[] =>
  sourceFiles(SRC).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        Array.from(line.matchAll(CLASS_LIST))
          .filter((match) => lacksBaseColumn((match[1] ?? match[2] ?? '').split(/\s+/)))
          .map(() => `${relative(SRC, file)}:${index + 1}`),
      ),
  );

describe('responsive grid base column', () => {
  it('recognises a grid that declares columns only from a breakpoint up', () => {
    expect(lacksBaseColumn('grid gap-3 sm:grid-cols-2'.split(' '))).toBe(true);
    expect(lacksBaseColumn('grid grid-cols-1 gap-3 sm:grid-cols-2'.split(' '))).toBe(false);
    expect(lacksBaseColumn('flex sm:grid-cols-2'.split(' '))).toBe(false);
  });

  it('gives every responsive grid a base column so one wide item cannot size the page', () => {
    expect(gridsWithoutBaseColumn()).toEqual([]);
  });
});
