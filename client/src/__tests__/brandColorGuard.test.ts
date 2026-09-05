import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

const GENERIC_BLUE = /\bblue-\d/;

/**
 * Deliberate multi-hue scales, keyed by the construct that owns them, mirroring
 * the table in client/DESIGN.md. The count is the number of lines in the file
 * that legitimately carry a generic blue. Anything else is brand-color drift.
 *
 * The exemption is per construct rather than per file: a file listed here is
 * ordinary brand color everywhere except the named construct.
 */
const SCALE_LINES: Record<string, { construct: string; lines: number }> = {
  'providers/ConfigContextProvider.tsx': {
    construct: 'colorKeyToTailwind and departmentColorKeyToTailwind',
    lines: 2,
  },
  'components/labs/LabMembersList.tsx': { construct: 'ROLE_PILL_CLASSES', lines: 2 },
  'components/admin/AdminResearchAreas.tsx': { construct: 'FIELD_COLORS', lines: 1 },
  'components/admin/AdminDepartments.tsx': { construct: 'CATEGORY_COLORS', lines: 1 },
  'utils/researchPlanStages.ts': { construct: 'researchPlanStageMeta', lines: 1 },
  'utils/fellowshipCycle.ts': { construct: 'fellowship cycle badge', lines: 1 },
  'types/browsable.ts': { construct: 'browsable kind badge', lines: 2 },
  'components/analytics/analyticsPresentation.tsx': { construct: 'toneClass', lines: 1 },
  'components/accounts/SavedResearchPlans.tsx': { construct: 'accessBadgeClass', lines: 1 },
  'components/fellowship/FellowshipModal.tsx': { construct: 'filter-category chips', lines: 1 },
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const blueLinesByFile = (): Map<string, number[]> => {
  const found = new Map<string, number[]>();
  for (const file of sourceFiles(SRC)) {
    const hits = readFileSync(file, 'utf8')
      .split('\n')
      .map((line, index) => (GENERIC_BLUE.test(line) ? index + 1 : 0))
      .filter(Boolean);
    if (hits.length) found.set(relative(SRC, file), hits);
  }
  return found;
};

describe('brand color guard', () => {
  it('keeps generic blue out of every file that holds no deliberate scale', () => {
    const unexpected = [...blueLinesByFile().entries()]
      .filter(([file]) => !SCALE_LINES[file])
      .map(([file, lines]) => `${file}:${lines.join(',')}`);

    expect(
      unexpected,
      'Tailwind generic blue-* is not the Yale brand color. Use a brand token ' +
        '(brand, brand-navy, brand-soft, line-brand) per client/DESIGN.md. If this is ' +
        'a member of a deliberate multi-hue scale, add its construct to SCALE_LINES ' +
        'and to the table in client/DESIGN.md.',
    ).toEqual([]);
  });

  it('holds each deliberate scale to its recorded size', () => {
    const found = blueLinesByFile();
    const drift = Object.entries(SCALE_LINES)
      .map(([file, { construct, lines }]) => {
        const actual = found.get(file)?.length ?? 0;
        return actual === lines ? '' : `${file} (${construct}): expected ${lines}, found ${actual}`;
      })
      .filter(Boolean);

    expect(
      drift,
      'A scale changed size. Growth means new generic blue landed outside the scale; ' +
        'shrinkage means the scale was converted. Either way, update SCALE_LINES and ' +
        'the table in client/DESIGN.md together.',
    ).toEqual([]);
  });
});
