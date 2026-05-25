import { describe, expect, it } from 'vitest';
import {
  buildFundingResearchEntityDedupePlan,
  buildOfficialLabUrlResearchEntityDedupePlan,
  buildResearchEntityPiDedupePlan,
  selectCurrentMemberIdsToRetire,
  shouldRetireDuplicateCurrentMembersForDedupeRun,
} from '../researchEntityPiDedupeCore';
import {
  parseResearchEntityPiDedupeArgs,
  profileAreaNamesForPi,
  shouldRelinkReferencesForResearchEntityPiDedupeRun,
} from '../dedupeResearchEntitiesByPi';

describe('buildResearchEntityPiDedupePlan', () => {
  it('plans same-PI same-name research entity merges and preserves source metadata', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'user-1',
        normalizedName: 'alex rivera lab',
        entities: [
          {
            id: 'physics-entity',
            slug: 'dept-physics-alex-rivera',
            name: 'Alex Rivera Lab',
            websiteUrl: 'https://rivera.example.edu',
            sourceUrls: ['https://physics.example.edu/alex-rivera'],
            departments: ['Physics'],
          },
          {
            id: 'astronomy-entity',
            slug: 'dept-astronomy-alex-rivera',
            name: 'Alex Rivera Lab',
            websiteUrl: 'https://rivera.example.edu',
            sourceUrls: ['https://astronomy.example.edu/alex-rivera'],
            departments: ['Astronomy'],
          },
        ],
      },
    ]);

    expect(plan).toEqual([
      {
        userId: 'user-1',
        normalizedName: 'alex rivera lab',
        canonicalEntityId: 'astronomy-entity',
        duplicateEntityIds: ['physics-entity'],
        canonicalSlug: 'dept-astronomy-alex-rivera',
        duplicateSlugs: ['dept-physics-alex-rivera'],
        mergedDepartments: ['Physics', 'Astronomy'],
        mergedResearchAreas: [],
        mergedSourceUrls: [
          'https://physics.example.edu/alex-rivera',
          'https://astronomy.example.edu/alex-rivera',
          'https://rivera.example.edu',
        ],
      },
    ]);
  });

  it('does not plan name-only clusters without a shared PI user', () => {
    expect(
      buildResearchEntityPiDedupePlan([
        {
          userId: 'user-1',
          normalizedName: 'chen lab',
          entities: [{ id: 'one', slug: 'chen-lab-one' }],
        },
        {
          userId: 'user-2',
          normalizedName: 'chen lab',
          entities: [{ id: 'two', slug: 'chen-lab-two' }],
        },
      ]),
    ).toEqual([]);
  });

  it('does not use surname-only lab names as same-PI merge evidence', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'fixture-voss-user',
        normalizedName: 'fixture-voss-labs',
        piFirstName: 'Fixture',
        piLastName: 'Voss',
        entities: [
          {
            id: 'nih-fixture-voss',
            slug: 'nih-pi-fixture-voss',
            name: 'Fixture Voss Lab',
            sourceUrls: ['https://reporter.nih.gov/project-details/11361080'],
            departments: ['BIOCHEMISTRY'],
          },
          {
            id: 'dept-voss',
            slug: 'voss-lab-mv2',
            name: 'Voss Lab',
            departments: ['MCDB - Molecular, Cellular & Developmental Biology'],
          },
        ],
      },
    ]);

    expect(plan).toEqual([]);
  });

  it('prefers Yale-backed profile rows over funding-only rows when no lab page exists', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'fixture-voss-user',
        normalizedName: 'same-pi:fixture-voss-user',
        piFirstName: 'Fixture',
        piLastName: 'Voss',
        entities: [
          {
            id: 'nih-fixture-voss',
            slug: 'nih-pi-fixture-voss',
            name: 'Fixture Voss Lab',
            sourceUrls: ['https://reporter.nih.gov/project-details/11361080'],
          },
          {
            id: 'profile-fixture-voss',
            slug: 'faculty-research-area-fixture-voss',
            name: 'Fixture Voss Research',
            sourceUrls: ['https://medicine.yale.edu/profile/fixture-voss/'],
          },
        ],
      },
    ]);

    expect(plan).toMatchObject([
      {
        canonicalEntityId: 'profile-fixture-voss',
        duplicateEntityIds: ['nih-fixture-voss'],
      },
    ]);
  });

  it('does not merge same-PI surname labs when the full-name lab belongs to another first name', () => {
    expect(
      buildResearchEntityPiDedupePlan([
        {
          userId: 'jordan-case-user',
          normalizedName: 'case-labs',
          piFirstName: 'Jordan',
          piLastName: 'Case',
          entities: [
            { id: 'surname-lab', slug: 'ysm-case', name: 'Case Lab' },
            {
              id: 'other-first-name-lab',
              slug: 'nih-pi-jaime-case',
              name: 'Jaime Case Lab',
            },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it('does not expand PI candidates to surname-only lab names', () => {
    expect(profileAreaNamesForPi('Taylor', 'Quinn')).toEqual([
      'Taylor Quinn Lab',
      'Taylor Quinn Laboratory',
      'Taylor Quinn Research',
    ]);
    expect(profileAreaNamesForPi('Taylor', 'Quinn')).not.toContain('Quinn Lab');
  });

  it('coalesces overlapping exact-name and PI-name matches into one merge group', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'fixture-voss-user',
        normalizedName: 'same-pi:fixture-voss-user',
        piFirstName: 'Fixture',
        piLastName: 'Voss',
        entities: [
          {
            id: 'nih-fixture-voss',
            slug: 'nih-pi-fixture-voss',
            name: 'Fixture Voss Lab',
            sourceUrls: [
              'https://reporter.nih.gov/project-details/11361080',
              'https://reporter.nih.gov/project-details/11130192',
            ],
          },
          {
            id: 'dept-voss',
            slug: 'voss-lab-mv2',
            name: 'Fixture Voss Lab',
            departments: ['MCDB'],
          },
          {
            id: 'other-voss',
            slug: 'dept-voss',
            name: 'Fixture Voss Lab',
            departments: ['Biochemistry'],
          },
        ],
      },
    ]);

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      canonicalEntityId: 'other-voss',
      duplicateEntityIds: ['nih-fixture-voss', 'dept-voss'],
    });
  });

  it('does not merge profile-page chrome into canonical profile-area cleanup research areas', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'casey-marin-user',
        normalizedName: 'same-pi:casey-marin-user',
        piFirstName: 'Casey',
        piLastName: 'Marin',
        entities: [
          {
            id: 'dept-casey-marin',
            slug: 'dept-mcdb-casey-marin',
            name: 'Casey Marin Lab',
            researchAreas: ['Cell signaling'],
          },
          {
            id: 'profile-casey-marin',
            slug: 'faculty-research-area-casey-marin',
            name: 'Casey Marin Research',
            researchAreas: [
              'Research topics Casey Marin is interested in exploring.',
              'ProfileHeaderTheoristExample navigation text',
              'Theorist',
            ],
          },
        ],
      },
    ]);

    expect(plan[0]?.mergedResearchAreas).toEqual(['Cell signaling']);
  });

  it('keeps the strongest current member row and retires duplicate memberships', () => {
    expect(
      selectCurrentMemberIdsToRetire([
        {
          id: 'old-low-confidence',
          confidence: 0.4,
          lastObservedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'new-high-confidence',
          confidence: 0.9,
          lastObservedAt: new Date('2026-01-02T00:00:00Z'),
          sourceUrl: 'https://example.edu/profile',
        },
        {
          id: 'newer-low-confidence',
          confidence: 0.5,
          lastObservedAt: new Date('2026-01-03T00:00:00Z'),
        },
      ]),
    ).toEqual(['old-low-confidence', 'newer-low-confidence']);
  });

  it('requires explicit delete mode when duplicate entities should be removed instead of archived', () => {
    expect(parseResearchEntityPiDedupeArgs(['--apply', '--delete-duplicates'])).toEqual({
      apply: true,
      deleteDuplicates: true,
      fundingOnly: false,
      fullPlan: false,
      officialLabUrlOnly: false,
      reviewedProfileAreaOnly: false,
      limit: 10000,
      slug: undefined,
    });
    expect(parseResearchEntityPiDedupeArgs(['--apply'])).toEqual({
      apply: true,
      deleteDuplicates: false,
      fundingOnly: false,
      fullPlan: false,
      officialLabUrlOnly: false,
      reviewedProfileAreaOnly: false,
      limit: 10000,
      slug: undefined,
    });
    expect(
      parseResearchEntityPiDedupeArgs([
        '--slug=faculty-research-area-fixture-voss',
        '--reviewed-profile-area-only',
      ]),
    ).toEqual({
      apply: false,
      deleteDuplicates: false,
      fundingOnly: false,
      fullPlan: false,
      officialLabUrlOnly: false,
      reviewedProfileAreaOnly: true,
      limit: 10000,
      slug: 'faculty-research-area-fixture-voss',
    });
    expect(parseResearchEntityPiDedupeArgs(['--full-plan'])).toEqual({
      apply: false,
      deleteDuplicates: false,
      fundingOnly: false,
      fullPlan: true,
      officialLabUrlOnly: false,
      reviewedProfileAreaOnly: false,
      limit: 10000,
      slug: undefined,
    });
  });

  it('parses reviewed profile-area cleanup mode separately from funding cleanup', () => {
    expect(parseResearchEntityPiDedupeArgs(['--reviewed-profile-area-only'])).toMatchObject({
      fundingOnly: false,
      reviewedProfileAreaOnly: true,
    });
  });

  it('parses funding-only cleanup mode', () => {
    expect(parseResearchEntityPiDedupeArgs(['--funding-only', '--limit=50'])).toEqual({
      apply: false,
      deleteDuplicates: false,
      fundingOnly: true,
      fullPlan: false,
      officialLabUrlOnly: false,
      reviewedProfileAreaOnly: false,
      limit: 50,
      slug: undefined,
    });
  });

  it('parses official lab URL cleanup mode', () => {
    expect(parseResearchEntityPiDedupeArgs(['--official-lab-url-only'])).toMatchObject({
      fundingOnly: false,
      officialLabUrlOnly: true,
      reviewedProfileAreaOnly: false,
    });
  });

  it('relinks dependent artifacts for every applied dedupe mode', () => {
    expect(shouldRelinkReferencesForResearchEntityPiDedupeRun({ apply: true })).toBe(true);
    expect(shouldRelinkReferencesForResearchEntityPiDedupeRun({ apply: false })).toBe(false);
  });
});

describe('buildOfficialLabUrlResearchEntityDedupePlan', () => {
  it('merges entities that share an exact official Yale lab URL without requiring PI membership', () => {
    const plan = buildOfficialLabUrlResearchEntityDedupePlan([
      {
        url: 'https://medicine.yale.edu/lab/synthetic-atlas/',
        entities: [
          {
            id: 'ysm-atlas',
            slug: 'ysm-atlas',
            name: 'Atlas Lab',
            websiteUrl: 'https://medicine.yale.edu/lab/synthetic-atlas/',
            sourceUrls: [
              'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
              'https://medicine.yale.edu/lab/synthetic-atlas/',
            ],
            departments: ['Molecular Biophysics & Biochemistry'],
          },
          {
            id: 'dept-fixture-atlas',
            slug: 'dept-mcdb-fixture-atlas',
            name: 'Fixture Atlas Lab',
            websiteUrl: 'https://medicine.yale.edu/lab/synthetic-atlas/',
            sourceUrls: [
              'https://mcdb.yale.edu/people/faculty',
              'https://medicine.yale.edu/profile/fixture-atlas/',
              'https://medicine.yale.edu/lab/synthetic-atlas/',
            ],
            departments: ['Molecular, Cellular & Developmental Biology'],
          },
        ],
      },
    ]);

    expect(plan).toEqual([
      {
        userId: 'official-lab-url:https://medicine.yale.edu/lab/synthetic-atlas/',
        normalizedName: 'official-lab-url:https://medicine.yale.edu/lab/synthetic-atlas/',
        canonicalEntityId: 'dept-fixture-atlas',
        duplicateEntityIds: ['ysm-atlas'],
        canonicalSlug: 'dept-mcdb-fixture-atlas',
        duplicateSlugs: ['ysm-atlas'],
        mergedDepartments: [
          'Molecular Biophysics & Biochemistry',
          'Molecular, Cellular & Developmental Biology',
        ],
        mergedResearchAreas: [],
        mergedSourceUrls: [
          'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
          'https://medicine.yale.edu/lab/synthetic-atlas/',
          'https://mcdb.yale.edu/people/faculty',
          'https://medicine.yale.edu/profile/fixture-atlas/',
        ],
      },
    ]);
  });

  it('ignores shared directory URLs because they identify source pages, not duplicate entities', () => {
    expect(
      buildOfficialLabUrlResearchEntityDedupePlan([
        {
          url: 'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
          entities: [
            { id: 'ysm-one', slug: 'ysm-one', name: 'One Lab' },
            { id: 'ysm-two', slug: 'ysm-two', name: 'Two Lab' },
          ],
        },
      ]),
    ).toEqual([]);
  });
});

describe('buildFundingResearchEntityDedupePlan', () => {
  it('archives funding-only duplicate shells into stronger Yale-backed entities', () => {
    const plan = buildFundingResearchEntityDedupePlan([
      {
        userId: 'name:avery-stone-lab',
        normalizedName: 'avery stone lab',
        entities: [
          {
            id: 'dept-avery-stone',
            slug: 'dept-math-avery-stone',
            name: 'Avery Stone Lab',
            websiteUrl: 'https://avery-stone.example.edu/',
            sourceUrls: ['https://math.yale.edu/profile/avery-stone'],
            departments: ['Mathematics'],
            researchAreas: ['Geometric Analysis'],
          },
          {
            id: 'nsf-avery-stone',
            slug: 'nsf-pi-avery-stone',
            name: 'Avery Stone Lab',
            sourceUrls: ['https://www.nsf.gov/awardsearch/showAward?AWD_ID=1234567'],
          },
        ],
      },
    ]);

    expect(plan).toEqual([
      {
        userId: 'name:avery-stone-lab',
        normalizedName: 'avery stone lab',
        canonicalEntityId: 'dept-avery-stone',
        duplicateEntityIds: ['nsf-avery-stone'],
        canonicalSlug: 'dept-math-avery-stone',
        duplicateSlugs: ['nsf-pi-avery-stone'],
        mergedDepartments: ['Mathematics'],
        mergedResearchAreas: ['Geometric Analysis'],
        mergedSourceUrls: [
          'https://math.yale.edu/profile/avery-stone',
          'https://www.nsf.gov/awardsearch/showAward?AWD_ID=1234567',
          'https://avery-stone.example.edu/',
        ],
      },
    ]);
  });

  it('does not plan funding-only groups without a stronger non-funding target', () => {
    expect(
      buildFundingResearchEntityDedupePlan([
        {
          userId: 'name:grant-only',
          normalizedName: 'grant only lab',
          entities: [
            {
              id: 'nsf-only',
              slug: 'nsf-pi-grant-only',
              name: 'Grant Only Lab',
              sourceUrls: ['https://www.nsf.gov/awardsearch/showAward?AWD_ID=1'],
            },
            {
              id: 'nih-only',
              slug: 'nih-pi-grant-only',
              name: 'Grant Only Lab',
              sourceUrls: ['https://reporter.nih.gov/project-details/1'],
            },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it('does not treat notyale.edu as Yale-backed evidence', () => {
    expect(
      buildFundingResearchEntityDedupePlan([
        {
          userId: 'name:spoofed',
          normalizedName: 'spoofed lab',
          entities: [
            {
              id: 'spoofed',
              slug: 'spoofed-lab',
              name: 'Spoofed Lab',
              websiteUrl: 'https://notyale.edu/spoofed',
            },
            {
              id: 'nsf-spoofed',
              slug: 'nsf-pi-spoofed',
              name: 'Spoofed Lab',
              sourceUrls: ['https://www.nsf.gov/awardsearch/showAward?AWD_ID=1'],
            },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it('does not merge profile-page chrome into canonical funding cleanup research areas', () => {
    const plan = buildFundingResearchEntityDedupePlan([
      {
        userId: 'name:fixture-chen-lab',
        normalizedName: 'riley chen lab',
        piFirstName: 'Riley',
        piLastName: 'Chen',
        entities: [
          {
            id: 'ysm-chen',
            slug: 'ysm-chen',
            name: 'Fixture Chen Lab',
            websiteUrl: 'https://medicine.yale.edu/lab/fixture-chen/',
            sourceUrls: ['https://medicine.yale.edu/lab/fixture-chen/'],
            researchAreas: [
              'Example Faculty, PhDView Full ProfileView 48 Common Publications',
              'View Full Profile',
              '48',
              'Publications',
              '979',
              'Citations',
              'Spectral imaging methods',
              'Computational image analysis',
            ],
          },
          {
            id: 'nih-fixture-chen',
            slug: 'nih-pi-fixture-chen',
            name: 'Fixture Chen Lab',
            sourceUrls: ['https://reporter.nih.gov/project-details/11134536'],
          },
        ],
      },
    ]);

    expect(plan[0]?.mergedResearchAreas).toEqual([
      'Spectral imaging methods',
      'Computational image analysis',
    ]);
  });
});

describe('shouldRetireDuplicateCurrentMembersForDedupeRun', () => {
  it('skips global current-member retirement in funding-only cleanup mode', () => {
    expect(shouldRetireDuplicateCurrentMembersForDedupeRun({ fundingOnly: true })).toBe(false);
    expect(shouldRetireDuplicateCurrentMembersForDedupeRun({ fundingOnly: false })).toBe(true);
  });
});
