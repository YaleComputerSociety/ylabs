import { describe, expect, it } from 'vitest';

import { buildCanonicalNameRepairPlan } from '../repairResearchEntityCanonicalNames';

describe('repairResearchEntityCanonicalNames', () => {
  it('plans the source-backed Lin Zhong lab rename while preserving the slug', () => {
    const plan = buildCanonicalNameRepairPlan({
      _id: 'entity-1',
      slug: 'dept-cs-lin-zhong',
      name: 'Lin Zhong Lab',
      displayName: 'The Lin Zhong Lab',
      websiteUrl: 'https://yecl.org/',
      sourceUrls: ['https://engineering.yale.edu/faculty-research/faculty-directory/lin-zhong'],
      manuallyLockedFields: [],
    });

    expect(plan).toMatchObject({
      eligible: true,
      reason: 'official_lab_identity_preferred_over_pi_generated_label',
      plannedChanges: [
        {
          id: 'entity-1',
          slug: 'dept-cs-lin-zhong',
          previousName: 'Lin Zhong Lab',
          previousDisplayName: 'The Lin Zhong Lab',
          newName: 'Efficient Computing Lab',
          newDisplayName: 'Efficient Computing Lab',
          slugPreserved: true,
          deferredAlias: 'Lin Zhong Lab',
          addManualLocks: ['name', 'displayName'],
        },
      ],
    });
  });

  it('does not plan a rename without both official lab and faculty sources', () => {
    const plan = buildCanonicalNameRepairPlan({
      _id: 'entity-1',
      slug: 'dept-cs-lin-zhong',
      name: 'Lin Zhong Lab',
      displayName: 'Lin Zhong Lab',
      sourceUrls: ['https://engineering.yale.edu/faculty-research/faculty-directory/lin-zhong'],
    });

    expect(plan.eligible).toBe(false);
    expect(plan.reason).toBe('missing_official_lab_and_faculty_sources');
    expect(plan.plannedChanges).toEqual([]);
  });

  it('does not add manual locks that already exist', () => {
    const plan = buildCanonicalNameRepairPlan({
      _id: 'entity-1',
      slug: 'dept-cs-lin-zhong',
      name: 'Lin Zhong Lab',
      displayName: 'Lin Zhong Lab',
      websiteUrl: 'https://yecl.org/',
      sourceUrls: ['https://engineering.yale.edu/faculty-research/faculty-directory/lin-zhong'],
      manuallyLockedFields: ['name'],
    });

    expect(plan.plannedChanges[0].addManualLocks).toEqual(['displayName']);
  });
});
