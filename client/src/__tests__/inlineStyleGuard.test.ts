import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/**
 * An `rgb()` or `rgba()` literal is a raw colour, and `rawColorValueGuard` only
 * matches `#hex`, so five of these sat outside it. One was an untinted black
 * shadow on the account avatar, which is exactly what the elevation scale exists
 * to replace, and two were a 5% tint of `#184a9b`, a blue that is not the brand.
 */
const RAW_RGB = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/;

/**
 * `elevationTokenGuard` reads Tailwind `shadow-*` classes and the `box-shadow`
 * declarations in `index.css`. A shadow written into a MUI `sx` prop is in
 * neither place. A `boxShadow` that references an elevation token, or `none` as a
 * reset, is correct and allowed.
 */
const INLINE_SHADOW = /boxShadow:\s*'(?!none'|var\(--yr-shadow-)/;

/** A duration belongs to the motion scale, not to whoever typed the number. */
const RAW_DURATION = /transition[^;'"`]*?\b\d{2,4}ms|\b0\.\d+s\b/;

const isComment = (line: string): boolean => /^\s*(?:\/\/|\/\*|\*)/.test(line.trimStart());

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const sitesMatching = (pattern: RegExp): string[] => {
  const sites: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const name = relative(SRC, file);
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (isComment(line)) return;
        if (pattern.test(line)) sites.push(`${name}:${index + 1}`);
      });
  }
  return sites;
};

describe('inline style guard', () => {
  it('writes no rgb or rgba colour literal', () => {
    expect(sitesMatching(RAW_RGB)).toEqual([]);
  });

  it('writes no shadow into an inline style', () => {
    expect(sitesMatching(INLINE_SHADOW)).toEqual([]);
  });

  /**
   * Five uncoordinated durations were in use, because nothing named them: 120,
   * 150, 200, 220 and 300ms. The `duration-*` Tailwind utilities are allowed,
   * since those come from one scale; a hand-typed `ms` or `s` does not.
   */
  it('takes every transition duration from the motion scale', () => {
    expect(sitesMatching(RAW_DURATION)).toEqual([]);
  });

  it('declares the motion scale', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');

    for (const step of ['fast', 'base', 'slow']) {
      expect(css, `--yr-motion-${step}`).toMatch(new RegExp(`--yr-motion-${step}:\\s*\\d+ms;`));
    }
  });

  /**
   * `transition` and `transition-all` animate every property, including ones that
   * trigger layout if they ever change. Naming the property is the whole
   * difference between a transition that can be composited and one that cannot.
   */
  it('names the property on every transition', () => {
    const sites = sitesMatching(/\btransition(?:-all)?(?![-\w:])/);

    expect(sites.filter((site) => !site.includes('index.css'))).toEqual([]);
  });
});
