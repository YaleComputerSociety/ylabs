import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const GENERIC_RADIUS = /\brounded-(?:sm|md|lg|xl|2xl)\b/;

/**
 * Bare `rounded` is 0.25rem and reads as "no radius chosen", which is how 11
 * chips ended up squaring off the pill they were built from. Matched separately
 * from the named sizes because it has no hyphen.
 */
const UNNAMED_RADIUS = /\brounded\b(?!-)/;

/** The structural signature of a card: a hairline border over the panel surface. */
const CARD_BORDER = /border-\[var\(--yr-line\)\]|\bborder-line\b/;
const CARD_SURFACE = /bg-\[var\(--yr-panel\)\]|\bbg-panel\b/;

/**
 * Paths assigned a radius by role. The operator surfaces still put inputs at the
 * container radius, which is the inversion this scale exists to prevent, and are
 * pending rather than exempt.
 */
const SWEPT_PATHS = [
  'pages/research.tsx',
  'pages/fellowships.tsx',
  'pages/labDetail.tsx',
  'pages/about.tsx',
  'pages/login.tsx',
  'pages/notFound.tsx',
  'pages/loginError.tsx',
  'pages/dashboard.tsx',
  'components/shared',
  'components/labs',
  'components/research',
  'components/navbar',
  'components/fellowship',
  'components/accounts',
];

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });

const sweptFiles = (): string[] =>
  SWEPT_PATHS.flatMap((path) => {
    const full = join(SRC, path);
    return statSync(full).isDirectory() ? sourceFiles(full) : [full];
  });

const rem = (value: string): number => Number.parseFloat(value.replace('rem', ''));

const sitesWhere = (files: string[], matches: (line: string) => boolean): string[] => {
  const sites: string[] = [];
  for (const file of files) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (matches(line)) sites.push(`${relative(SRC, file)}:${index + 1}`);
      });
  }
  return sites;
};

describe('radius scale guard', () => {
  /**
   * The scale means nothing as three values; it means something as an ordering.
   * An inner element has to be tighter than the box holding it, so a change that
   * reorders the steps is the change that breaks the rule, and changing a number
   * while keeping the order is allowed.
   */
  it('keeps control tighter than card, and card tighter than overlay', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    const step = (name: string): number => {
      const declaration = new RegExp(`--yr-radius-${name}:\\s*([^;]+);`).exec(css);
      expect(declaration, `--yr-radius-${name} is declared`).not.toBeNull();
      return rem(declaration![1].trim());
    };

    const [control, card, overlay] = [step('control'), step('card'), step('overlay')];
    expect(control).toBeLessThan(card);
    expect(card).toBeLessThan(overlay);
  });

  /**
   * A card is recognisable by structure rather than by path, so this runs over the
   * whole tree: the 37/34 split between two radii on the identical construct is
   * what the scale was introduced to settle.
   */
  it('gives every card the card radius, everywhere', () => {
    const sites = sitesWhere(
      sourceFiles(SRC),
      (line) => CARD_BORDER.test(line) && CARD_SURFACE.test(line) && GENERIC_RADIUS.test(line),
    );

    expect(sites).toEqual([]);
  });

  it('uses no generic or unnamed radius class in a swept path', () => {
    const sites = sitesWhere(
      sweptFiles(),
      (line) => GENERIC_RADIUS.test(line) || UNNAMED_RADIUS.test(line),
    );

    expect(sites).toEqual([]);
  });

  /**
   * `.yr-pill` sets a capsule radius in `@layer components`, so any radius utility
   * on the same element wins on source order and squares it off. 13 were doing
   * this: 11 dense chips that meant it, now `.yr-pill-compact`, and 2 full-size
   * pills that did not and were rendering as rectangles.
   */
  it('never overrides a pill radius with a utility', () => {
    const sites = sitesWhere(
      sourceFiles(SRC),
      (line) =>
        /\byr-pill\b/.test(line) &&
        (UNNAMED_RADIUS.test(line) || /\brounded-(?!full\b)[a-z0-9[]/.test(line)),
    );

    expect(sites).toEqual([]);
  });

  /** A dense chip is the variant, so `min-h-0` on a pill means the variant is missing. */
  it('uses the compact variant rather than overriding a pill height', () => {
    const sites = sitesWhere(
      sourceFiles(SRC),
      (line) => /\byr-pill\b/.test(line) && /\bmin-h-0\b/.test(line),
    );

    expect(sites).toEqual([]);
  });
});
