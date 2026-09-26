import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/**
 * `text-2xl` is the floor because a serif at a card-title size loses legibility
 * in a dense grid and reads as decoration. See client/DESIGN.md section 3.
 */
const DISPLAY_SIZE = /\btext-(?:2xl|3xl|4xl|5xl|6xl|7xl)\b/;
const HEADING_TAG = /<h[1-4]\b/;
const DISPLAY_CLASS = /\byr-display\b/;

/**
 * A metric value is set at a display size but is not a heading, so it takes
 * tabular figures rather than the serif display treatment.
 */
const NUMERIC_VALUE = /\byr-num\b/;

/**
 * The wordmark is the one documented exception to the serif display rule
 * (client/DESIGN.md section 3): it is set in the Inter stack at weight 700 with
 * -0.03em tracking, matching the y/cs mark it derives from.
 */
const WORDMARK = /<Wordmark\b/;

/**
 * A glyph control sizes a dismiss character rather than setting text, so neither
 * the serif family nor tabular figures apply to it. Matched on the signature a
 * glyph button always carries, a fixed square or a collapsed line box, rather
 * than on a file and line: an exemption keyed by line number silently expires
 * the next time anything above it moves, which is how this rule first broke.
 */
const GLYPH_CONTROL = /\bh-\d+ w-\d+\b|\bleading-none\b/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const untrackedDisplaySites = (): string[] => {
  const sites: string[] = [];
  for (const file of sourceFiles(SRC)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (!DISPLAY_SIZE.test(line)) return;
        if (DISPLAY_CLASS.test(line) || NUMERIC_VALUE.test(line) || WORDMARK.test(line)) return;
        if (GLYPH_CONTROL.test(line)) return;
        sites.push(`${relative(SRC, file)}:${index + 1}`);
      });
  }
  return sites;
};

const headingsWithoutDisplayClass = (): string[] => {
  const sites: string[] = [];
  for (const file of sourceFiles(SRC)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (!HEADING_TAG.test(line) || !DISPLAY_SIZE.test(line)) return;
        if (DISPLAY_CLASS.test(line)) return;
        sites.push(`${relative(SRC, file)}:${index + 1}`);
      });
  }
  return sites;
};

describe('display type guard', () => {
  it('sets the display class in the serif stack with tightened tracking', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    const rule = /\.yr-display\s*\{([^}]*)\}/.exec(css);

    expect(rule, '.yr-display is declared').not.toBeNull();
    expect(rule![1]).toContain('var(--yr-font-serif)');
    expect(rule![1]).toMatch(/letter-spacing:\s*-0\.0\d+em/);
  });

  /**
   * The weight is deliberately not in `.yr-display`. That rule sits in
   * `@layer components`, so a `font-semibold` utility on the same element wins
   * on source order and a weight declared there would be silently dropped.
   */
  it('declares no font-weight in the display class', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    const rule = /\.yr-display\s*\{([^}]*)\}/.exec(css);

    expect(rule![1]).not.toMatch(/font-weight/);
  });

  it('gives every display-size heading the display class', () => {
    expect(headingsWithoutDisplayClass()).toEqual([]);
  });

  it('gives every display-size text the display class or tabular figures', () => {
    expect(untrackedDisplaySites()).toEqual([]);
  });
});
