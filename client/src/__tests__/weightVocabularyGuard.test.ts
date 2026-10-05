import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const HEADING_OPEN = /<(h[1-4])\b/;
const BOLD = /\bfont-bold\b/;

/**
 * A metric value is the heaviest thing on its panel by design, so it keeps
 * `font-bold`. It is recognisable by the tabular-figures class, which only a
 * figure carries, or by being a `<span>` holding a count beside one.
 */
const METRIC_VALUE = /\byr-num\b/;

const componentFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : componentFiles(full);
    }
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });

const boldHeadings = (): string[] => {
  const sites: string[] = [];
  for (const file of componentFiles(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!HEADING_OPEN.test(line)) return;
      const opening = lines.slice(index, index + 4).join(' ');
      if (!BOLD.test(opening) || METRIC_VALUE.test(opening)) return;
      sites.push(`${relative(SRC, file)}:${index + 1}`);
    });
  }
  return sites;
};

describe('weight vocabulary guard', () => {
  /**
   * `font-semibold` is the house heavy weight, at 344 sites against 6 headings on
   * `font-bold`. Six is not a second convention, it is drift, and it showed up as
   * the two browse cards disagreeing about their own card title.
   *
   * This guard is deliberately narrow. An earlier framing of this problem was
   * "`font-semibold` is overused at 344 sites, so weight is carrying hierarchy",
   * and measuring it did not support that: of 33 headings at `text-xs` or
   * `text-sm` with a heavy weight, nearly all are form-section labels or
   * dense-panel titles, where a small bold label is a real typographic device
   * rather than a missing size step. Sweeping those would have made the operator
   * panels worse.
   */
  it('uses one heavy weight for a heading', () => {
    expect(boldHeadings()).toEqual([]);
  });
});
