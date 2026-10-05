import { readFileSync, readdirSync, statSync } from 'fs';
import { extname, join, relative } from 'path';

import { describe, expect, it } from 'vitest';

import {
  candidatesIn,
  compileStylesheet,
  scannedCandidates,
  scannedPositions,
} from '../testUtils/tailwind';

const SRC = join(__dirname, '..');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const TOUCHING_INTERPOLATION = /(?<=[\s`'"])([a-z![-][^\s'"`{}]*[\w\])%])(?=\$\{)/g;

const escapeClass = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);

const touchingTokens = (source: string): { token: string; index: number; line: number }[] =>
  [...source.matchAll(TOUCHING_INTERPOLATION)].map((match) => ({
    token: match[1],
    index: match.index ?? 0,
    line: source.slice(0, match.index).split('\n').length,
  }));

/**
 * Tailwind 4's scanner does not split a class from an interpolation written
 * against it, so `` `row-start-1${...}` `` generates no rule and the class does
 * nothing, with no warning. Each occurrence is checked by position, because the
 * class still works by luck while the same name appears somewhere else.
 */
const unscannedClasses = async (): Promise<string[]> => {
  const findings: { site: string; token: string }[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    const scanned = scannedPositions(source, extname(file).slice(1));
    for (const { token, index, line } of touchingTokens(source)) {
      if (!scanned.has(`${index}:${token}`)) {
        findings.push({ site: `${relative(SRC, file)}:${line}`, token });
      }
    }
  }
  const css = (await compileStylesheet(findings.map(({ token }) => token))).toString();
  return findings
    .filter(({ token }) => css.includes(`.${escapeClass(token)}`))
    .map(({ site, token }) => `${site} ${token}`);
};

describe('class scanner guard', () => {
  it('detects a class written against an interpolation', async () => {
    const source = 'const a = `col-start-1 row-start-1${flag ? " invisible" : ""}`;';

    expect(touchingTokens(source).map(({ token }) => token)).toEqual(['row-start-1']);
    expect(scannedCandidates(source, 'tsx')).not.toContain('row-start-1');
    expect(candidatesIn('<p class="row-start-1"></p>')).toContain('row-start-1');
  });

  it('separates every class from an interpolation so the scanner sees it', async () => {
    expect(
      await unscannedClasses(),
      'A class touches a `${` interpolation, so Tailwind never generates it. Put a space ' +
        'between the class and the interpolation. See docs/decisions.md (#4386).',
    ).toEqual([]);
  });
});
