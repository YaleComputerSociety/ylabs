import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  buildFundingResearchEntityDedupePlan,
  buildMultiPersonEntityQuarantine,
  buildOfficialLabUrlResearchEntityDedupePlan,
  buildOrgNameResearchEntityDedupePlan,
  buildResearchEntityPiDedupePlan,
  buildSameNameDifferentPersonQuarantine,
  buildSharedPersonIdResearchEntityDedupePlan,
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

  it('carries NIH grant funding evidence from a merged PI-derived shell in the generic dedupe lane', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'fixture-quill-user',
        normalizedName: 'same-pi:fixture-quill-user',
        piFirstName: 'Nadia',
        piLastName: 'Quill',
        entities: [
          {
            id: 'nih-quill-shell',
            slug: 'nih-pi-nadia-quill',
            name: 'Nadia Quill Lab',
            sourceUrls: ['https://reporter.nih.gov/project-details/20000001'],
            recentGrantCount: 1,
            fundingAgencies: ['NIH'],
            recentGrants: [
              {
                id: '20000001',
                agency: 'NIH',
                title: 'Fixture Quill grant',
                startDate: '2023-01-01',
                url: 'https://reporter.nih.gov/project-details/20000001',
              },
            ],
          },
          {
            id: 'quill-faculty-home',
            slug: 'dept-cs-nadia-quill',
            name: 'Nadia Quill',
            kind: 'individual',
            entityType: 'FACULTY_RESEARCH_AREA',
            websiteUrl: 'https://cs.yale.edu/profile/nadia-quill/',
            sourceUrls: ['https://cs.yale.edu/profile/nadia-quill/'],
          },
        ],
      },
    ]);

    expect(plan).toMatchObject([
      {
        canonicalEntityId: 'quill-faculty-home',
        duplicateEntityIds: ['nih-quill-shell'],
        mergedRecentGrantCount: 1,
        mergedFundingAgencies: ['NIH'],
      },
    ]);
    expect(plan[0]?.mergedRecentGrants?.[0]).toMatchObject({ id: '20000001' });
  });

  describe('cross-cutting institute department graft corroboration (#734)', () => {
    it('strips an uncorroborated biomedical department seed grafted from a low-trust affiliate shell', () => {
      const plan = buildResearchEntityPiDedupePlan([
        {
          userId: 'fixture-ellis-user',
          normalizedName: 'same-pi:fixture-ellis-user',
          piFirstName: 'Jordan',
          piLastName: 'Ellis',
          entities: [
            {
              id: 'faculty-home',
              slug: 'dept-cs-jordan-ellis',
              name: 'Jordan Ellis',
              kind: 'individual',
              entityType: 'FACULTY_RESEARCH_AREA',
              websiteUrl: 'https://cs.yale.edu/ellis',
              sourceUrls: ['https://cs.yale.edu/ellis'],
              departments: ['Computer Science'],
              researchAreas: ['Computer Graphics', 'Geometric Learning'],
            },
            {
              id: 'institute-shell',
              slug: 'nsf-pi-jordan-ellis',
              name: 'Jordan Ellis Lab',
              kind: 'lab',
              entityType: 'LAB',
              sourceUrls: [
                'https://wti.yale.edu/humans/faculty',
                'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2500099',
              ],
              departments: [
                'Neuroscience',
                'Psychology',
                'Molecular, Cellular, and Developmental Biology',
              ],
            },
          ],
        },
      ]);

      expect(plan).toMatchObject([
        { canonicalEntityId: 'faculty-home', duplicateEntityIds: ['institute-shell'] },
      ]);
      expect(plan[0].mergedDepartments).toEqual(['Computer Science']);
    });

    it('keeps the biomedical department tuple when the merged researchAreas corroborate it', () => {
      const plan = buildResearchEntityPiDedupePlan([
        {
          userId: 'fixture-ellis-user',
          normalizedName: 'same-pi:fixture-ellis-user',
          piFirstName: 'Jordan',
          piLastName: 'Ellis',
          entities: [
            {
              id: 'faculty-home',
              slug: 'dept-cs-jordan-ellis',
              name: 'Jordan Ellis',
              kind: 'individual',
              entityType: 'FACULTY_RESEARCH_AREA',
              websiteUrl: 'https://cs.yale.edu/ellis',
              sourceUrls: ['https://cs.yale.edu/ellis'],
              departments: ['Computer Science'],
              researchAreas: ['Computer Graphics', 'Cognitive Neuroscience'],
            },
            {
              id: 'institute-shell',
              slug: 'nsf-pi-jordan-ellis',
              name: 'Jordan Ellis Lab',
              kind: 'lab',
              entityType: 'LAB',
              sourceUrls: [
                'https://wti.yale.edu/humans/faculty',
                'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2500099',
              ],
              departments: [
                'Neuroscience',
                'Psychology',
                'Molecular, Cellular, and Developmental Biology',
              ],
            },
          ],
        },
      ]);

      expect(plan[0].mergedDepartments).toEqual([
        'Computer Science',
        'Neuroscience',
        'Psychology',
        'Molecular, Cellular, and Developmental Biology',
      ]);
    });

    it('keeps the biomedical department tuple when a trusted, non-shell entity independently carries it', () => {
      const plan = buildResearchEntityPiDedupePlan([
        {
          userId: 'fixture-ellis-user',
          normalizedName: 'same-pi:fixture-ellis-user',
          piFirstName: 'Jordan',
          piLastName: 'Ellis',
          entities: [
            {
              id: 'faculty-home',
              slug: 'dept-neuro-jordan-ellis',
              name: 'Jordan Ellis',
              kind: 'individual',
              entityType: 'FACULTY_RESEARCH_AREA',
              websiteUrl: 'https://medicine.yale.edu/profile/jordan-ellis/',
              sourceUrls: ['https://medicine.yale.edu/profile/jordan-ellis/'],
              departments: [
                'Neuroscience',
                'Psychology',
                'Molecular, Cellular, and Developmental Biology',
              ],
              researchAreas: ['Statistics'],
            },
            {
              id: 'institute-shell',
              slug: 'nsf-pi-jordan-ellis',
              name: 'Jordan Ellis Lab',
              kind: 'lab',
              entityType: 'LAB',
              sourceUrls: ['https://wti.yale.edu/humans/faculty'],
              departments: ['Genetics'],
            },
          ],
        },
      ]);

      expect(plan[0].mergedDepartments).toEqual([
        'Neuroscience',
        'Psychology',
        'Molecular, Cellular, and Developmental Biology',
        'Genetics',
      ]);
    });

    it('never strips a lone member of the biomedical tuple when the other two never co-occur', () => {
      const plan = buildResearchEntityPiDedupePlan([
        {
          userId: 'fixture-ellis-user',
          normalizedName: 'same-pi:fixture-ellis-user',
          piFirstName: 'Jordan',
          piLastName: 'Ellis',
          entities: [
            {
              id: 'faculty-home',
              slug: 'dept-neuro-jordan-ellis',
              name: 'Jordan Ellis',
              kind: 'individual',
              entityType: 'FACULTY_RESEARCH_AREA',
              websiteUrl: 'https://medicine.yale.edu/profile/jordan-ellis/',
              sourceUrls: ['https://medicine.yale.edu/profile/jordan-ellis/'],
              departments: ['Neuroscience'],
              researchAreas: ['Statistics'],
            },
            {
              id: 'institute-shell',
              slug: 'nsf-pi-jordan-ellis',
              name: 'Jordan Ellis Lab',
              kind: 'lab',
              entityType: 'LAB',
              sourceUrls: ['https://wti.yale.edu/humans/faculty'],
              departments: ['Genetics'],
            },
          ],
        },
      ]);

      expect(plan[0].mergedDepartments).toEqual(['Neuroscience', 'Genetics']);
    });
  });

  it('keeps a real-website faculty home as canonical instead of archiving it into the PI-derived grant shell', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'fixture-fenwick-user',
        normalizedName: 'same-pi:fixture-fenwick-user',
        piFirstName: 'Robin',
        piLastName: 'Fenwick',
        entities: [
          {
            id: 'grant-shell',
            slug: 'nsf-pi-robin-fenwick',
            name: 'Robin Fenwick Lab',
            kind: 'lab',
            entityType: 'LAB',
            websiteUrl: 'https://efficient-computing.example.org/',
            sourceUrls: [
              'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2500001',
              'https://efficient-computing.example.org/',
            ],
          },
          {
            id: 'faculty-home',
            slug: 'dept-cs-robin-fenwick',
            name: 'Robin Fenwick',
            kind: 'individual',
            entityType: 'FACULTY_RESEARCH_AREA',
            websiteUrl: 'https://efficient-computing.example.org/',
            sourceUrls: [
              'https://efficient-computing.example.org/',
              'https://cs.yale.edu/profile/robin-fenwick/',
            ],
          },
        ],
      },
    ]);

    expect(plan).toMatchObject([
      { canonicalEntityId: 'faculty-home', duplicateEntityIds: ['grant-shell'] },
    ]);
    expect(plan.some((group) => group.duplicateEntityIds.includes('faculty-home'))).toBe(false);
  });

  it('carries the concrete website and name from a merged grant shell onto a canonical that lacks its own site', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'fixture-chen-user',
        normalizedName: 'same-pi:fixture-chen-user',
        piFirstName: 'Riley',
        piLastName: 'Chen',
        entities: [
          {
            id: 'dept-home',
            slug: 'dept-cs-riley-chen',
            name: 'Riley Chen Lab',
            kind: 'lab',
            entityType: 'LAB',
            sourceUrls: ['https://cs.yale.edu/profile/riley-chen/'],
          },
          {
            id: 'grant-shell',
            slug: 'nsf-pi-riley-chen',
            name: 'Riley Chen Lab',
            kind: 'lab',
            entityType: 'LAB',
            websiteUrl: 'https://chen-systems.example.org/',
            sourceUrls: [
              'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2500003',
              'https://chen-systems.example.org/',
            ],
          },
        ],
      },
    ]);

    expect(plan).toMatchObject([
      {
        canonicalEntityId: 'dept-home',
        duplicateEntityIds: ['grant-shell'],
        canonicalWebsiteUrl: 'https://chen-systems.example.org/',
        canonicalName: 'Riley Chen Lab',
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

  it('merges a RoleAssignment-corroborated surname-only lab with its own website into the same-PI funding shell (#1113)', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'townsend-person-id',
        normalizedName: 'same-pi:townsend-person-id',
        piFirstName: 'Jeffrey',
        piLastName: 'Townsend',
        entities: [
          {
            id: 'canonical-townsend',
            slug: 'ysm-townsend',
            name: 'Townsend Lab',
            websiteUrl: 'https://medicine.yale.edu/lab/townsend/',
            sourceUrls: ['https://medicine.yale.edu/lab/townsend/'],
            departments: ['Biostatistics'],
            kind: 'lab',
            entityType: 'LAB',
            piRoleCorroborated: true,
          },
          {
            id: 'funding-shell-townsend',
            slug: 'nsf-pi-67d8927f50621bcef434a16d',
            name: 'Jeffrey Townsend Lab',
            sourceUrls: ['https://reporter.nih.gov/project-details/10845546'],
            kind: 'lab',
            entityType: 'LAB',
            piRoleCorroborated: true,
          },
        ],
      },
    ]);

    expect(plan).toMatchObject([
      {
        canonicalEntityId: 'canonical-townsend',
        duplicateEntityIds: ['funding-shell-townsend'],
        canonicalSlug: 'ysm-townsend',
        duplicateSlugs: ['nsf-pi-67d8927f50621bcef434a16d'],
      },
    ]);
  });

  it('does not merge a surname-only lab with its own website when the person linkage is uncorroborated (#1113 guard)', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'name:townsend',
        normalizedName: 'name:townsend',
        piFirstName: 'Jeffrey',
        piLastName: 'Townsend',
        entities: [
          {
            id: 'canonical-townsend',
            slug: 'ysm-townsend',
            name: 'Townsend Lab',
            websiteUrl: 'https://medicine.yale.edu/lab/townsend/',
            sourceUrls: ['https://medicine.yale.edu/lab/townsend/'],
            departments: ['Biostatistics'],
            kind: 'lab',
            entityType: 'LAB',
          },
          {
            id: 'funding-shell-townsend',
            slug: 'nsf-pi-67d8927f50621bcef434a16d',
            name: 'Jeffrey Townsend Lab',
            sourceUrls: ['https://reporter.nih.gov/project-details/10845546'],
            kind: 'lab',
            entityType: 'LAB',
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

  it('folds a PI-named funding shell into a same-PI home whose own name is topical (#1113)', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'fixture-habit-lead-user',
        normalizedName: 'same-pi:fixture-habit-lead-user',
        piFirstName: 'Krysten',
        piLastName: 'Bold',
        entities: [
          {
            id: 'concrete-topical-home',
            slug: 'ysm-bold',
            name: 'HABIT Lab',
            websiteUrl: 'https://medicine.yale.edu/lab/bold/',
            sourceUrls: ['https://medicine.yale.edu/lab/bold/'],
            kind: 'lab',
            entityType: 'LAB',
          },
          {
            id: 'funding-name-shell',
            slug: 'nih-pi-krysten-bold',
            name: 'Krysten Bold Lab',
            websiteUrl: 'https://medicine.yale.edu/profile/krysten-bold/',
            sourceUrls: ['https://medicine.yale.edu/profile/krysten-bold/'],
            kind: 'lab',
            entityType: 'LAB',
          },
        ],
      },
    ]);

    expect(plan).toMatchObject([
      {
        dedupeCategory: 'profile_area_shell_with_concrete_home',
        canonicalEntityId: 'concrete-topical-home',
        duplicateEntityIds: ['funding-name-shell'],
        canonicalSlug: 'ysm-bold',
        duplicateSlugs: ['nih-pi-krysten-bold'],
      },
    ]);
  });

  it('never merges two same-PI entities that both carry their own concrete lab website (#1113)', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'fixture-fucito-lead-user',
        normalizedName: 'same-pi:fixture-fucito-lead-user',
        piFirstName: 'Fixture',
        piLastName: 'Fucito',
        entities: [
          {
            id: 'branded-home',
            slug: 'ysm-digital',
            name: 'DIGITAL Insights Lab',
            websiteUrl: 'https://medicine.yale.edu/lab/digital/',
            sourceUrls: ['https://medicine.yale.edu/lab/digital/'],
            kind: 'lab',
            entityType: 'LAB',
          },
          {
            id: 'surname-home',
            slug: 'ysm-fucito',
            name: 'Fucito Lab',
            websiteUrl: 'https://medicine.yale.edu/lab/fucito/',
            sourceUrls: ['https://medicine.yale.edu/lab/fucito/'],
            kind: 'lab',
            entityType: 'LAB',
          },
        ],
      },
    ]);

    expect(plan).toEqual([]);
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
            fullDescription:
              'Research fields include systems immunology, maternal-infant dyads, and vaccines.',
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

  it('does not graft wrong-domain research areas from a low-trust funding shell and repairs a hallucinated canonical description with a fuller correct sibling (The Faboratory)', () => {
    const plan = buildResearchEntityPiDedupePlan([
      {
        userId: 'fixture-kramer-bottiglio-user',
        normalizedName: 'same-pi:fixture-kramer-bottiglio-user',
        piFirstName: 'Rebecca',
        piLastName: 'Kramer-Bottiglio',
        entities: [
          {
            id: 'faboratory',
            slug: 'kramer-bottiglio-lab-rk673',
            name: 'Rebecca Kramer-Bottiglio Lab',
            kind: 'lab',
            entityType: 'LAB',
            websiteUrl: 'https://www.eng.yale.edu/faboratory/',
            sourceUrls: ['https://www.eng.yale.edu/faboratory/'],
            departments: ['Mechanical Engineering'],
            researchAreas: [
              'fabrication',
              'Manufacturing',
              'materials',
              'Robotics',
              'soft robotics',
            ],
            fullDescription:
              'The Rebecca Kramer-Bottiglio Lab focuses on research in Optical Network Technologies, Photonic and Optical Devices, and Semiconductor Lasers and Optical Devices.',
          },
          {
            id: 'nsf-shell',
            slug: 'nsf-pi-kramer-bottiglio',
            name: 'Rebecca Kramer-Bottiglio Lab',
            sourceUrls: ['https://www.nsf.gov/awardsearch/showAward?AWD_ID=2233445'],
            researchAreas: ['Optics', 'Photonics'],
          },
          {
            id: 'dept-home',
            slug: 'dept-seas-rebecca-kramer-bottiglio',
            name: 'Rebecca Kramer-Bottiglio',
            sourceUrls: ['https://seas.yale.edu/faculty/rebecca-kramer-bottiglio'],
            researchAreas: [
              'soft robotics',
              'multifunctional materials',
              'adaptive systems',
              'manufacturing techniques',
            ],
            fullDescription:
              'The Kramer-Bottiglio Lab designs soft, multifunctional robotic materials that merge structure and function, drawing on manufacturing techniques for adaptive systems that reconfigure their shape and stiffness on demand.',
          },
        ],
      },
    ]);

    expect(plan).toHaveLength(1);
    const group = plan[0];
    expect(group.canonicalEntityId).toBe('faboratory');
    expect([...group.duplicateEntityIds].sort()).toEqual(['dept-home', 'nsf-shell']);
    expect(group.mergedResearchAreas).not.toContain('Optics');
    expect(group.mergedResearchAreas).not.toContain('Photonics');
    expect(group.mergedResearchAreas).toEqual(
      expect.arrayContaining([
        'fabrication',
        'soft robotics',
        'multifunctional materials',
        'adaptive systems',
        'manufacturing techniques',
      ]),
    );
    expect(group.canonicalFullDescription).toContain('soft, multifunctional robotic materials');
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
      orgNameOnly: false,
      reviewedProfileAreaOnly: false,
      sharedPersonId: false,
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
      orgNameOnly: false,
      reviewedProfileAreaOnly: false,
      sharedPersonId: false,
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
      orgNameOnly: false,
      reviewedProfileAreaOnly: true,
      sharedPersonId: false,
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
      orgNameOnly: false,
      reviewedProfileAreaOnly: false,
      sharedPersonId: false,
      limit: 10000,
      limitProvided: false,
      maxApply: 10,
      slug: undefined,
    });
    const acceptedDecisionsPath = path.join(
      os.tmpdir(),
      'ylabs-research-entity-pi-dedupe-accepted-decisions.json',
    );
    const decisionTemplatePath = path.join(
      os.tmpdir(),
      'ylabs-research-entity-pi-dedupe-accepted-decisions-template.json',
    );
    const outputPath = path.join(os.tmpdir(), 'ylabs-research-entity-dedupe.json');
    expect(
      parseResearchEntityPiDedupeArgs([
        '--mode=dry-run',
        '--limit=250',
        '--max-apply=2',
        `--accepted-decisions=${acceptedDecisionsPath}`,
        '--allow-empty-decisions',
        '--decision-template-output',
        decisionTemplatePath,
        `--output=${outputPath}`,
      ]),
    ).toMatchObject({
      apply: false,
      limit: 250,
      limitProvided: true,
      maxApply: 2,
      acceptedDecisions: acceptedDecisionsPath,
      allowEmptyDecisions: true,
      decisionTemplateOutput: decisionTemplatePath,
      output: outputPath,
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
    expect(() => parseResearchEntityPiDedupeArgs(['--decision-template-output=--apply'])).toThrow(
      /--decision-template-output requires a path/,
    );
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
    expect(chooseArchivedDocumentConflictOutcome({ allowDeleteOnConflict: false })).toBe('blocked');
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
          canonicalName: 'Jamie Award Lab',
          canonicalWebsiteUrl: 'https://award-lab.example.org/',
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
      groupsCarryingCanonicalName: 1,
      groupsCarryingCanonicalWebsite: 1,
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
    expect(() => writeResearchEntityPiDedupeOutput(payload, '/var/tmp/entity-dedupe.json')).toThrow(
      /--output must write under/,
    );
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
      writeResearchEntityPiDedupeDecisionTemplate(template, '/var/tmp/entity-dedupe-template.json'),
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
      orgNameOnly: false,
      reviewedProfileAreaOnly: false,
      sharedPersonId: false,
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

describe('buildOrgNameResearchEntityDedupePlan', () => {
  it('merges same-name center twins into the members-rich survivor and carries the real website', () => {
    const plan = buildOrgNameResearchEntityDedupePlan([
      {
        id: 'center-synthetic-genome',
        slug: 'center-synthetic-genome',
        name: 'Yale Center for Synthetic Genome Analysis',
        entityType: 'CENTER',
        websiteUrl: '',
        sourceUrls: ['https://medicine.yale.edu/genetics/research/scga/people/'],
        departments: ['Genetics'],
        researchAreas: ['Genomics'],
        memberCount: 12,
      },
      {
        id: 'research-yale-synthetic-genome-shell',
        slug: 'research-yale-synthetic-genome-analysis',
        name: 'Yale Center for Synthetic Genome Analysis',
        entityType: 'CENTER',
        websiteUrl: 'https://syntheticgenome.yale.edu/',
        sourceUrls: ['https://syntheticgenome.yale.edu/'],
        departments: [],
        memberCount: 0,
      },
    ]);

    expect(plan).toHaveLength(1);
    expect(plan[0].canonicalEntityId).toBe('center-synthetic-genome');
    expect(plan[0].duplicateEntityIds).toEqual(['research-yale-synthetic-genome-shell']);
    expect(plan[0].canonicalWebsiteUrl).toBe('https://syntheticgenome.yale.edu/');
    expect(plan[0].mergedDepartments).toContain('Genetics');
  });

  it('does not merge two different centers that merely share a word', () => {
    expect(
      buildOrgNameResearchEntityDedupePlan([
        {
          id: 'keck-mass-spec',
          slug: 'yale-research-core-keck-mass-spectrometry',
          name: 'Keck Mass Spectrometry and Proteomics Resource',
          entityType: 'CORE_FACILITY',
          websiteUrl: 'https://keckmassspec.yale.edu/',
        },
        {
          id: 'keck-microarray',
          slug: 'yale-research-core-keck-microarray',
          name: 'Keck Microarray Shared Resource',
          entityType: 'CORE_FACILITY',
          websiteUrl: 'https://keckmicroarray.yale.edu/',
        },
      ]),
    ).toEqual([]);
  });

  it('does not merge two org entities that both carry an attached PI person lead', () => {
    expect(
      buildOrgNameResearchEntityDedupePlan([
        {
          id: 'org-led-by-director-a',
          slug: 'yse-climate-program-a',
          name: 'Yale Program on Synthetic Climate Communication',
          entityType: 'INITIATIVE',
          websiteUrl: 'https://environment.yale.edu/research/centers/synthetic-climate-a',
          hasAttachedPi: true,
        },
        {
          id: 'org-led-by-director-b',
          slug: 'yse-climate-program-b',
          name: 'Yale Program on Synthetic Climate Communication',
          entityType: 'INITIATIVE',
          websiteUrl: 'https://syntheticclimate.yale.edu/',
          hasAttachedPi: true,
        },
      ]),
    ).toEqual([]);
  });

  it('merges a person-derived entity misnamed as a program into its real program twin (#684)', () => {
    const plan = buildOrgNameResearchEntityDedupePlan([
      {
        id: 'org-program-home',
        slug: 'yse-climate-program',
        name: 'Yale Program on Synthetic Climate Communication (YPSCC)',
        entityType: 'PROGRAM',
        websiteUrl: 'https://environment.yale.edu/research/centers/synthetic-climate',
      },
      {
        id: 'person-mislabeled-as-program',
        slug: 'yse-faculty-synthetic-person',
        name: 'Yale Program on Synthetic Climate Communication',
        entityType: 'PROGRAM',
        websiteUrl: 'https://syntheticclimate.yale.edu/',
        hasAttachedPi: true,
      },
    ]);

    expect(plan).toHaveLength(1);
    expect(plan[0].canonicalEntityId).toBe('org-program-home');
    expect(plan[0].duplicateEntityIds).toEqual(['person-mislabeled-as-program']);
    expect(plan[0].canonicalWebsiteUrl).toBe('https://syntheticclimate.yale.edu/');
  });

  it('corroborates a single-significant-token name via a shared distinctive host', () => {
    const plan = buildOrgNameResearchEntityDedupePlan([
      {
        id: 'center-synthetic-quantum',
        slug: 'center-synthetic-quantum-institute',
        name: 'Yale Synthetic Institute',
        entityType: 'INSTITUTE',
        websiteUrl: '',
        sourceUrls: ['https://synthquantum.yale.edu/people/members'],
        memberCount: 20,
      },
      {
        id: 'shell-synthetic-quantum',
        slug: 'yale-research-center-synthetic-institute',
        name: 'Yale Synthetic Institute',
        entityType: 'INSTITUTE',
        websiteUrl: 'https://synthquantum.yale.edu/',
        sourceUrls: ['https://synthquantum.yale.edu/'],
        memberCount: 0,
      },
    ]);

    expect(plan).toHaveLength(1);
    expect(plan[0].canonicalEntityId).toBe('center-synthetic-quantum');
    expect(plan[0].duplicateEntityIds).toEqual(['shell-synthetic-quantum']);
    expect(plan[0].canonicalWebsiteUrl).toBe('https://synthquantum.yale.edu/');
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

  it('does not graft a funding shell wrong-domain research area onto the Yale-backed canonical', () => {
    const plan = buildFundingResearchEntityDedupePlan([
      {
        userId: 'name:fixture-optics-lab',
        normalizedName: 'fixture optics lab',
        piFirstName: 'Fixture',
        piLastName: 'Optics',
        entities: [
          {
            id: 'ysm-optics',
            slug: 'dept-seas-fixture-optics',
            name: 'Fixture Optics Lab',
            websiteUrl: 'https://seas.yale.edu/fixture-optics-lab/',
            sourceUrls: ['https://seas.yale.edu/fixture-optics-lab/'],
            researchAreas: ['soft robotics', 'materials'],
          },
          {
            id: 'nih-fixture-optics',
            slug: 'nih-pi-fixture-optics',
            name: 'Fixture Optics Lab',
            sourceUrls: ['https://reporter.nih.gov/project-details/1'],
            researchAreas: ['Optics', 'Photonics'],
          },
        ],
      },
    ]);

    expect(plan[0]?.mergedResearchAreas).toEqual(['soft robotics', 'materials']);
  });

  it('carries the fullest correct description from a trusted sibling and never from a longer low-trust funding shell', () => {
    const trustedSiblingDescription =
      'A fuller correct description of the soft-robotics research program grounded in the Yale lab site.';
    const hallucinatedShellDescription =
      'Optics and photonics hallucinated program that is wrong-domain filler. '.repeat(10);

    const plan = buildFundingResearchEntityDedupePlan([
      {
        userId: 'name:fixture-thin-canonical',
        normalizedName: 'fixture thin canonical lab',
        piFirstName: 'Fixture',
        piLastName: 'Thin',
        entities: [
          {
            id: 'ysm-thin',
            slug: 'dept-seas-fixture-thin',
            name: 'Fixture Thin Lab',
            websiteUrl: 'https://seas.yale.edu/fixture-thin-lab/',
            sourceUrls: [
              'https://seas.yale.edu/fixture-thin-lab/',
              'https://medicine.yale.edu/lab/fixture-thin/',
            ],
            fullDescription: 'Short thin blurb.',
          },
          {
            id: 'nih-fixture-thin',
            slug: 'nih-pi-fixture-thin',
            name: 'Fixture Thin Lab',
            sourceUrls: ['https://reporter.nih.gov/project-details/2'],
            fullDescription: hallucinatedShellDescription,
          },
          {
            id: 'seas-thin-detail',
            slug: 'dept-seas-fixture-thin-detail',
            name: 'Fixture Thin Lab',
            sourceUrls: ['https://medicine.yale.edu/profile/fixture-thin/'],
            fullDescription: trustedSiblingDescription,
          },
        ],
      },
    ]);

    expect(plan[0]?.canonicalEntityId).toBe('ysm-thin');
    expect(plan[0]?.canonicalFullDescription).toBe(trustedSiblingDescription);
    expect(plan[0]?.canonicalFullDescription).not.toContain('hallucinated');
  });

  it('carries recentGrants/recentGrantCount/fundingAgencies from a funding-only NIH shell onto the canonical entity', () => {
    const plan = buildFundingResearchEntityDedupePlan([
      {
        userId: 'name:fixture-oakley-lab',
        normalizedName: 'fixture oakley lab',
        entities: [
          {
            id: 'ysm-fixture-oakley',
            slug: 'ysm-fixture-oakley',
            name: 'Fixture Oakley Lab',
            websiteUrl: 'https://medicine.yale.edu/lab/fixture-oakley/',
            sourceUrls: ['https://medicine.yale.edu/lab/fixture-oakley/'],
            recentGrantCount: 1,
            fundingAgencies: ['NSF'],
            recentGrants: [
              { id: 'nsf-0000001', agency: 'NSF', title: 'Existing NSF award', startDate: '2024-01-01' },
            ],
          },
          {
            id: 'nih-fixture-oakley',
            slug: 'nih-pi-fixture-oakley',
            name: 'Fixture Oakley Lab',
            sourceUrls: [
              'https://reporter.nih.gov/project-details/10000001',
              'https://reporter.nih.gov/project-details/10000002',
            ],
            recentGrantCount: 2,
            fundingAgencies: ['NIH'],
            recentGrants: [
              {
                id: '10000001',
                agency: 'NIH',
                title: 'Fixture grant one',
                startDate: '2023-06-01',
                url: 'https://reporter.nih.gov/project-details/10000001',
              },
              {
                id: '10000002',
                agency: 'NIH',
                title: 'Fixture grant two',
                startDate: '2022-06-01',
                url: 'https://reporter.nih.gov/project-details/10000002',
              },
            ],
          },
        ],
      },
    ]);

    expect(plan[0]?.canonicalEntityId).toBe('ysm-fixture-oakley');
    expect(plan[0]?.duplicateEntityIds).toEqual(['nih-fixture-oakley']);
    expect(plan[0]?.mergedRecentGrantCount).toBe(3);
    expect(plan[0]?.mergedFundingAgencies).toEqual(['NSF', 'NIH']);
    expect((plan[0]?.mergedRecentGrants as Array<{ id: string }>).map((grant) => grant.id)).toEqual([
      'nsf-0000001',
      '10000001',
      '10000002',
    ]);
  });

  it('does not add merged grant fields when neither the canonical entity nor its duplicates carry grant data', () => {
    const plan = buildFundingResearchEntityDedupePlan([
      {
        userId: 'name:fixture-no-grants-lab',
        normalizedName: 'fixture no grants lab',
        entities: [
          {
            id: 'ysm-fixture-no-grants',
            slug: 'ysm-fixture-no-grants',
            name: 'Fixture No Grants Lab',
            websiteUrl: 'https://medicine.yale.edu/lab/fixture-no-grants/',
            sourceUrls: ['https://medicine.yale.edu/lab/fixture-no-grants/'],
          },
          {
            id: 'nih-fixture-no-grants',
            slug: 'nih-pi-fixture-no-grants',
            name: 'Fixture No Grants Lab',
            sourceUrls: ['https://reporter.nih.gov/project-details/1'],
          },
        ],
      },
    ]);

    expect(plan[0]?.mergedRecentGrants).toBeUndefined();
    expect(plan[0]?.mergedRecentGrantCount).toBeUndefined();
    expect(plan[0]?.mergedFundingAgencies).toBeUndefined();
  });
});

describe('shouldRetireDuplicateCurrentMembersForDedupeRun', () => {
  it('skips global current-member retirement in funding-only cleanup mode', () => {
    expect(shouldRetireDuplicateCurrentMembersForDedupeRun({ fundingOnly: true })).toBe(false);
    expect(shouldRetireDuplicateCurrentMembersForDedupeRun({ fundingOnly: false })).toBe(true);
  });
});

describe('buildSharedPersonIdResearchEntityDedupePlan', () => {
  it('merges same-person entities regardless of differing names and picks the human-readable canonical', () => {
    const rows = [
      {
        userId: 'person-1',
        normalizedName: 'same-pi:person-1',
        piFirstName: 'Sparkle',
        piLastName: 'Malone',
        entities: [
          {
            id: 'shell',
            slug: 'nsf-pi-abc123',
            name: 'Malone Disturbance Ecology Lab',
            websiteUrl: 'https://www.malonelab.org/',
            fullDescription: 'A'.repeat(528),
            sourceUrls: ['https://www.malonelab.org/'],
          },
          {
            id: 'named',
            slug: 'yse-faculty-sparkle-malone',
            name: 'Sparkle Malone Research',
            websiteUrl: 'https://malonelab.org/',
            fullDescription: 'B'.repeat(278),
            sourceUrls: ['https://malonelab.org/'],
          },
        ],
      },
    ];

    const plan = buildSharedPersonIdResearchEntityDedupePlan(rows);
    expect(plan).toHaveLength(1);
    const group = plan[0];
    expect(group.canonicalEntityId).toBe('named');
    expect(group.canonicalSlug).toBe('yse-faculty-sparkle-malone');
    expect(group.duplicateEntityIds).toEqual(['shell']);
    expect(group.dedupeCategory).toBe('shared_person_id');
    expect(group.canonicalFullDescription).toBeUndefined();
  });

  it('does not carry a description when the canonical already has the fullest one', () => {
    const rows = [
      {
        userId: 'person-2',
        normalizedName: 'same-pi:person-2',
        entities: [
          {
            id: 'rich',
            slug: 'ysm-crair',
            name: 'Crair Laboratory',
            fullDescription: 'A'.repeat(900),
          },
          {
            id: 'thin',
            slug: 'nih-pi-michael-crair',
            name: 'The Crair Laboratory',
            fullDescription: 'B'.repeat(200),
          },
        ],
      },
    ];

    const [group] = buildSharedPersonIdResearchEntityDedupePlan(rows);
    expect(group.canonicalEntityId).toBe('rich');
    expect(group.canonicalFullDescription).toBeUndefined();
  });

  it('never carries a longer low-trust shell description over a thin canonical, but does carry a fuller trusted sibling', () => {
    const trustedSiblingDescription =
      'A fuller correct account of the lab research program grounded in Yale sources.';
    const hallucinatedShellDescription =
      'Wrong-domain hallucinated optics and photonics filler description. '.repeat(12);

    const rows = [
      {
        userId: 'person-shell-guard',
        normalizedName: 'same-pi:person-shell-guard',
        entities: [
          {
            id: 'home',
            slug: 'ysm-fixture-home',
            name: 'Fixture Home Lab',
            websiteUrl: 'https://medicine.yale.edu/lab/fixture-home/',
            sourceUrls: ['https://medicine.yale.edu/lab/fixture-home/'],
            fullDescription: 'Short correct blurb.',
          },
          {
            id: 'shell',
            slug: 'nih-pi-fixture-home',
            name: 'Fixture Home Lab',
            sourceUrls: ['https://reporter.nih.gov/project-details/9'],
            fullDescription: hallucinatedShellDescription,
          },
          {
            id: 'sibling',
            slug: 'dept-seas-fixture-home',
            name: 'Fixture Home Lab',
            sourceUrls: ['https://seas.yale.edu/profile/fixture-home/'],
            fullDescription: trustedSiblingDescription,
          },
        ],
      },
    ];

    const [group] = buildSharedPersonIdResearchEntityDedupePlan(rows);
    expect(group.canonicalEntityId).toBe('home');
    expect(group.canonicalFullDescription).toBe(trustedSiblingDescription);
    expect(group.canonicalFullDescription).not.toContain('hallucinated');
  });

  it('produces no group for a lone-entity person row', () => {
    const rows = [
      {
        userId: 'person-3',
        normalizedName: 'same-pi:person-3',
        entities: [{ id: 'solo', slug: 'ysm-solo', name: 'Solo Lab' }],
      },
    ];
    expect(buildSharedPersonIdResearchEntityDedupePlan(rows)).toEqual([]);
  });

  it('excludes a co-PI entity claimed by two persons from every merge group', () => {
    const rows = [
      {
        userId: 'person-a',
        normalizedName: 'same-pi:person-a',
        entities: [
          { id: 'shared-shell', slug: 'nsf-pi-shared', name: 'Shared Grant Shell' },
          { id: 'a-home', slug: 'ysm-a-home', name: 'Person A Lab' },
        ],
      },
      {
        userId: 'person-b',
        normalizedName: 'same-pi:person-b',
        entities: [
          { id: 'shared-shell', slug: 'nsf-pi-shared', name: 'Shared Grant Shell' },
          { id: 'b-home', slug: 'ysm-b-home', name: 'Person B Lab' },
        ],
      },
    ];

    const plan = buildSharedPersonIdResearchEntityDedupePlan(rows);
    const allEntityIds = plan.flatMap((group) => [
      group.canonicalEntityId,
      ...group.duplicateEntityIds,
    ]);
    expect(allEntityIds).not.toContain('shared-shell');
    expect(plan).toEqual([]);
  });

  it('still merges a single-person two-entity row when no entity is shared', () => {
    const rows = [
      {
        userId: 'person-a',
        normalizedName: 'same-pi:person-a',
        entities: [
          { id: 'shared-shell', slug: 'nsf-pi-shared', name: 'Shared Grant Shell' },
          { id: 'a-home', slug: 'ysm-a-home', name: 'Person A Lab' },
          { id: 'a-second', slug: 'nih-pi-a', name: 'Person A Grant' },
        ],
      },
      {
        userId: 'person-b',
        normalizedName: 'same-pi:person-b',
        entities: [
          { id: 'shared-shell', slug: 'nsf-pi-shared', name: 'Shared Grant Shell' },
          { id: 'b-home', slug: 'ysm-b-home', name: 'Person B Lab' },
        ],
      },
    ];

    const plan = buildSharedPersonIdResearchEntityDedupePlan(rows);
    expect(plan).toHaveLength(1);
    expect(plan[0].userId).toBe('person-a');
    expect([plan[0].canonicalEntityId, ...plan[0].duplicateEntityIds].sort()).toEqual([
      'a-home',
      'a-second',
    ]);
    expect(plan[0].duplicateEntityIds).not.toContain('shared-shell');
  });
});

describe('buildMultiPersonEntityQuarantine', () => {
  it('reports each entity linked to more than one person with its distinct personIds', () => {
    const rows = [
      {
        userId: 'person-a',
        normalizedName: 'same-pi:person-a',
        entities: [
          { id: 'shared-shell', slug: 'nsf-pi-shared', name: 'Shared Grant Shell' },
          { id: 'a-home', slug: 'ysm-a-home', name: 'Person A Lab' },
        ],
      },
      {
        userId: 'person-b',
        normalizedName: 'same-pi:person-b',
        entities: [
          { id: 'shared-shell', slug: 'nsf-pi-shared', name: 'Shared Grant Shell' },
          { id: 'b-home', slug: 'ysm-b-home', name: 'Person B Lab' },
        ],
      },
    ];

    const quarantine = buildMultiPersonEntityQuarantine(rows);
    expect(quarantine).toHaveLength(1);
    expect(quarantine[0].id).toBe('shared-shell');
    expect(quarantine[0].slug).toBe('nsf-pi-shared');
    expect(new Set(quarantine[0].personIds)).toEqual(new Set(['person-a', 'person-b']));
  });

  it('does not flag entities that belong to a single person', () => {
    const rows = [
      {
        userId: 'person-a',
        normalizedName: 'same-pi:person-a',
        entities: [
          { id: 'a-home', slug: 'ysm-a-home', name: 'Person A Lab' },
          { id: 'a-second', slug: 'nih-pi-a', name: 'Person A Grant' },
        ],
      },
    ];
    expect(buildMultiPersonEntityQuarantine(rows)).toEqual([]);
  });
});

describe('buildSameNameDifferentPersonQuarantine', () => {
  it('flags same-normalized-name entities that belong to different persons', () => {
    const rows = [
      {
        userId: 'person-jun',
        normalizedName: 'same-pi:person-jun',
        entities: [{ id: 'jun', slug: 'ysm-jun-liu', name: 'The Liu Lab' }],
      },
      {
        userId: 'person-qiao',
        normalizedName: 'same-pi:person-qiao',
        entities: [{ id: 'qiao', slug: 'nih-pi-qiao-liu', name: 'The Liu Lab' }],
      },
    ];

    const quarantine = buildSameNameDifferentPersonQuarantine(rows);
    expect(quarantine).toHaveLength(1);
    expect(quarantine[0].normalizedName).toBe('the liu lab');
    expect(new Set(quarantine[0].entities.map((entity) => entity.personId))).toEqual(
      new Set(['person-jun', 'person-qiao']),
    );
  });

  it('does not flag same-name entities that belong to the same person', () => {
    const rows = [
      {
        userId: 'person-one',
        normalizedName: 'same-pi:person-one',
        entities: [
          { id: 'a', slug: 'dept-seas-diana-qiu', name: 'Diana Qiu Research' },
          { id: 'b', slug: 'dept-physics-diana-qiu', name: 'Diana Qiu Research' },
        ],
      },
    ];
    expect(buildSameNameDifferentPersonQuarantine(rows)).toEqual([]);
  });
});
