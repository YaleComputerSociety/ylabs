import { describe, expect, it } from 'vitest';
import { parseRepairResearchEntityDescriptionsTwoFieldArgs } from '../repairResearchEntityDescriptionsTwoField';

describe('repairResearchEntityDescriptionsTwoField CLI', () => {
  it('parses explicit weak-placeholder repair flag for bounded cleanup chunks', () => {
    expect(
      parseRepairResearchEntityDescriptionsTwoFieldArgs([
        '--limit=25',
        '--slug=dept-econ-raphael-duguay',
        '--repair-weak-placeholders',
        '--only-weak-placeholders',
        '--sync-meili',
        '--apply',
      ]),
    ).toEqual({
      apply: true,
      limit: 25,
      slug: 'dept-econ-raphael-duguay',
      repairWeakPlaceholders: true,
      onlyWeakPlaceholders: true,
      syncMeili: true,
    });
  });
});
