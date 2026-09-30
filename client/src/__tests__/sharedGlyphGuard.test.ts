import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/**
 * A forward affordance is an icon, not a character. Typed as a glyph it inherits
 * the font's weight and metrics, so it renders at a different size and stroke
 * from the same affordance drawn as an icon three cards away.
 */
const LITERAL_FORWARD_GLYPH = /[→➔➜⟶›»]/;

/** The arrow path itself, which should exist in exactly one place. */
const ARROW_PATH = /d="m12 5 7 7-7 7"|d="M5 12h14"/;

const ARROW_ICON = 'components/shared/icons.tsx';

const componentFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : componentFiles(full);
    }
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [full] : [];
  });

const isComment = (line: string): boolean => /^\s*(?:\/\/|\/\*|\*)/.test(line);

const sitesWhere = (matches: (line: string, file: string) => boolean): string[] => {
  const sites: string[] = [];
  for (const file of componentFiles(SRC)) {
    const name = relative(SRC, file);
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (isComment(line)) return;
        if (matches(line, name)) sites.push(`${name}:${index + 1}`);
      });
  }
  return sites;
};

describe('shared glyph guard', () => {
  it('renders a forward affordance as an icon rather than a character', () => {
    expect(sitesWhere((line) => LITERAL_FORWARD_GLYPH.test(line))).toEqual([]);
  });

  it('draws the arrow path only in the icon set', () => {
    expect(sitesWhere((line, file) => ARROW_PATH.test(line) && file !== ARROW_ICON)).toEqual([]);
  });
});
