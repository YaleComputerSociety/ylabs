import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/** client/DESIGN.md section 3: student-facing text never renders below 12px. */
const MINIMUM_CONTENT_TEXT_PX = 12;

const ARBITRARY_TEXT_SIZE = /\btext-\[(\d+(?:\.\d+)?)(px|rem)\]/g;

const ROOT_FONT_SIZE_PX = 16;

/** A tracked uppercase kicker is a label rather than content. */
const KICKER_LABEL = /\byr-kicker\b/;

/**
 * Operator-only surfaces, where a dense diagnostic table is read by a maintainer
 * rather than by a student. Listed by file because the whole surface is operator
 * vocabulary, so a per-line exemption would expire the next time one moves.
 */
const OPERATOR_ONLY_SURFACES = [
  'components/admin/AdminOperatorBoard.tsx',
  'components/analytics/CorpusQualityPanel.tsx',
];

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const pixelsOf = (value: string, unit: string): number =>
  unit === 'rem' ? Number(value) * ROOT_FONT_SIZE_PX : Number(value);

const undersizedTextSites = (): string[] => {
  const sites: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const path = relative(SRC, file);
    if (OPERATOR_ONLY_SURFACES.includes(path)) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (KICKER_LABEL.test(line)) return;
        for (const match of line.matchAll(ARBITRARY_TEXT_SIZE)) {
          if (pixelsOf(match[1], match[2]) >= MINIMUM_CONTENT_TEXT_PX) continue;
          sites.push(`${path}:${index + 1} ${match[0]}`);
        }
      });
  }
  return sites;
};

describe('minimum text size', () => {
  it('sets no student-facing text below the 12px floor', () => {
    expect(undersizedTextSites()).toEqual([]);
  });

  it('still reads an arbitrary size in both units', () => {
    expect(pixelsOf('9', 'px')).toBe(9);
    expect(pixelsOf('0.72', 'rem')).toBeCloseTo(11.52);
    expect(pixelsOf('0.75', 'rem')).toBe(MINIMUM_CONTENT_TEXT_PX);
  });

  it('excuses a kicker label and nothing else on its line', () => {
    expect(KICKER_LABEL.test('<p className="yr-kicker mb-2 text-[0.68rem]">Evidence</p>')).toBe(
      true,
    );
    expect(KICKER_LABEL.test('<p className="mb-2 text-[0.68rem]">Evidence</p>')).toBe(false);
  });

  it('names the operator surfaces it excuses rather than excusing a predicate', () => {
    for (const path of OPERATOR_ONLY_SURFACES) {
      expect(readFileSync(join(SRC, path), 'utf8')).toContain('text-[');
    }
  });
});
