import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/**
 * Requires whitespace between the two words, so `researchHome`, `researchAreas`
 * and `research_area` never match: those are identifiers and stored field names,
 * which the AGENTS.md residue rule leaves in place. Only prose matches.
 */
const DEPRECATED_VOCABULARY = /research\s+(?:home|area)s?\b/i;

/**
 * Patterns that match text y/labs reads rather than text it writes:
 * scraped page boilerplate and stored descriptions generated before the
 * vocabulary was retired. Retiring the words here would stop discarding that
 * boilerplate, so the literals stay and the count is pinned instead.
 */
const SOURCE_TEXT_MATCHER_LINES: Record<string, { construct: string; lines: number }> = {
  'utils/researchTextNormalization.ts': {
    construct: 'GENERIC_CONTEXT_DESCRIPTION_PATTERNS and isDescriptionPlaceholder',
    lines: 5,
  },
};

/**
 * Copy surfaces outside `src`, relative to the client root.
 *
 * `index.html` is the one a reader never opens and every social preview and
 * search engine does: its `description`, `og:description` and
 * `twitter:description` carried "research homes" through the #3186 rename,
 * because the scanner below only walks `.ts` and `.tsx` under `src` and so could
 * not see them. Extending this guard is deliberate rather than adding a second
 * mechanism, so there is one place that answers "where can retired vocabulary
 * hide".
 */
const COPY_FILES_OUTSIDE_SRC = ['index.html', 'public/index.html', 'public/manifest.json'];

const CLIENT_ROOT = join(SRC, '..');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const deprecatedLinesByFile = (): Map<string, number[]> => {
  const found = new Map<string, number[]>();
  const scanned = [
    ...sourceFiles(SRC),
    ...COPY_FILES_OUTSIDE_SRC.map((file) => join(CLIENT_ROOT, file)),
  ];
  for (const file of scanned) {
    const hits = readFileSync(file, 'utf8')
      .split('\n')
      .map((line, index) => (DEPRECATED_VOCABULARY.test(line) ? index + 1 : 0))
      .filter(Boolean);
    if (hits.length) found.set(relative(SRC, file), hits);
  }
  return found;
};

describe('deprecated vocabulary guard', () => {
  it('keeps "research home" and "research area" out of every file that authors copy', () => {
    const unexpected = [...deprecatedLinesByFile().entries()]
      .filter(([file]) => !SOURCE_TEXT_MATCHER_LINES[file])
      .map(([file, lines]) => `${file}:${lines.join(',')}`);

    expect(
      unexpected,
      'The 2026-08-25 "Simple Directory First" decision in docs/decisions.md retires ' +
        '"research home" and "research area" in favor of plain directory language: say ' +
        '"research" or the entity\'s own kind noun (lab, center, faculty research profile) ' +
        'for the thing, "research website" for websiteUrl, and "topics" for researchAreas. ' +
        'If this line matches stored or scraped text rather than copy y/labs writes, ' +
        'add its construct to SOURCE_TEXT_MATCHER_LINES.',
    ).toEqual([]);
  });

  it('holds each source-text matcher to its recorded size', () => {
    const found = deprecatedLinesByFile();
    const drift = Object.entries(SOURCE_TEXT_MATCHER_LINES)
      .map(([file, { construct, lines }]) => {
        const actual = found.get(file)?.length ?? 0;
        return actual === lines ? '' : `${file} (${construct}): expected ${lines}, found ${actual}`;
      })
      .filter(Boolean);

    expect(
      drift,
      'Growth means new deprecated vocabulary landed outside the matcher; shrinkage means ' +
        'a matcher was removed. Either way, update SOURCE_TEXT_MATCHER_LINES deliberately.',
    ).toEqual([]);
  });
});
