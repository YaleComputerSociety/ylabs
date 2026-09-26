import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const GENERIC_NEUTRAL_TEXT = /\btext-(?:gray|slate|zinc|neutral)-\d{2,3}\b/;

/**
 * A surface or hairline in the same two cool families. Same defect as the text
 * half: on a warm canvas a cool grey is the wrong temperature, and the palette
 * already names every step these were standing in for.
 */
const GENERIC_NEUTRAL_SURFACE =
  /\b(?:bg|border|divide|ring)-(?:gray|slate|zinc|neutral)-\d{2,3}(?:\/\d+)?\b/;
const SCALE_STEP = /(?<![:\w-])text-(ink-soft|ink|muted)\b/g;
const SCALE_STEP_ON_STATE = /(?:hover|focus|active|group-hover):text-(ink-soft|ink|muted)\b/g;

/**
 * Paths swept onto the three-step scale. The operator surfaces are not here yet
 * and are listed as pending rather than exempt, so widening this list is how the
 * remaining sweep lands. See client/DESIGN.md section 2.
 */
const SWEPT_PATHS = [
  'pages/research.tsx',
  'pages/fellowships.tsx',
  'pages/labDetail.tsx',
  'pages/about.tsx',
  'pages/login.tsx',
  'pages/loginError.tsx',
  'pages/notFound.tsx',
  'components/shared',
  'components/labs',
  'components/research',
  'components/navbar',
  'components/fellowship',
  'components/accounts',
];

/**
 * A grey member of a declared multi-hue scale pairs a hue background with the
 * matching hue text. DESIGN.md section 2 says change such a scale as a whole or
 * not at all, so the grey member keeps its pair.
 */
const SCALE_MEMBER_SITES = new Set(['components/labs/LabMembersList.tsx:46']);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const sweptFiles = (): string[] =>
  SWEPT_PATHS.flatMap((path) => {
    const full = join(SRC, path);
    return statSync(full).isDirectory() ? sourceFiles(full) : [full];
  });

const eachLine = (visit: (site: string, line: string) => void): void => {
  for (const file of sweptFiles()) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => visit(`${relative(SRC, file)}:${index + 1}`, line));
  }
};

describe('neutral text scale guard', () => {
  it('declares three steps, each a distinct value', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    const values = ['--yr-ink', '--yr-ink-soft', '--yr-muted'].map((token) => {
      const declaration = new RegExp(`${token}:\\s*([^;]+);`).exec(css);
      expect(declaration, `${token} is declared`).not.toBeNull();
      return declaration![1].trim();
    });

    expect(new Set(values).size).toBe(3);
  });

  it('uses no generic neutral text class in a swept path', () => {
    const sites: string[] = [];
    eachLine((site, line) => {
      if (!GENERIC_NEUTRAL_TEXT.test(line)) return;
      if (SCALE_MEMBER_SITES.has(site)) return;
      sites.push(site);
    });

    expect(sites).toEqual([]);
  });

  it('uses no generic neutral surface or hairline class in a swept path', () => {
    const sites: string[] = [];
    eachLine((site, line) => {
      if (!GENERIC_NEUTRAL_SURFACE.test(line)) return;
      if (SCALE_MEMBER_SITES.has(site)) return;
      sites.push(site);
    });

    expect(sites).toEqual([]);
  });

  /**
   * A mechanical sweep collapses a hover state whenever the resting class and the
   * hover class map to the same step, which paints a hover that cannot be seen.
   * DESIGN.md section 0 says pick a value by its distance from the state it
   * replaces; this is that rule made executable.
   */
  it('never gives an element the same step at rest and on a state', () => {
    const sites: string[] = [];
    eachLine((site, line) => {
      const resting = new Set(Array.from(line.matchAll(SCALE_STEP), (m) => m[1]));
      const onState = new Set(Array.from(line.matchAll(SCALE_STEP_ON_STATE), (m) => m[1]));
      if (Array.from(onState).some((step) => resting.has(step))) sites.push(site);
    });

    expect(sites).toEqual([]);
  });
});
