import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

import { arbitraryTextSizesBelow, MINIMUM_CONTENT_TEXT_PX } from '../testUtils/textSize';

const SRC = join(__dirname, '..');

/** A tracked uppercase kicker is a label rather than content, so its floor is its own 0.72rem. */
const KICKER_LABEL = /\byr-kicker\b/;
const KICKER_TEXT_PX = 11.52;

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
      return entry === '__tests__' || entry === 'testUtils' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const floorFor = (line: string): number =>
  KICKER_LABEL.test(line) ? KICKER_TEXT_PX : MINIMUM_CONTENT_TEXT_PX;

const undersizedTextSites = (): string[] =>
  sourceFiles(SRC)
    .map((file) => relative(SRC, file))
    .filter((path) => !OPERATOR_ONLY_SURFACES.includes(path))
    .flatMap((path) =>
      readFileSync(join(SRC, path), 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          arbitraryTextSizesBelow(line, floorFor(line)).map(
            (size) => `${path}:${index + 1} ${size}`,
          ),
        ),
    );

describe('minimum text size', () => {
  it('sets no student-facing text below the 12px floor', () => {
    expect(undersizedTextSites()).toEqual([]);
  });

  it('holds a kicker to its own size rather than excusing its line', () => {
    expect(floorFor('<p className="yr-kicker mb-2 text-[0.68rem]">Label</p>')).toBe(KICKER_TEXT_PX);
    expect(
      arbitraryTextSizesBelow('<p className="yr-kicker text-[0.68rem]">Label</p>', KICKER_TEXT_PX),
    ).toEqual(['text-[0.68rem]']);
    expect(floorFor('<p className="mb-2 text-[0.72rem]">Label</p>')).toBe(MINIMUM_CONTENT_TEXT_PX);
  });

  it('reads an arbitrary size in both units', () => {
    expect(
      arbitraryTextSizesBelow('text-[9px] text-[0.72rem] text-[0.75rem] text-[14px]', 12),
    ).toEqual(['text-[9px]', 'text-[0.72rem]']);
  });
});
