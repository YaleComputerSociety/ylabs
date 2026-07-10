import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  buildFundingResearchEntityDedupePlan,
  buildOfficialLabUrlResearchEntityDedupePlan,
  buildResearchEntityPiDedupePlan,
  selectSamePiDuplicateRiskEntityIds,
  selectCurrentMemberIdsToRetire,
  shouldRetireDuplicateCurrentMembersForDedupeRun,
} from '../researchEntityPiDedupeCore';
import {
  parseResearchEntityPiDedupeArgs,
  profileAreaNamesForPi,
  applyResearchEntityPiDedupeGroupsSequentially,
  assertResearchEntityPiDedupeApplyAllowed,
  assertResearchEntityPiDedupeApplyBounded,
  buildArchivedDocumentArchiveSet,
  buildResearchEntityDedupeReferenceFilter,
  chooseArchivedDocumentConflictOutcome,
  chooseResearchEntityPiDedupeConflictAction,
  buildResearchEntityPiDedupeDecisionTemplate,
  readResearchEntityPiDedupeDecisions,
  buildResearchEntityPiDedupeReviewBreakdown,
  normalizeResearchEntityPiDedupeObjectId,
  validateResearchEntityPiDedupeDecisions,
  selectResearchEntityPiDedupePlansForAcceptedMergeApply,
  shouldRelinkReferencesForResearchEntityPiDedupeRun,
  buildResearchEntityPiDedupeOutput,
  writeResearchEntityPiDedupeOutput,
  writeResearchEntityPiDedupeDecisionTemplate,
} from '../dedupeResearchEntitiesByPi';

describe('normalizeResearchEntityPiDedupeObjectId', () => {
  it('rejects object-shaped ids without coercion', () => {
    const objectShapedId = {
      toString: () => '507f1f77bcf86cd799439011',
    };

    expect(normalizeResearchEntityPiDedupeObjectId(objectShapedId)).toBeUndefined();
    expect(
      normalizeResearchEntityPiDedupeObjectId(' 507f1f77bcf86cd799439011 ')?.toHexString(),
    ).toBe('507f1f77bcf86cd799439011');
  });
});

describe('buildResearchEntityPiDedupePlan', () => {
  it('plans a faculty profile-area shell as a duplicate when the same PI has a concrete research home', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'fixture-access-lead-user',
        normalizedName: 'same-pi:fixture-access-lead-user',
        piFirstName: 'Yongli',
        piLastName: 'Zhang',
        entities: [
          {
            id: 'concrete-lab',
            slug: 'ysm-zhang',
            name: 'Zhang Laboratory',
            kind: 'lab',
            entityType: 'LAB',
            websiteUrl: 'https://medicine.yale.edu/lab/zhang/',
            sourceUrls: ['https://medicine.yale.edu/lab/zhang/'],
            departments: ['Internal Medicine'],
          },
          {
            id: 'profile-shell',
            slug: 'faculty-research-area-fixture-access-lead',
            name: 'Yongli Zhang Research',
            kind: 'individual',
            entityType: 'FACULTY_RESEARCH_AREA',
            sourceUrls: ['https://medicine.yale.edu/profile/fixture-access-lead/'],
            departments: ['Internal Medicine'],
          },
        ],
      },
    ]);

    expect(plan).toMatchObject([
      {
        dedupeCategory: 'profile_area_shell_with_concrete_home',
        canonicalEntityId: 'concrete-lab',
        duplicateEntityIds: ['profile-shell'],
        canonicalSlug: 'ysm-zhang',
        duplicateSlugs: ['faculty-research-area-fixture-access-lead'],
      },
    ]);
  });

  it('plans same-user profile-area shells even when the shell uses a preferred-name variant', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'seyedtaghi-takyar-user',
        normalizedName: 'same-pi:seyedtaghi-takyar-user',
        piFirstName: 'Seyedtaghi',
        piLastName: 'Takyar',
        entities: [
          {
            id: 'takyar-lab',
            slug: 'ysm-takyar',
            name: 'Takyar Lab',
            kind: 'lab',
            entityType: 'LAB',
            websiteUrl: 'https://medicine.yale.edu/lab/takyar/',
            sourceUrls: ['https://medicine.yale.edu/lab/takyar/'],
          },
          {
            id: 'profile-shell',
            slug: 'faculty-research-area-shervin-s-takyar',
            name: 'Shervin S. Takyar Research',
            kind: 'individual',
            entityType: 'FACULTY_RESEARCH_AREA',
            websiteUrl: 'https://medicine.yale.edu/cancer/profile/seyedtaghi-takyar/',
            sourceUrls: [
              'https://medicine.yale.edu/cancer/research/membership/directory',
              'https://medicine.yale.edu/cancer/profile/seyedtaghi-takyar/',
            ],
          },
        ],
      },
    ]);

    expect(plan).toMatchObject([
      {
        dedupeCategory: 'profile_area_shell_with_concrete_home',
        canonicalEntityId: 'takyar-lab',
        duplicateEntityIds: ['profile-shell'],
        canonicalSlug: 'ysm-takyar',
        duplicateSlugs: ['faculty-research-area-shervin-s-takyar'],
      },
    ]);
  });

  it('prefers Yale-backed middle-initial profile rows over funding-only rows', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'sara-pai-user',
        normalizedName: 'same-pi:sara-pai-user',
        piFirstName: 'Sara Isabel',
        piLastName: 'Pai',
        entities: [
          {
            id: 'nih-lab',
            slug: 'nih-pi-sara-pai',
            name: 'Sara Pai Lab',
            kind: 'lab',
            entityType: 'LAB',
            sourceUrls: ['https://reporter.nih.gov/project-details/11175447'],
          },
          {
            id: 'profile-shell',
            slug: 'faculty-research-area-sara-i-pai',
            name: 'Sara I. Pai Research',
            kind: 'individual',
            entityType: 'FACULTY_RESEARCH_AREA',
            websiteUrl: 'https://medicine.yale.edu/cancer/profile/sara-pai/',
            sourceUrls: [
              'https://medicine.yale.edu/cancer/research/membership/directory',
              'https://medicine.yale.edu/cancer/profile/sara-pai/',
            ],
          },
        ],
      },
    ]);

    expect(plan).toMatchObject([
      {
        canonicalEntityId: 'profile-shell',
        duplicateEntityIds: ['nih-lab'],
        canonicalSlug: 'faculty-research-area-sara-i-pai',
        duplicateSlugs: ['nih-pi-sara-pai'],
      },
    ]);
  });

  it('does not plan a faculty profile-area shell when there is no concrete home for the same PI', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'ada-lovelace-user',
        normalizedName: 'same-pi:ada-lovelace-user',
        piFirstName: 'Ada',
        piLastName: 'Lovelace',
        entities: [
          {
            id: 'profile-shell',
            slug: 'faculty-research-area-ada-lovelace',
            name: 'Ada Lovelace Research',
            kind: 'individual',
            entityType: 'FACULTY_RESEARCH_AREA',
            sourceUrls: ['https://medicine.yale.edu/profile/ada-lovelace/'],
          },
        ],
      },
    ]);

    expect(plan).toEqual([]);
  });

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

  it('merges same-PI full-name and compound-surname lab names', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'albert-higgins-chen-user',
        normalizedName: 'same-pi:albert-higgins-chen-user',
        piFirstName: 'Taylor',
        piLastName: 'Higgins-Chen',
        entities: [
          {
            id: 'funding-shell',
            slug: 'nih-pi-albert-higgins-chen',
            name: 'Taylor Higgins-Chen Lab',
            sourceUrls: ['https://reporter.nih.gov/project-details/10845546'],
            kind: 'lab',
            entityType: 'LAB',
          },
          {
            id: 'profile-backed-lab',
            slug: 'higgins-chen-lab-at799',
            name: 'Higgins-Chen Lab',
            sourceUrls: ['https://medicine.yale.edu/profile/fixture-hybrid-lead/'],
            kind: 'lab',
            entityType: 'LAB',
          },
        ],
      },
    ]);

    expect(plan).toMatchObject([
      {
        canonicalEntityId: 'profile-backed-lab',
        duplicateEntityIds: ['funding-shell'],
        canonicalSlug: 'higgins-chen-lab-at799',
        duplicateSlugs: ['nih-pi-albert-higgins-chen'],
      },
    ]);
  });

  it('plans profile-backed surname lab shells as duplicates of concrete same-PI homes', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'fixture-access-lead-user',
        normalizedName: 'same-pi:fixture-access-lead-user',
        piFirstName: 'Yongli',
        piLastName: 'Zhang',
        entities: [
          {
            id: 'concrete-lab',
            slug: 'ysm-zhang',
            name: 'Zhang Laboratory of Single-Molecule Biophysics & Biochemistry',
            websiteUrl: 'https://medicine.yale.edu/lab/zhang/',
            sourceUrls: ['https://medicine.yale.edu/lab/zhang/'],
            kind: 'lab',
            entityType: 'LAB',
          },
          {
            id: 'profile-backed-shell',
            slug: 'zhang-lab-yz52',
            name: 'Zhang Lab',
            sourceUrls: ['https://medicine.yale.edu/profile/fixture-access-lead/'],
            kind: 'lab',
            entityType: 'LAB',
          },
        ],
      },
    ]);

    expect(plan).toMatchObject([
      {
        dedupeCategory: 'profile_area_shell_with_concrete_home',
        canonicalEntityId: 'concrete-lab',
        duplicateEntityIds: ['profile-backed-shell'],
        canonicalSlug: 'ysm-zhang',
        duplicateSlugs: ['zhang-lab-yz52'],
      },
    ]);
  });

  it('selects only planned duplicate entity ids as same-PI duplicate visibility risk', () => {
    const duplicateIds = selectSamePiDuplicateRiskEntityIds([
      {
        userId: 'albert-higgins-chen-user',
        normalizedName: 'same-pi:albert-higgins-chen-user',
        piFirstName: 'Taylor',
        piLastName: 'Higgins-Chen',
        entities: [
          {
            id: 'funding-shell',
            slug: 'nih-pi-albert-higgins-chen',
            name: 'Taylor Higgins-Chen Lab',
            sourceUrls: ['https://reporter.nih.gov/project-details/10845546'],
            kind: 'lab',
            entityType: 'LAB',
          },
          {
            id: 'profile-backed-lab',
            slug: 'higgins-chen-lab-at799',
            name: 'Higgins-Chen Lab',
            sourceUrls: ['https://medicine.yale.edu/profile/fixture-hybrid-lead/'],
            kind: 'lab',
            entityType: 'LAB',
          },
        ],
      },
    ]);

    expect(duplicateIds.has('funding-shell')).toBe(true);
    expect(duplicateIds.has('profile-backed-lab')).toBe(false);
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

  it('prefers described profile rows over empty same-PI directory shells', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'fixture-systems-lead-user',
        normalizedName: 'same-pi:fixture-systems-lead-user',
        piFirstName: 'John',
        piLastName: 'Tsang',
        entities: [
          {
            id: 'empty-directory-shell',
            slug: 'faculty-research-area-fixture-systems-lead',
            name: 'John Tsang Research',
            websiteUrl: 'https://wti.yale.edu/humans/faculty',
            sourceUrls: [
              'https://wti.yale.edu/humans/faculty',
              'https://reporter.nih.gov/project-details/11010692',
              'https://medicine.yale.edu/profile/fixture-systems-lead/',
            ],
          },
          {
            id: 'described-profile-shell',
            slug: 'faculty-research-area-john-s-tsang',
            name: 'John S. Tsang Research',
            websiteUrl: 'https://medicine.yale.edu/cancer/profile/fixture-systems-lead/',
            sourceUrls: [
              'https://medicine.yale.edu/cancer/profile/fixture-systems-lead/',
              'https://medicine.yale.edu/profile/fixture-systems-lead/',
            ],
            fullDescription: 'Research fields include systems immunology, maternal-infant dyads, and vaccines.',
            shortDescription: 'Studies systems immunology, maternal-infant dyads, and vaccines.',
          },
        ],
      },
    ]);

    expect(plan).toEqual([
      expect.objectContaining({
        canonicalEntityId: 'described-profile-shell',
        duplicateEntityIds: ['empty-directory-shell'],
        canonicalSlug: 'faculty-research-area-john-s-tsang',
        duplicateSlugs: ['faculty-research-area-fixture-systems-lead'],
      }),
    ]);
  });

  it('prefers a profile-backed NIH fallback over an empty faculty directory shell', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'fixture-informatics-lead-user',
        normalizedName: 'same-pi:fixture-informatics-lead-user',
        piFirstName: 'Lucila',
        piLastName: 'Ohno-Machado',
        entities: [
          {
            id: 'nih-profile-fallback',
            slug: 'nih-pi-fixture-informatics-lead',
            name: 'Lucila OHNO-MACHADO Lab',
            kind: 'lab',
            entityType: 'LAB',
            sourceUrls: [
              'https://reporter.nih.gov/project-details/11225779',
              'https://medicine.yale.edu/profile/fixture-informatics-lead/',
            ],
            departments: ['BIDS - Biomedical Informatics and Data Science'],
            researchAreas: ['Machine Learning', 'Data Science'],
          },
          {
            id: 'directory-shell',
            slug: 'faculty-research-area-fixture-informatics-lead',
            name: 'Lucila Ohno-Machado Research',
            kind: 'individual',
            entityType: 'FACULTY_RESEARCH_AREA',
            websiteUrl: 'https://wti.yale.edu/humans/faculty',
            sourceUrls: ['https://wti.yale.edu/humans/faculty'],
            departments: ['Neuroscience'],
          },
        ],
      },
    ]);

    expect(plan).toEqual([
      expect.objectContaining({
        dedupeCategory: 'profile_area_shell_with_concrete_home',
        canonicalEntityId: 'nih-profile-fallback',
        duplicateEntityIds: ['directory-shell'],
        canonicalSlug: 'nih-pi-fixture-informatics-lead',
        duplicateSlugs: ['faculty-research-area-fixture-informatics-lead'],
      }),
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

  it('merges same-PI surname labs into the matching full-person lab', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'tianyu-zhu-user',
        normalizedName: 'same-pi:tianyu-zhu-user',
        piFirstName: 'Tianyu',
        piLastName: 'Zhu',
        entities: [
          {
            id: 'surname-lab',
            slug: 'zhu-lab-tz324',
            name: 'Zhu Lab',
            departments: ['Chemistry'],
            sourceUrls: ['https://medicine.yale.edu/profile/fixture-tzhu/'],
          },
          {
            id: 'full-person-lab',
            slug: 'nsf-pi-tianyu-zhu',
            name: 'Tianyu Zhu Lab',
            sourceUrls: [
              'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2513473',
              'https://medicine.yale.edu/profile/fixture-tzhu/',
            ],
          },
        ],
      },
    ]);

    expect(plan).toMatchObject([
      {
        canonicalEntityId: 'surname-lab',
        duplicateEntityIds: ['full-person-lab'],
      },
    ]);
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
      confirmResearchEntityPiDedupe: false,
      deleteDuplicates: true,
      fundingOnly: false,
      fullPlan: false,
      officialLabUrlOnly: false,
      reviewedProfileAreaOnly: false,
      limit: 10000,
      limitProvided: false,
      maxApply: 10,
      slug: undefined,
    });
    expect(parseResearchEntityPiDedupeArgs(['--apply'])).toEqual({
      apply: true,
      confirmResearchEntityPiDedupe: false,
      deleteDuplicates: false,
      fundingOnly: false,
      fullPlan: false,
      officialLabUrlOnly: false,
      reviewedProfileAreaOnly: false,
      limit: 10000,
      limitProvided: false,
      maxApply: 10,
      slug: undefined,
    });
    expect(
      parseResearchEntityPiDedupeArgs([
        '--confirm-research-entity-pi-dedupe',
        '--slug=faculty-research-area-fixture-voss',
        '--reviewed-profile-area-only',
      ]),
    ).toEqual({
      apply: false,
      confirmResearchEntityPiDedupe: true,
      deleteDuplicates: false,
      fundingOnly: false,
      fullPlan: false,
      officialLabUrlOnly: false,
      reviewedProfileAreaOnly: true,
      limit: 10000,
      limitProvided: false,
      maxApply: 10,
      slug: 'faculty-research-area-fixture-voss',
    });
    expect(parseResearchEntityPiDedupeArgs(['--full-plan'])).toEqual({
      apply: false,
      confirmResearchEntityPiDedupe: false,
      deleteDuplicates: false,
      fundingOnly: false,
      fullPlan: true,
      officialLabUrlOnly: false,
      reviewedProfileAreaOnly: false,
      limit: 10000,
      limitProvided: false,
      maxApply: 10,
      slug: undefined,
    });
    expect(
      parseResearchEntityPiDedupeArgs([
        '--mode=dry-run',
        '--limit=250',
        '--max-apply=2',
        '--accepted-decisions=/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json',
        '--allow-empty-decisions',
        '--decision-template-output',
        '/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json',
        '--output=/tmp/ylabs-research-entity-dedupe.json',
      ]),
    ).toMatchObject({
      apply: false,
      limit: 250,
      limitProvided: true,
      maxApply: 2,
      acceptedDecisions: '/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions.json',
      allowEmptyDecisions: true,
      decisionTemplateOutput:
        '/tmp/ylabs-research-entity-pi-dedupe-accepted-decisions-template.json',
      output: '/tmp/ylabs-research-entity-dedupe.json',
    });
  });

  it('rejects ambiguous and malformed dedupe CLI arguments', () => {
    expect(() => parseResearchEntityPiDedupeArgs(['prod'])).toThrow(
      /Unknown research-entity:dedupe-by-pi argument: prod/,
    );
    expect(() => parseResearchEntityPiDedupeArgs(['--limit=bad'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseResearchEntityPiDedupeArgs(['--limit=1e3'])).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => parseResearchEntityPiDedupeArgs(['--max-apply=1e3'])).toThrow(
      /--max-apply must be a positive integer/,
    );
    expect(() => parseResearchEntityPiDedupeArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseResearchEntityPiDedupeArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseResearchEntityPiDedupeArgs(['--accepted-decisions', '--apply'])).toThrow(
      /--accepted-decisions requires a path/,
    );
    expect(() => parseResearchEntityPiDedupeArgs(['--accepted-decisions=--apply'])).toThrow(
      /--accepted-decisions requires a path/,
    );
    expect(() =>
      parseResearchEntityPiDedupeArgs(['--decision-template-output', '--apply']),
    ).toThrow(/--decision-template-output requires a path/);
    expect(() =>
      parseResearchEntityPiDedupeArgs(['--decision-template-output=--apply']),
    ).toThrow(/--decision-template-output requires a path/);
    expect(() => parseResearchEntityPiDedupeArgs(['--output=/var/tmp/entity-dedupe.json'])).toThrow(
      /--output must write under/,
    );
    expect(() => parseResearchEntityPiDedupeArgs(['--output=/tmp/entity-dedupe.txt'])).toThrow(
      /--output must point to a \.json report file/,
    );
    expect(() =>
      parseResearchEntityPiDedupeArgs([
        '--accepted-decisions=/var/tmp/entity-dedupe-decisions.json',
      ]),
    ).toThrow(/--accepted-decisions must write under/);
    expect(() =>
      parseResearchEntityPiDedupeArgs([
        '--decision-template-output=/var/tmp/entity-dedupe-template.json',
      ]),
    ).toThrow(/--decision-template-output must write under/);
  });

  it('blocks entity-dedupe apply batches above the explicit max apply bound', () => {
    expect(() =>
      assertResearchEntityPiDedupeApplyAllowed({
        apply: false,
        maxApply: 1,
        plannedDuplicateEntities: 20,
        plannedDuplicateCurrentMembers: 0,
      }),
    ).not.toThrow();

    expect(() =>
      assertResearchEntityPiDedupeApplyAllowed({
        apply: true,
        maxApply: 1,
        plannedDuplicateEntities: 2,
        plannedDuplicateCurrentMembers: 0,
      }),
    ).toThrow(/above --max-apply/);

    expect(() =>
      assertResearchEntityPiDedupeApplyAllowed({
        apply: true,
        maxApply: 3,
        plannedDuplicateEntities: 2,
        plannedDuplicateCurrentMembers: 1,
      }),
    ).not.toThrow();
  });

  it('requires an explicit finite limit before entity-dedupe apply can initialize Mongo', () => {
    expect(parseResearchEntityPiDedupeArgs(['--limit=25'])).toMatchObject({
      limit: 25,
      limitProvided: true,
    });

    expect(() =>
      assertResearchEntityPiDedupeApplyBounded({
        apply: true,
        confirmResearchEntityPiDedupe: true,
        limitProvided: false,
      }),
    ).toThrow(/--limit is required when --apply is set/);

    expect(() =>
      assertResearchEntityPiDedupeApplyBounded({
        apply: true,
        confirmResearchEntityPiDedupe: true,
        limitProvided: true,
      }),
    ).not.toThrow();
  });

  it('requires explicit confirmation before entity-dedupe apply can initialize Mongo', () => {
    expect(parseResearchEntityPiDedupeArgs(['--apply', '--limit=25'])).toMatchObject({
      apply: true,
      confirmResearchEntityPiDedupe: false,
      limit: 25,
      limitProvided: true,
    });

    expect(() =>
      assertResearchEntityPiDedupeApplyBounded({
        apply: true,
        confirmResearchEntityPiDedupe: false,
        limitProvided: true,
      }),
    ).toThrow(/--confirm-research-entity-pi-dedupe is required/);
  });

  it('allows apply with accepted decisions after the plan is filtered to accepted merges', () => {
    const args = {
      apply: true,
      maxApply: 10,
      plannedDuplicateEntities: 1,
      plannedDuplicateCurrentMembers: 0,
    };

    expect(() => assertResearchEntityPiDedupeApplyAllowed(args)).not.toThrow();
  });

  it('does not allow archive-mode dedupe conflicts to delete reference rows', () => {
    expect(
      chooseResearchEntityPiDedupeConflictAction({
        deleteDuplicates: false,
        archiveOnConflict: true,
      }),
    ).toBe('archive');

    expect(
      chooseResearchEntityPiDedupeConflictAction({
        deleteDuplicates: false,
        archiveOnConflict: false,
      }),
    ).toBe('throw');

    expect(
      chooseResearchEntityPiDedupeConflictAction({
        deleteDuplicates: true,
        archiveOnConflict: false,
      }),
    ).toBe('delete');
  });

  it('blocks archived-document conflict deletion unless delete mode explicitly allows it', () => {
    expect(chooseArchivedDocumentConflictOutcome({ allowDeleteOnConflict: false })).toBe(
      'blocked',
    );
    expect(chooseArchivedDocumentConflictOutcome({ allowDeleteOnConflict: true })).toBe('delete');
  });

  it('can retry archived duplicate artifacts without relinking into a canonical duplicate key', () => {
    const now = new Date('2026-05-31T12:00:00Z');

    expect(
      buildArchivedDocumentArchiveSet({
        now,
        relinkField: 'researchEntityId',
        relinkValue: 'canonical-entity',
        includeRelink: true,
      }),
    ).toEqual({
      archived: true,
      lastMaterializedAt: now,
      researchEntityId: 'canonical-entity',
    });

    expect(
      buildArchivedDocumentArchiveSet({
        now,
        relinkField: 'researchEntityId',
        relinkValue: 'canonical-entity',
        includeRelink: false,
      }),
    ).toEqual({
      archived: true,
      lastMaterializedAt: now,
    });
  });

  it('filters already-archived dependent rows before reference relinks for archive-aware collections', () => {
    const duplicateId = new mongoose.Types.ObjectId();

    expect(
      buildResearchEntityDedupeReferenceFilter({
        field: 'researchEntityId',
        duplicateIds: [duplicateId],
        archiveOnConflict: true,
      }),
    ).toEqual({
      archived: { $ne: true },
      researchEntityId: { $in: [duplicateId] },
    });

    expect(
      buildResearchEntityDedupeReferenceFilter({
        field: 'entityId',
        duplicateIds: [duplicateId],
        filter: { entityType: 'researchEntity' },
      }),
    ).toEqual({
      entityType: 'researchEntity',
      entityId: { $in: [duplicateId] },
    });
  });

  it('applies entity dedupe groups sequentially and stops after the first conflict', async () => {
    const started: string[] = [];

    await expect(
      applyResearchEntityPiDedupeGroupsSequentially(['first', 'second'], async (group) => {
        started.push(group);
        if (group === 'first') throw new Error('archive conflict');
        return { group };
      }),
    ).rejects.toThrow(/archive conflict/);

    expect(started).toEqual(['first']);
  });

  it('summarizes duplicate-entity review risk for dry-run artifacts', () => {
    expect(
      buildResearchEntityPiDedupeReviewBreakdown([
        {
          canonicalEntityId: 'canonical-profile',
          duplicateEntityIds: ['duplicate-profile'],
          canonicalSlug: 'dept-mcdb-casey-marin',
          duplicateSlugs: ['faculty-research-area-casey-marin'],
          mergedDepartments: ['Molecular, Cellular and Developmental Biology'],
          mergedResearchAreas: [],
        },
        {
          canonicalEntityId: 'canonical-grant',
          duplicateEntityIds: ['duplicate-grant'],
          canonicalSlug: 'dept-mcdb-jamie-award',
          duplicateSlugs: ['nsf-pi-jamie-award'],
          mergedDepartments: [
            'Molecular, Cellular and Developmental Biology',
            'Molecular, Cellular & Developmental Biology',
          ],
          mergedResearchAreas: [
            'microbiology',
            'biofilm research',
            'Chemical Synthesis and Characterization',
            'Asphalt Pavement Performance Evaluation',
            'Radioactive element chemistry and processing',
            'Extraction and Separation Processes',
          ],
        },
      ]),
    ).toMatchObject({
      totalGroups: 2,
      plannedDuplicateEntities: 2,
      reviewedProfileAreaGroups: 1,
      fundingSourceGroups: 1,
      crossDepartmentGroups: 1,
      groupsWithMergedResearchAreas: 1,
      highResearchAreaMergeGroups: 1,
      recommendedNarrowCommands: [
        'SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --reviewed-profile-area-only --limit=10000 --output /tmp/ylabs-research-entity-dedupe-reviewed-profile-area.json',
        'SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --funding-only --limit=10000 --output /tmp/ylabs-research-entity-dedupe-funding-only.json',
        'SCRAPER_ENV=beta yarn --cwd server research-entity:dedupe-by-pi --official-lab-url-only --limit=10000 --output /tmp/ylabs-research-entity-dedupe-official-lab-url.json',
      ],
    });
  });

  it('writes the research entity PI dedupe artifact when output is provided', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-entity-dedupe-'));
    const output = path.join(dir, 'entity-dedupe.json');
    const payload = buildResearchEntityPiDedupeOutput(
      { mode: 'dry-run', plannedGroups: 1, plannedDuplicateEntities: 2 },
      {
        environment: 'beta',
        db: 'Beta',
        options: parseResearchEntityPiDedupeArgs(['--output', output]),
      },
    );
    writeResearchEntityPiDedupeOutput(payload, output);

    expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toMatchObject({
      mode: 'dry-run',
      environment: 'beta',
      db: 'Beta',
      options: { apply: false, output },
      plannedGroups: 1,
      plannedDuplicateEntities: 2,
    });
    expect(() =>
      writeResearchEntityPiDedupeOutput(payload, '/var/tmp/entity-dedupe.json'),
    ).toThrow(/--output must write under/);
  });

  it('builds same-PI dedupe reviewer decision templates without enabling apply', () => {
    const template = buildResearchEntityPiDedupeDecisionTemplate(
      [
        {
          userId: 'user-1',
          normalizedName: 'same-pi:user-1',
          canonicalEntityId: 'canonical',
          duplicateEntityIds: ['duplicate-a', 'duplicate-b'],
          canonicalSlug: 'canonical-lab',
          duplicateSlugs: ['duplicate-a-lab', 'duplicate-b-lab'],
          mergedDepartments: ['Physics', 'Astronomy'],
          mergedResearchAreas: ['Cosmology'],
          mergedSourceUrls: ['https://example.edu/lab'],
        },
      ],
      '2026-05-31T12:00:00.000Z',
    );

    expect(template).toMatchObject({
      generatedAt: '2026-05-31T12:00:00.000Z',
      applyBlocked: false,
      acceptedDecisionValues: ['merge_into_canonical', 'mark_distinct_homes', 'defer_review'],
      decisions: [
        {
          planId: 'same-pi:user-1:canonical:duplicate-a,duplicate-b',
          canonicalEntityId: 'canonical',
          duplicateEntityIds: ['duplicate-a', 'duplicate-b'],
          canonicalSlug: 'canonical-lab',
          duplicateSlugs: ['duplicate-a-lab', 'duplicate-b-lab'],
          decision: '',
          reviewedBy: '',
          reviewNote: '',
        },
      ],
    });
    expect(() =>
      writeResearchEntityPiDedupeDecisionTemplate(
        template,
        '/var/tmp/entity-dedupe-template.json',
      ),
    ).toThrow(/--decision-template-output must write under/);
  });

  it('validates accepted same-PI dedupe decisions against generated plans', () => {
    const plans = [
      {
        userId: 'user-1',
        normalizedName: 'same-pi:user-1',
        canonicalEntityId: 'canonical',
        duplicateEntityIds: ['duplicate-a'],
        canonicalSlug: 'canonical-lab',
        duplicateSlugs: ['duplicate-a-lab'],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
      },
      {
        userId: 'user-2',
        normalizedName: 'same-pi:user-2',
        canonicalEntityId: 'second-canonical',
        duplicateEntityIds: ['second-duplicate'],
        canonicalSlug: 'second-canonical-lab',
        duplicateSlugs: ['second-duplicate-lab'],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
      },
    ];

    const validation = validateResearchEntityPiDedupeDecisions(
      plans,
      [
        {
          planId: 'same-pi:user-1:canonical:duplicate-a',
          decision: 'merge_into_canonical',
          canonicalEntityId: 'canonical',
          reviewedBy: 'Codex autonomous review',
        },
        {
          planId: 'same-pi:user-1:canonical:duplicate-a',
          decision: 'merge_into_canonical',
          canonicalEntityId: 'wrong-canonical',
        },
        {
          planId: 'missing-plan',
          decision: 'merge_into_canonical',
          canonicalEntityId: 'canonical',
        },
      ],
      '/tmp/accepted.json',
    );

    expect(validation).toMatchObject({
      artifactPath: '/tmp/accepted.json',
      applyBlocked: false,
      totalDecisions: 3,
      validDecisionCount: 0,
      invalidDecisionCount: 3,
      unmatchedPlanDecisionCount: 1,
      duplicatePlanDecisionCount: 1,
      unreviewedPlanCount: 2,
      decisionsByType: [{ decision: 'merge_into_canonical', count: 3 }],
    });
    expect(validation.decisions[0].errors).toContain(
      'Only one accepted decision is allowed per planId.',
    );
    expect(validation.decisions[1].errors).toContain(
      'A merge decision must use the generated canonicalEntityId.',
    );
    expect(validation.decisions[2].errors).toContain(
      'No generated same-PI dedupe plan matches this planId.',
    );
  });

  it('filters accepted same-PI decisions to valid merge plans before apply', () => {
    const plans = [
      {
        userId: 'user-1',
        normalizedName: 'same-pi:user-1',
        canonicalEntityId: 'canonical',
        duplicateEntityIds: ['duplicate-a'],
        canonicalSlug: 'canonical-lab',
        duplicateSlugs: ['duplicate-a-lab'],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
      },
      {
        userId: 'user-2',
        normalizedName: 'same-pi:user-2',
        canonicalEntityId: 'distinct-home',
        duplicateEntityIds: ['not-a-duplicate'],
        canonicalSlug: 'distinct-home-lab',
        duplicateSlugs: ['not-a-duplicate-lab'],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
      },
    ];

    const validation = validateResearchEntityPiDedupeDecisions(plans, [
      {
        planId: 'same-pi:user-1:canonical:duplicate-a',
        decision: 'merge_into_canonical',
        canonicalEntityId: 'canonical',
        reviewedBy: 'Codex autonomous review',
      },
      {
        planId: 'same-pi:user-2:distinct-home:not-a-duplicate',
        decision: 'mark_distinct_homes',
        reviewedBy: 'Codex autonomous review',
      },
    ]);

    expect(selectResearchEntityPiDedupePlansForAcceptedMergeApply(plans, validation)).toEqual([
      plans[0],
    ]);
  });

  it('allows missing same-PI dedupe accepted decision files only when explicitly requested', () => {
    const missing = path.join(os.tmpdir(), `missing-${Date.now()}.json`);
    expect(readResearchEntityPiDedupeDecisions(missing, { allowEmpty: true })).toEqual([]);
    expect(() => readResearchEntityPiDedupeDecisions(missing)).toThrow();
    expect(() =>
      readResearchEntityPiDedupeDecisions('/var/tmp/entity-dedupe-decisions.json', {
        allowEmpty: true,
      }),
    ).toThrow(/--accepted-decisions must write under/);
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
      confirmResearchEntityPiDedupe: false,
      deleteDuplicates: false,
      fundingOnly: true,
      fullPlan: false,
      officialLabUrlOnly: false,
      reviewedProfileAreaOnly: false,
      limit: 50,
      limitProvided: true,
      maxApply: 10,
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
