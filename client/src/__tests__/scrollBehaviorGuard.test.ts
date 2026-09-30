import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const LITERAL_SMOOTH_BEHAVIOR = /behavior\s*:\s*['"`]smooth['"`]/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const literalSmoothScrollSites = (): string[] =>
  sourceFiles(SRC).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        LITERAL_SMOOTH_BEHAVIOR.test(line) ? [`${relative(SRC, file)}:${index + 1}`] : [],
      ),
  );

describe('scroll behavior guard', () => {
  /**
   * A scripted `behavior: 'smooth'` overrides the stylesheet, so the
   * `scroll-behavior: auto` rule under `prefers-reduced-motion: reduce` cannot
   * stop it (#3967). Scripted scrolls take their behavior from `scrollBehavior()`.
   */
  it('never hardcodes a smooth scripted scroll', () => {
    expect(literalSmoothScrollSites()).toEqual([]);
  });
});
