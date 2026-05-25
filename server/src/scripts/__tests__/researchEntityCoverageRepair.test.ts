import { describe, expect, it } from 'vitest';
import {
  buildTrustTierMissingLeadsFilter,
  parseAcceptedLeadMappings,
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
      acceptedLeadsPath: undefined,
      issues: [...DEFAULT_REPAIR_ISSUES],
      limit: 12,
      minScore: 8,
      slug: undefined,
      syncMeili: true,
      trustTierMissingLeads: true,
    });
  });

  it('parses accepted lead mappings from CSV and JSON artifacts', () => {
    expect(
      parseAcceptedLeadMappings(
        'slug,netid,sourceUrl,note\nysm-mi,wm366,https://medicine.yale.edu/lab/mi/,"homepage names Dr. Wei Mi"',
      ),
    ).toEqual([
      {
        slug: 'ysm-mi',
        netid: 'wm366',
        sourceUrl: 'https://medicine.yale.edu/lab/mi/',
        note: 'homepage names Dr. Wei Mi',
      },
    ]);

    expect(
      parseAcceptedLeadMappings(
        JSON.stringify({
          leads: [
            {
              slug: 'ysm-springer',
              netid: 'sas66',
              source_url: 'https://medicine.yale.edu/lab/springer/',
              reason: 'PI section names Sandra Springer',
            },
          ],
        }),
      ),
    ).toEqual([
      {
        slug: 'ysm-springer',
        netid: 'sas66',
        sourceUrl: 'https://medicine.yale.edu/lab/springer/',
        note: 'PI section names Sandra Springer',
      },
    ]);
  });

  it('keeps multiple accepted lead mappings for the same slug', () => {
    expect(
      parseAcceptedLeadMappings(
        [
          'slug,netid,sourceUrl',
          'ysm-shared,abc123,https://medicine.yale.edu/profile/one/',
          'ysm-shared,def456,https://medicine.yale.edu/profile/two/',
        ].join('\n'),
      ),
    ).toEqual([
      {
        slug: 'ysm-shared',
        netid: 'abc123',
        sourceUrl: 'https://medicine.yale.edu/profile/one/',
        note: undefined,
      },
      {
        slug: 'ysm-shared',
        netid: 'def456',
        sourceUrl: 'https://medicine.yale.edu/profile/two/',
        note: undefined,
      },
    ]);
  });

  it('preserves URL fragments while skipping comment lines', () => {
    expect(
      parseAcceptedLeadMappings(
        [
          '# reviewed source-backed lead',
          'slug,netid,sourceUrl',
          'ysm-anchor,abc123,https://medicine.yale.edu/profile/one/#research',
        ].join('\n'),
      ),
    ).toEqual([
      {
        slug: 'ysm-anchor',
        netid: 'abc123',
        sourceUrl: 'https://medicine.yale.edu/profile/one/#research',
        note: undefined,
      },
    ]);
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
