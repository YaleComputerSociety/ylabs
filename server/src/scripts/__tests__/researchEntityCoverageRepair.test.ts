import { describe, expect, it } from 'vitest';
import { parseResearchEntityCoverageRepairArgs } from '../researchEntityCoverageRepair';
import { DEFAULT_REPAIR_ISSUES } from '../researchEntityCoverageRepairCore';

describe('researchEntityCoverageRepair CLI', () => {
  it('parses Trust Tier missing-lead targeting without changing default repair issues', () => {
    expect(
      parseResearchEntityCoverageRepairArgs([
        '--trust-tier-missing-leads',
        '--limit=21',
        '--sync-meili',
        '--apply',
      ]),
    ).toEqual({
      apply: true,
      includeArchived: false,
      issues: [...DEFAULT_REPAIR_ISSUES],
      limit: 21,
      minScore: 8,
      slug: undefined,
      syncMeili: true,
      trustTierMissingLeads: true,
    });
  });
});
