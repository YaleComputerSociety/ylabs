import { describe, expect, it } from 'vitest';
import {
  buildTrustTierMissingLeadsFilter,
  parseResearchEntityCoverageRepairArgs,
} from '../researchEntityCoverageRepair';
import { DEFAULT_REPAIR_ISSUES } from '../researchEntityCoverageRepairCore';

describe('researchEntityCoverageRepair CLI', () => {
  it('parses Trust Tier missing-lead targeting without changing default repair issues', () => {
    expect(
      parseResearchEntityCoverageRepairArgs([
        '--trust-tier-missing-leads',
        '--limit=12',
        '--sync-meili',
        '--apply',
      ]),
    ).toEqual({
      apply: true,
      includeArchived: false,
      issues: [...DEFAULT_REPAIR_ISSUES],
      limit: 12,
      minScore: 8,
      slug: undefined,
      syncMeili: true,
      trustTierMissingLeads: true,
    });
  });

  it('targets only lab-like Trust Tier missing-lead rows', () => {
    expect(buildTrustTierMissingLeadsFilter()).toEqual({
      archived: { $ne: true },
      studentVisibilityTier: 'operator_review',
      studentVisibilityReasons: {
        $all: ['source_backed_description', 'concrete_next_step', 'missing_lead'],
      },
      $or: [{ kind: 'lab' }, { entityType: 'LAB' }],
    });
  });
});
