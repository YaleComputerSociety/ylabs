import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queueFind: vi.fn(),
  queueCountDocuments: vi.fn(),
}));

vi.mock('../../models/visibilityReleaseQueueItem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/visibilityReleaseQueueItem')>()),
  VisibilityReleaseQueueItem: {
    find: mocks.queueFind,
    countDocuments: mocks.queueCountDocuments,
  },
}));

import {
  buildStudentVisibilityGateApplyOps,
  evaluateStudentVisibilityGateLeadResolution,
  isProfileAreaDuplicateCounterpart,
  isBlockingVisibilityReason,
  isStudentVisibilityGatePlanMateriallyChanged,
  normalizeStudentVisibilityGateObjectId,
  reachOutPlausibleSignalCreditsActionEvidence,
  researchEntityGateProjection,
  RESEARCH_HOME_URL_INDEX_AUTHORITY_SOURCE_NAMES,
  runStudentVisibilityGateForPlans,
  selectDuplicateGroupSurvivorEntityIds,
  selectExactUrlDuplicateRiskEntityIds,
  type StudentVisibilityGatePlan,
} from '../studentVisibilityGateService';
import { sourceCoverageRegistry } from '../../scrapers/sourceCoverageRegistry';
import { computeResearchEntityStudentVisibility } from '../studentVisibilityTier';
import { ORGANIZATIONAL_HOME_WAYS_IN_DERIVATION_KEY } from '../accessAcceptanceLevel';

const safePlan = (
  overrides: Partial<StudentVisibilityGatePlan> = {},
): StudentVisibilityGatePlan => ({
  collection: 'research',
  recordId: 'entity-safe',
  label: 'Safe Lab',
  currentTier: 'operator_review',
  computedTier: 'student_ready',
  tier: 'student_ready',
  reasons: ['source_backed_description', 'concrete_next_step'],
  sourceNames: ['department-undergrad-research'],
  nextRepairAction: 'Operator review.',
  ...overrides,
});

const heldPlan = (
  overrides: Partial<StudentVisibilityGatePlan> = {},
): StudentVisibilityGatePlan => ({
  collection: 'research',
  recordId: 'entity-held',
  label: 'Held Lab',
  currentTier: 'operator_review',
  computedTier: 'operator_review',
  tier: 'operator_review',
  reasons: ['missing_description', 'missing_action_evidence', 'concrete_next_step'],
  sourceNames: ['ysm-atoz-index'],
  nextRepairAction: 'Backfill a source-backed research description.',
  ...overrides,
});

describe('studentVisibilityGateService', () => {
  it('normalizes gate ObjectIds without object-shaped coercion', () => {
    expect(normalizeStudentVisibilityGateObjectId(' 507f1f77bcf86cd799439011 ')).toBe(
      '507f1f77bcf86cd799439011',
    );
    expect(normalizeStudentVisibilityGateObjectId('entity-safe')).toBeUndefined();
    expect(
      normalizeStudentVisibilityGateObjectId({
        toString: () => '507f1f77bcf86cd799439011',
      }),
    ).toBeUndefined();
  });

  it('loads public description and override fields when planning research entity gates', () => {
    expect(researchEntityGateProjection.split(/\s+/)).toEqual(
      expect.arrayContaining([
        'shortDescription',
        'fullDescription',
        'profileSynthesisDescription',
        'descriptionSource',
        'studentVisibilityOverrideTier',
      ]),
    );
    expect(researchEntityGateProjection.split(/\s+/)).not.toContain('description');
  });

  it('loads the yale-status signal so a departed lead is not silently rescored as visible', () => {
    // #1620 residual: computeResearchEntityStudentVisibility's inactive_at_yale
    // branch reads entity.activeAtYaleCache, but this projection omitted the
    // field, so every gate-rescored entity saw activeAtYaleCache===undefined
    // and a departed/emeritus PI's row could flip back to student_ready.
    expect(researchEntityGateProjection.split(/\s+/)).toEqual(
      expect.arrayContaining(['activeAtYaleCache', 'yaleStatusCache']),
    );
  });

  it('does not treat center directorships as profile-area duplicate counterparts', () => {
    expect(
      isProfileAreaDuplicateCounterpart(
        {
          kind: 'center',
          entityType: 'CENTER',
        },
        {
          role: 'director',
        },
      ),
    ).toBe(false);

    expect(
      isProfileAreaDuplicateCounterpart(
        {
          kind: 'lab',
          entityType: 'LAB',
        },
        {
          role: 'pi',
        },
      ),
    ).toBe(true);
  });

  describe('duplicate-group survivor release (#1890)', () => {
    const jointAppointmentPair = [
      {
        _id: 'dept-a-member',
        slug: 'dept-a-professor',
        name: 'A Professor Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        studentVisibilityTier: 'suppressed',
        websiteUrl: 'https://aprofessor.github.io/',
        fullDescription:
          'Trade, development, and firm-level productivity research spanning several Yale departments.',
      },
      {
        _id: 'dept-b-member',
        slug: 'dept-b-professor',
        name: 'A Professor Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        studentVisibilityTier: 'operator_review',
        websiteUrl: 'https://aprofessor.github.io/',
      },
    ];

    it('releases the best member when every member of a duplicate group is called a duplicate', () => {
      const survivors = selectDuplicateGroupSurvivorEntityIds({
        entities: jointAppointmentPair,
        duplicateRiskEntityIds: new Set(['dept-a-member', 'dept-b-member']),
      });

      expect([...survivors]).toEqual(['dept-a-member']);
    });

    it('releases nobody while the group still has a member no selector calls a duplicate', () => {
      const survivors = selectDuplicateGroupSurvivorEntityIds({
        entities: jointAppointmentPair,
        duplicateRiskEntityIds: new Set(['dept-a-member']),
      });

      expect([...survivors]).toEqual([]);
    });

    it('does not release a member whose other duplicate group already has a survivor', () => {
      const survivors = selectDuplicateGroupSurvivorEntityIds({
        entities: [
          ...jointAppointmentPair,
          {
            _id: 'shared-lab-member',
            slug: 'shared-lab',
            name: 'A Professor Lab',
            entityType: 'LAB',
            studentVisibilityTier: 'student_ready',
            websiteUrl: 'https://aprofessor.github.io/',
            sourceUrls: ['https://aprofessorlab.org/team'],
          },
        ],
        duplicateRiskEntityIds: new Set(['dept-a-member', 'dept-b-member']),
      });

      expect([...survivors]).toEqual([]);
    });

    it('releases nobody when a row two shared urls away already serves', () => {
      const survivors = selectDuplicateGroupSurvivorEntityIds({
        entities: [
          {
            _id: 'two-group-member',
            slug: 'a-dept-professor',
            name: 'A Professor Faculty Research',
            entityType: 'FACULTY_RESEARCH_AREA',
            fullDescription:
              'Trade, development, and firm-level productivity research spanning several Yale departments.',
            sourceUrls: ['https://aprofessor.github.io/', 'https://aprofessorlab.org/research'],
          },
          {
            _id: 'dark-group-partner',
            slug: 'b-dept-professor',
            name: 'A Professor Faculty Research',
            entityType: 'FACULTY_RESEARCH_AREA',
            sourceUrls: ['https://aprofessor.github.io/'],
          },
          {
            _id: 'serving-lab',
            slug: 'aprofessor-lab',
            name: 'A Professor Lab',
            entityType: 'FACULTY_RESEARCH_AREA',
            studentVisibilityTier: 'student_ready',
            sourceUrls: ['https://aprofessorlab.org/research'],
          },
        ],
        duplicateRiskEntityIds: new Set(['two-group-member', 'dark-group-partner']),
      });

      expect([...survivors]).toEqual([]);
    });

    it('releases nobody when the same-pi canonical the hold defers to already serves', () => {
      const survivors = selectDuplicateGroupSurvivorEntityIds({
        entities: [
          {
            _id: 'same-pi-held-shell',
            slug: 'a-dept-professor',
            name: 'A Professor Faculty Research',
            entityType: 'FACULTY_RESEARCH_AREA',
            fullDescription:
              'Trade, development, and firm-level productivity research spanning several Yale departments.',
            websiteUrl: 'https://aprofessor.github.io/profile',
          },
          {
            _id: 'url-held-shell',
            slug: 'b-dept-professor',
            name: 'A Professor Faculty Research',
            entityType: 'FACULTY_RESEARCH_AREA',
            sourceUrls: ['https://aprofessor.github.io/profile'],
          },
          {
            _id: 'serving-lab',
            slug: 'aprofessor-lab',
            name: 'A Professor Lab',
            entityType: 'LAB',
            studentVisibilityTier: 'student_ready',
            websiteUrl: 'https://aprofessorlab.org/research',
          },
        ],
        duplicateRelationGroups: [['serving-lab', 'same-pi-held-shell']],
        duplicateRiskEntityIds: new Set(['same-pi-held-shell', 'url-held-shell']),
      });

      expect([...survivors]).toEqual([]);
    });

    it('leaves a cluster no shared url joins to the relation that owns it', () => {
      const survivors = selectDuplicateGroupSurvivorEntityIds({
        entities: [
          {
            _id: 'same-pi-canonical',
            slug: 'aprofessor-lab',
            name: 'A Professor Lab',
            entityType: 'LAB',
            websiteUrl: 'https://aprofessorlab.org/research',
          },
          {
            _id: 'same-pi-shell',
            slug: 'a-dept-professor',
            name: 'A Professor Faculty Research',
            entityType: 'FACULTY_RESEARCH_AREA',
            websiteUrl: 'https://anotherprofessor.github.io/',
          },
        ],
        duplicateRelationGroups: [['same-pi-canonical', 'same-pi-shell']],
        duplicateRiskEntityIds: new Set(['same-pi-canonical', 'same-pi-shell']),
      });

      expect([...survivors]).toEqual([]);
    });

    it('spends the release on a member that can attach a lead', () => {
      const survivors = selectDuplicateGroupSurvivorEntityIds({
        entities: [
          {
            _id: 'long-body-no-lead',
            slug: 'a-dept-professor',
            name: 'A Professor Faculty Research',
            entityType: 'FACULTY_RESEARCH_AREA',
            fullDescription:
              'Trade, development, and firm-level productivity research spanning several Yale departments.',
            websiteUrl: 'https://aprofessor.github.io/profile',
          },
          {
            _id: 'lead-attached',
            slug: 'b-dept-professor',
            name: 'A Professor Faculty Research',
            entityType: 'FACULTY_RESEARCH_AREA',
            sourceUrls: ['https://aprofessor.github.io/profile'],
          },
        ],
        leadRows: [{ researchEntityId: 'lead-attached', role: 'pi' }],
        duplicateRiskEntityIds: new Set(['long-body-no-lead', 'lead-attached']),
      });

      expect([...survivors]).toEqual(['lead-attached']);
    });

    it('serves the shared address from the row a research-home index says owns it', () => {
      const survivors = selectDuplicateGroupSurvivorEntityIds({
        entities: [
          {
            _id: 'index-published-home',
            slug: 'aprofessor-lab',
            name: 'A Professor Lab',
            entityType: 'LAB',
            websiteUrl: 'https://aprofessorlab.org/research',
            fieldProvenance: { websiteUrl: { sourceName: 'ysm-atoz-index' } },
          },
          {
            _id: 'richer-text-partner',
            slug: 'bprofessor-lab',
            name: 'B Professor Lab',
            entityType: 'LAB',
            websiteUrl: 'https://aprofessorlab.org/research',
            shortDescription: 'Studies estuary nitrogen cycling across Long Island Sound.',
            fullDescription:
              'Trade, development, and firm-level productivity research spanning several Yale departments.',
          },
        ],
        leadRows: [
          { researchEntityId: 'index-published-home', role: 'pi' },
          { researchEntityId: 'richer-text-partner', role: 'pi' },
        ],
        duplicateRiskEntityIds: new Set(['index-published-home', 'richer-text-partner']),
      });

      expect([...survivors]).toEqual(['index-published-home']);
    });

    it('releases the same single member however the corpus happens to be ordered', () => {
      const overlappingGroups = [
        {
          _id: 'shared-by-both',
          slug: 'a-dept-professor',
          name: 'A Professor Faculty Research',
          entityType: 'FACULTY_RESEARCH_AREA',
          fullDescription:
            'Trade, development, and firm-level productivity research spanning several Yale departments.',
          sourceUrls: [
            'https://aprofessor.github.io/profile',
            'https://aprofessorlab.org/research',
          ],
        },
        {
          _id: 'first-group-partner',
          slug: 'b-dept-professor',
          name: 'A Professor Faculty Research',
          entityType: 'FACULTY_RESEARCH_AREA',
          sourceUrls: ['https://aprofessor.github.io/profile'],
        },
        {
          _id: 'second-group-partner',
          slug: 'c-dept-professor',
          name: 'A Professor Faculty Research',
          entityType: 'FACULTY_RESEARCH_AREA',
          sourceUrls: ['https://aprofessorlab.org/research'],
        },
      ];
      const duplicateRiskEntityIds = new Set([
        'shared-by-both',
        'first-group-partner',
        'second-group-partner',
      ]);

      const survivors = selectDuplicateGroupSurvivorEntityIds({
        entities: overlappingGroups,
        duplicateRiskEntityIds,
      });
      const reversedSurvivors = selectDuplicateGroupSurvivorEntityIds({
        entities: [...overlappingGroups].reverse(),
        duplicateRiskEntityIds,
      });

      expect([...survivors]).toEqual(['shared-by-both']);
      expect([...reversedSurvivors]).toEqual(['shared-by-both']);
    });

    it('counts a row citing one destination under two spellings once against the group limit', () => {
      const aliasingCanonical = {
        _id: 'canonical-with-aliasing-citations',
        slug: 'a-canonical-lab',
        name: 'A Professor Lab',
        entityType: 'LAB',
        fullDescription:
          'Trade, development, and firm-level productivity research spanning several Yale departments.',
        websiteUrl: 'http://aprofessorlab.org/research/index.html',
        sourceUrls: ['https://aprofessorlab.org/research/'],
      };
      const shells = ['b', 'c', 'd', 'e'].map((letter) => ({
        _id: `${letter}-shell`,
        slug: `${letter}-dept-professor`,
        name: 'A Professor Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrls: ['https://aprofessorlab.org/research'],
      }));

      const ids = selectExactUrlDuplicateRiskEntityIds([aliasingCanonical, ...shells]);

      expect([...ids].sort()).toEqual(['b-shell', 'c-shell', 'd-shell', 'e-shell']);
    });
  });

  it('marks exact own-site duplicate shells while preserving the stronger canonical profile', () => {
    const ids = selectExactUrlDuplicateRiskEntityIds(
      [
        {
          _id: 'canonical-gerow',
          slug: 'gerow-aag44',
          name: 'Aaron Gerow — Research',
          entityType: 'INDIVIDUAL_RESEARCH',
          studentVisibilityTier: 'student_ready',
          fullDescription:
            'Research on Japanese cinema, media studies, cultural history, and archival humanities methods at Yale.',
          shortDescription: 'Studies Japanese cinema, media, and cultural history.',
          sourceUrls: ['http://www.aarongerow.com/'],
        },
        {
          _id: 'duplicate-gerow',
          slug: 'dept-eall-aaron-gerow',
          name: 'Aaron Gerow Faculty Research',
          entityType: 'FACULTY_RESEARCH_AREA',
          studentVisibilityTier: 'operator_review',
          websiteUrl: 'http://www.aarongerow.com/',
          sourceUrls: ['https://eall.yale.edu/people/professors'],
        },
      ],
      [{ researchEntityId: 'canonical-gerow', userId: 'user-gerow' }],
    );

    expect([...ids]).toEqual(['duplicate-gerow']);
  });

  describe('a citation is not a claim to be the page (#1896)', () => {
    const owner = {
      _id: 'owner-lab',
      slug: 'ysm-quimby',
      name: 'Quimby Lab',
      entityType: 'LAB',
      kind: 'lab',
      studentVisibilityTier: 'suppressed',
      fullDescription:
        'Neonatal care quality improvement across community hospital nurseries, with implementation trials of standardized resuscitation protocols.',
      shortDescription: 'Studies neonatal care quality improvement in community nurseries.',
      websiteUrl: 'https://medicine.yale.edu/lab/quimby/',
    };
    const citingRow = (overrides: Record<string, unknown> = {}) => ({
      _id: 'citing-row',
      slug: 'nih-pi-someone-else',
      name: 'Someone Else Lab',
      entityType: 'LAB',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      fullDescription:
        'Airway inflammation and macrophage biology in chronic obstructive pulmonary disease cohorts.',
      shortDescription: 'Studies airway inflammation and macrophage biology.',
      websiteUrl: 'https://pulmonary.example.edu/someone-else/',
      sourceUrls: ['https://medicine.yale.edu/lab/quimby/'],
      ...overrides,
    });

    it('stops an unprovenanced citation suppressing the row that publishes the address', () => {
      expect([
        ...selectExactUrlDuplicateRiskEntityIds(
          [owner, citingRow()],
          [{ researchEntityId: 'citing-row', userId: 'user-else' }],
        ),
      ]).toEqual([]);
    });

    it('still holds the loser when the citing row serves a field provenanced to that page', () => {
      const provenanced = citingRow({
        fieldProvenance: {
          fullDescription: { sourceUrl: 'https://medicine.yale.edu/lab/quimby/' },
        },
      });
      expect([
        ...selectExactUrlDuplicateRiskEntityIds(
          [owner, provenanced],
          [{ researchEntityId: 'citing-row', userId: 'user-else' }],
        ),
      ]).toEqual(['owner-lab']);
    });

    it('keeps a row with no research home of its own in the group, since it may BE the site', () => {
      const homeless = citingRow({ _id: 'homeless-row', slug: 'dept-a-person' });
      delete (homeless as Record<string, unknown>).websiteUrl;
      expect([...selectExactUrlDuplicateRiskEntityIds([owner, homeless])]).toEqual(['owner-lab']);
    });

    it('keeps a row whose own websiteUrl is a roster index, which is no home of its own', () => {
      const rosterHomed = citingRow({
        _id: 'roster-homed-row',
        slug: 'dept-a-person',
        websiteUrl: 'https://medicine.yale.edu/labs/',
      });
      expect([...selectExactUrlDuplicateRiskEntityIds([owner, rosterHomed])]).toEqual([
        'owner-lab',
      ]);
    });

    it('keeps an index-published owner that cites its own lab under the other spelling', () => {
      const indexOwner = {
        _id: 'index-owner',
        slug: 'ysm-liu',
        name: 'The Liu Lab',
        entityType: 'LAB',
        kind: 'lab',
        studentVisibilityTier: 'student_ready',
        fullDescription:
          'High-throughput cryo-electron tomography of bacterial motility machines and secretion systems.',
        shortDescription: 'Studies bacterial motility machines by cryo-electron tomography.',
        websiteUrl: 'https://medicine.yale.edu/lab/jun-liu/',
        sourceUrls: ['https://medicine.yale.edu/lab/jun_liu/'],
        fieldProvenance: { websiteUrl: { sourceName: 'ysm-atoz-index' } },
      };
      const borrowerOfThatLab = {
        _id: 'borrower-row',
        slug: 'dept-mbb-someone-else',
        name: 'Someone Else Lab',
        entityType: 'LAB',
        kind: 'lab',
        studentVisibilityTier: 'suppressed',
        fullDescription:
          'Electron transport in anaerobic bacteria, bacterial nanowires, and adhesion in biofilm communities.',
        shortDescription: 'Studies electron transport and adhesion in anaerobic bacteria.',
        websiteUrl: 'https://medicine.yale.edu/lab/jun_liu/',
        sourceUrls: ['https://medicine.yale.edu/profile/someone-else/'],
        fieldProvenance: { websiteUrl: { sourceName: 'dept-faculty-roster' } },
      };
      expect([...selectExactUrlDuplicateRiskEntityIds([indexOwner, borrowerOfThatLab])]).toEqual([
        'borrower-row',
      ]);
    });

    it('keeps both halves of a mutual citation, where each row claims the other address', () => {
      const labAddressRow = {
        _id: 'lab-address-row',
        slug: 'ysm-deng',
        name: 'Deng Lab',
        entityType: 'LAB',
        kind: 'lab',
        studentVisibilityTier: 'suppressed',
        fullDescription:
          'Radiation therapy physics, treatment planning optimization, and dosimetry for clinical oncology.',
        shortDescription: 'Studies radiation therapy physics and treatment planning.',
        websiteUrl: 'https://medicine.yale.edu/lab/deng/',
        sourceUrls: ['https://medicine.yale.edu/profile/jun-deng/'],
      };
      const profileAddressRow = {
        _id: 'profile-address-row',
        slug: 'ysm-faculty-jun-deng',
        name: 'Jun Deng Lab',
        entityType: 'LAB',
        kind: 'lab',
        studentVisibilityTier: 'student_ready',
        fullDescription:
          'Radiation therapy physics, treatment planning optimization, and dosimetry for clinical oncology.',
        shortDescription: 'Studies radiation therapy physics and treatment planning.',
        websiteUrl: 'https://medicine.yale.edu/profile/jun-deng/',
        sourceUrls: ['https://medicine.yale.edu/lab/deng/'],
      };
      expect(
        [...selectExactUrlDuplicateRiskEntityIds([labAddressRow, profileAddressRow])].length,
      ).toBe(1);
    });

    it('leaves a group nobody publishes as its own home exactly as it was', () => {
      const oneCiter = citingRow({
        _id: 'citer-one',
        slug: 'dept-a-person',
        websiteUrl: 'https://pulmonary.example.edu/one-citer/',
      });
      const otherCiter = citingRow({
        _id: 'citer-two',
        slug: 'dept-b-person',
        studentVisibilityTier: 'suppressed',
        websiteUrl: 'https://immunology.example.edu/other-citer/',
      });
      expect([...selectExactUrlDuplicateRiskEntityIds([oneCiter, otherCiter])]).toEqual([
        'citer-two',
      ]);
    });
  });

  it('makes the lab index-published owner canonical over an already-public borrower', () => {
    const labIndexOwner = {
      _id: 'atoz-rothman',
      slug: 'ysm-rothman',
      name: 'Rothman Lab',
      entityType: 'LAB',
      kind: 'lab',
      studentVisibilityTier: 'suppressed',
      websiteUrl: 'https://medicine.yale.edu/lab/rothman/',
      fieldProvenance: { websiteUrl: { sourceName: 'ysm-atoz-index' } },
    };
    const profileBorrower = {
      _id: 'directory-member',
      slug: 'ysm-faculty-member',
      name: 'Member Lab',
      entityType: 'LAB',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      fullDescription:
        'Structural studies of membrane fusion machinery, vesicle trafficking, and secretory pathway regulation.',
      shortDescription: 'Studies membrane fusion and vesicle trafficking mechanisms.',
      websiteUrl: 'https://medicine.yale.edu/lab/rothman/index.aspx',
      fieldProvenance: { websiteUrl: { sourceName: 'ysm-faculty-directory' } },
    };

    expect([
      ...selectExactUrlDuplicateRiskEntityIds(
        [labIndexOwner, profileBorrower],
        [{ researchEntityId: 'directory-member', userId: 'user-member' }],
      ),
    ]).toEqual(['directory-member']);

    // Negative twin: with the same shapes but no index authority, the 80-point
    // already-public term decides and the borrower keeps the canonical slot.
    expect([
      ...selectExactUrlDuplicateRiskEntityIds(
        [
          {
            ...labIndexOwner,
            fieldProvenance: { websiteUrl: { sourceName: 'dept-faculty-roster' } },
          },
          profileBorrower,
        ],
        [{ researchEntityId: 'directory-member', userId: 'user-member' }],
      ),
    ]).toEqual(['atoz-rothman']);
  });

  it('gives a pair colliding on two urls back one card through the cluster release, not through immunity', () => {
    const labIndexOwner = {
      _id: 'atoz-owner',
      slug: 'ysm-owner',
      name: 'Owner Lab',
      entityType: 'LAB',
      kind: 'lab',
      studentVisibilityTier: 'suppressed',
      websiteUrl: 'https://medicine.yale.edu/lab/owner/',
      sourceUrls: ['https://medicine.yale.edu/profile/an-owner/'],
      fieldProvenance: { websiteUrl: { sourceName: 'ysm-atoz-index' } },
    };
    const directoryDuplicate = {
      _id: 'directory-owner',
      slug: 'ysm-faculty-an-owner',
      name: 'Owner Lab',
      entityType: 'LAB',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      fullDescription:
        'Radiation dosimetry, treatment planning optimization, and artificial intelligence applied to radiotherapy.',
      shortDescription: 'Studies radiation dosimetry and treatment planning.',
      websiteUrl: 'https://medicine.yale.edu/lab/owner/index.aspx',
      sourceUrls: ['https://medicine.yale.edu/profile/an-owner/'],
      fieldProvenance: { websiteUrl: { sourceName: 'ysm-faculty-directory' } },
    };
    const leadRows = [
      { researchEntityId: 'directory-owner', userId: 'user-owner' },
      { researchEntityId: 'atoz-owner', userId: 'user-owner' },
    ];

    // Each row loses one of the two groups, so both are called duplicates. Immunity
    // for the index-published row would have served a student two cards wherever the
    // OTHER group's canonical was already public (#2970).
    const duplicateRiskEntityIds = selectExactUrlDuplicateRiskEntityIds(
      [labIndexOwner, directoryDuplicate],
      leadRows,
    );
    expect([...duplicateRiskEntityIds].sort()).toEqual(['atoz-owner', 'directory-owner']);

    // The cluster release is what keeps the home visible, and it spends the release
    // on the row whose address the index published.
    expect([
      ...selectDuplicateGroupSurvivorEntityIds({
        entities: [labIndexOwner, directoryDuplicate],
        leadRows,
        duplicateRiskEntityIds,
      }),
    ]).toEqual(['atoz-owner']);
  });

  it('calls an address-authority row a duplicate in a group formed by a url it does not own', () => {
    const otherLabsOwner = {
      _id: 'atoz-other',
      slug: 'ysm-other',
      name: 'Other Lab',
      entityType: 'LAB',
      kind: 'lab',
      studentVisibilityTier: 'suppressed',
      shortDescription: 'Studies coastal sediment transport across restored tidal wetlands.',
      websiteUrl: 'https://medicine.yale.edu/lab/other/',
      sourceUrls: ['https://sharedcenter.example.org/research'],
      fieldProvenance: {
        websiteUrl: { sourceName: 'ysm-atoz-index' },
        // Serving a field harvested from the shared page is what makes this row a
        // candidate to BE it, so the group is a real ownership contest rather than a
        // bare citation the #1896 reader drop removes.
        shortDescription: {
          sourceName: 'ysm-center',
          sourceUrl: 'https://sharedcenter.example.org/research',
        },
      },
    };
    const unrelatedServingLab = {
      _id: 'serving-unrelated',
      slug: 'ysm-unrelated',
      name: 'Unrelated Lab',
      entityType: 'LAB',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      fullDescription:
        'Mechanisms of synaptic vesicle recycling, presynaptic protein sorting, and neurotransmitter release.',
      shortDescription: 'Studies synaptic vesicle recycling and release.',
      websiteUrl: 'https://sharedcenter.example.org/research',
      fieldProvenance: { websiteUrl: { sourceName: 'ysm-faculty-directory' } },
    };

    expect([
      ...selectExactUrlDuplicateRiskEntityIds([otherLabsOwner, unrelatedServingLab]),
    ]).toEqual(['atoz-other']);
  });

  it('still resolves a collision where two index-published rows contest one address', () => {
    const thinIndexRow = {
      _id: 'atoz-shared-thin',
      slug: 'ysm-shared-thin',
      name: 'Shared Lab',
      entityType: 'LAB',
      kind: 'lab',
      studentVisibilityTier: 'suppressed',
      websiteUrl: 'https://medicine.yale.edu/lab/shared/',
      fieldProvenance: { websiteUrl: { sourceName: 'ysm-atoz-index' } },
    };
    const describedIndexRow = {
      _id: 'atoz-shared-described',
      slug: 'ysm-shared-described',
      name: 'Shared Lab',
      entityType: 'LAB',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      fullDescription:
        'Mechanisms of synaptic vesicle recycling, presynaptic protein sorting, and neurotransmitter release.',
      shortDescription: 'Studies synaptic vesicle recycling and release.',
      websiteUrl: 'https://medicine.yale.edu/lab/shared/index.aspx',
      fieldProvenance: { websiteUrl: { sourceName: 'ysm-atoz-index' } },
    };

    expect([...selectExactUrlDuplicateRiskEntityIds([thinIndexRow, describedIndexRow])]).toEqual([
      'atoz-shared-thin',
    ]);
  });

  it('gives no address authority to a profile-area shell carrying index provenance', () => {
    const profileAreaShell = {
      _id: 'shell-quinn',
      slug: 'faculty-research-area-quinn',
      name: 'Dana Quinn Research',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'suppressed',
      websiteUrl: 'https://medicine.yale.edu/lab/quinn/',
      fieldProvenance: { websiteUrl: { sourceName: 'ysm-atoz-index' } },
    };
    const concreteLab = {
      _id: 'lab-quinn',
      slug: 'ysm-quinn',
      name: 'Quinn Lab',
      entityType: 'LAB',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      fullDescription:
        'Computational models of immune repertoire selection, clonal expansion, and vaccine response breadth.',
      shortDescription: 'Models immune repertoire selection and vaccine response.',
      websiteUrl: 'https://medicine.yale.edu/lab/quinn/index.aspx',
      fieldProvenance: { websiteUrl: { sourceName: 'ysm-faculty-directory' } },
    };

    expect([...selectExactUrlDuplicateRiskEntityIds([profileAreaShell, concreteLab])]).toEqual([
      'shell-quinn',
    ]);
  });

  it('names only address-authority sources the coverage registry knows', () => {
    expect(RESEARCH_HOME_URL_INDEX_AUTHORITY_SOURCE_NAMES.size).toBeGreaterThan(0);
    for (const sourceName of RESEARCH_HOME_URL_INDEX_AUTHORITY_SOURCE_NAMES) {
      expect(Object.keys(sourceCoverageRegistry)).toContain(sourceName);
    }
  });

  it('does not treat shared generic directory pages as exact duplicate evidence', () => {
    const ids = selectExactUrlDuplicateRiskEntityIds([
      {
        _id: 'wti-one',
        slug: 'faculty-research-area-one',
        websiteUrl: 'https://wti.yale.edu/humans/faculty',
      },
      {
        _id: 'wti-two',
        slug: 'faculty-research-area-two',
        websiteUrl: 'https://wti.yale.edu/humans/faculty/',
      },
    ]);

    expect([...ids]).toEqual([]);
  });

  it('does not treat a shared institutional /about landing page as exact duplicate evidence', () => {
    const ids = selectExactUrlDuplicateRiskEntityIds(
      [
        {
          _id: 'safdar-lab',
          slug: 'ysm-safdar',
          name: 'Safdar Lab',
          entityType: 'LAB',
          kind: 'lab',
          studentVisibilityTier: 'suppressed',
          websiteUrl: 'https://medicine.yale.edu/lab/safdar/',
          sourceUrls: ['https://medicine.yale.edu/lab/safdar/', 'https://medicine.yale.edu/about/'],
        },
        {
          _id: 'flavell-lab',
          slug: 'ysm-flavell',
          name: 'Flavell Lab',
          entityType: 'LAB',
          kind: 'lab',
          studentVisibilityTier: 'suppressed',
          websiteUrl: 'https://medicine.yale.edu/lab/flavell/',
          sourceUrls: [
            'https://medicine.yale.edu/lab/flavell/',
            'https://medicine.yale.edu/about/',
          ],
        },
        {
          _id: 'kang-lab',
          slug: 'ysm-kang',
          name: 'Kang Lab',
          entityType: 'LAB',
          kind: 'lab',
          studentVisibilityTier: 'student_ready',
          websiteUrl: 'https://medicine.yale.edu/lab/kang/',
          sourceUrls: ['https://medicine.yale.edu/lab/kang/', 'https://medicine.yale.edu/about/'],
        },
      ],
      [
        { researchEntityId: 'safdar-lab', userId: 'user-safdar' },
        { researchEntityId: 'flavell-lab', userId: 'user-flavell' },
        { researchEntityId: 'kang-lab', userId: 'user-kang' },
      ],
    );

    expect([...ids]).toEqual([]);
  });

  it('does not treat nested shared membership directory pages as exact duplicate evidence', () => {
    const ids = selectExactUrlDuplicateRiskEntityIds([
      {
        _id: 'sara-pai',
        slug: 'faculty-research-area-sara-i-pai',
        name: 'Sara I. Pai Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrls: [
          'https://medicine.yale.edu/cancer/research/membership/directory',
          'https://medicine.yale.edu/profile/sara-pai/',
        ],
      },
      {
        _id: 'shervin-takyar',
        slug: 'faculty-research-area-shervin-s-takyar',
        name: 'Shervin S. Takyar Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrls: [
          'https://medicine.yale.edu/cancer/research/membership/directory/',
          'https://medicine.yale.edu/profile/seyedtaghi-takyar/',
        ],
      },
    ]);

    expect([...ids]).toEqual([]);
  });

  it('normalizes Medicine profile subsite aliases for exact duplicate detection', () => {
    const ids = selectExactUrlDuplicateRiskEntityIds(
      [
        {
          _id: 'xiao-lab',
          slug: 'xiao-lab-ax6',
          name: 'Xiao Lab',
          entityType: 'LAB',
          fullDescription:
            'The lab studies chromatin, DNA damage, stem cells, RNA modifications, cancer biology, and cellular reprogramming at Yale.',
          shortDescription: 'Studies chromatin, DNA damage, stem cells, and cancer biology.',
          sourceUrls: ['https://medicine.yale.edu/profile/andrew-xiao/'],
        },
        {
          _id: 'xiao-shell',
          slug: 'faculty-research-area-andrew-xiao',
          name: 'Andrew Xiao Research',
          entityType: 'FACULTY_RESEARCH_AREA',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/andrew-xiao/',
          sourceUrls: ['https://medicine.yale.edu/cancer/research/membership/directory'],
        },
      ],
      [{ researchEntityId: 'xiao-lab', userId: 'user-xiao' }],
    );

    expect([...ids]).toEqual(['xiao-shell']);
  });

  it('treats http and https own-site URL aliases as exact duplicate evidence', () => {
    const ids = selectExactUrlDuplicateRiskEntityIds(
      [
        {
          _id: 'hayden-material-lab',
          slug: 'dept-seas-hayden-material',
          name: 'Hayden Material Lab',
          entityType: 'LAB',
          studentVisibilityTier: 'student_ready',
          fullDescription:
            'Focuses on mesoscopic physics and nanophotonics, including light propagation, scattering, absorption, and lasing in complex photonic nanostructures.',
          shortDescription: 'Studies mesoscopic physics and nanophotonics.',
          sourceUrls: ['https://www.eng.yale.edu/caolab/'],
        },
        {
          _id: 'hayden-material-shell',
          slug: 'dept-physics-hayden-material',
          name: 'Hayden Material Faculty Research',
          entityType: 'FACULTY_RESEARCH_AREA',
          websiteUrl: 'http://www.eng.yale.edu/caolab',
          sourceUrls: ['https://physics.yale.edu/people/faculty'],
        },
      ],
      [{ researchEntityId: 'hayden-material-lab', userId: 'user-hayden-material' }],
    );

    expect([...ids]).toEqual(['hayden-material-shell']);
  });

  it('prefers a concrete lab over a thin same-URL faculty shell during exact duplicate detection', () => {
    const ids = selectExactUrlDuplicateRiskEntityIds(
      [
        {
          _id: 'christensen-lab',
          slug: 'nsf-pi-timothy-christensen',
          name: 'Timothy Christensen Lab',
          entityType: 'LAB',
          kind: 'lab',
          websiteUrl: 'https://tmchristensen.com/',
          sourceUrls: [
            'https://tmchristensen.com/',
            'https://www.nsf.gov/awardsearch/showAward?AWD_ID=2521471',
          ],
        },
        {
          _id: 'christensen-shell',
          slug: 'dept-econ-timothy-christensen',
          name: 'Timothy Christensen Faculty Research',
          entityType: 'FACULTY_RESEARCH_AREA',
          kind: 'individual',
          websiteUrl: 'https://tmchristensen.com/',
          shortDescription:
            'The Timothy Christensen Lab focuses on econometric methods and applications in economics, including treatment policy and empirical demand models.',
          sourceUrls: ['https://economics.yale.edu/people?page=7', 'https://tmchristensen.com/'],
        },
      ],
      [{ researchEntityId: 'christensen-shell', userId: 'user-christensen' }],
    );

    expect([...ids]).toEqual(['christensen-shell']);
  });

  it('does not collide unrelated faculty whose sites are wrapped as distinct Outlook safelinks', () => {
    const ids = selectExactUrlDuplicateRiskEntityIds([
      {
        _id: 'roster-research',
        slug: 'dept-one-morgan-roster',
        name: 'Morgan Roster Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl:
          'https://nam12.safelinks.protection.outlook.com/?url=http%3A%2F%2Fwww.morganroster.com%2F&data=05%7C01%7C&sdata=abc&reserved=0',
        sourceUrls: ['https://example.yale.edu/people/faculty'],
      },
      {
        _id: 'lovelace-research',
        slug: 'dept-two-ada-lovelace',
        name: 'Ada Lovelace Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        websiteUrl:
          'https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fadalovelacelab.org%2F&data=05%7C02%7C&sdata=xyz&reserved=0',
        sourceUrls: ['https://example.yale.edu/people/faculty'],
      },
    ]);

    expect([...ids]).toEqual([]);
  });

  it('still detects duplicates when both entities wrap the same site in a safelinks wrapper', () => {
    const ids = selectExactUrlDuplicateRiskEntityIds(
      [
        {
          _id: 'roster-canonical',
          slug: 'morgan-roster-lab',
          name: 'Morgan Roster Lab',
          entityType: 'LAB',
          kind: 'lab',
          studentVisibilityTier: 'student_ready',
          fullDescription:
            'The lab studies developmental neurobiology, synaptic plasticity, and circuit formation across model organisms at Yale.',
          shortDescription: 'Studies developmental neurobiology and synaptic plasticity.',
          sourceUrls: ['http://www.morganroster.com/'],
        },
        {
          _id: 'roster-shell',
          slug: 'dept-morgan-roster',
          name: 'Morgan Roster Research',
          entityType: 'FACULTY_RESEARCH_AREA',
          websiteUrl:
            'https://nam12.safelinks.protection.outlook.com/?url=http%3A%2F%2Fwww.morganroster.com%2F&data=05%7C01%7C&reserved=0',
          sourceUrls: ['https://example.yale.edu/people/faculty'],
        },
      ],
      [{ researchEntityId: 'roster-canonical', userId: 'user-roster' }],
    );

    expect([...ids]).toEqual(['roster-shell']);
  });

  it('classifies missing-data reasons as blockers and evidence reasons as signals', () => {
    expect(isBlockingVisibilityReason('missing_description')).toBe(true);
    expect(isBlockingVisibilityReason('thin_description')).toBe(true);
    expect(isBlockingVisibilityReason('content_page_risk')).toBe(true);
    expect(isBlockingVisibilityReason('exact_url_duplicate_risk')).toBe(true);
    expect(isBlockingVisibilityReason('generic_directory_shell')).toBe(true);
    expect(isBlockingVisibilityReason('profile_biography_shell')).toBe(true);
    expect(isBlockingVisibilityReason('non_owner_grant_shell')).toBe(true);
    expect(isBlockingVisibilityReason('research_infrastructure_only')).toBe(true);
    expect(isBlockingVisibilityReason('non_research_entity')).toBe(true);
    expect(isBlockingVisibilityReason('formalization_only')).toBe(true);
    expect(isBlockingVisibilityReason('missing_lead')).toBe(true);
    expect(isBlockingVisibilityReason('missing_card_description')).toBe(true);
    expect(isBlockingVisibilityReason('lab_name_org_type_mismatch')).toBe(true);
    expect(isBlockingVisibilityReason('inactive_at_yale')).toBe(true);
    expect(isBlockingVisibilityReason('source_backed_description')).toBe(false);
    expect(isBlockingVisibilityReason('concrete_next_step')).toBe(false);
    expect(isBlockingVisibilityReason('missing_action_evidence')).toBe(false);
    expect(isBlockingVisibilityReason('missing_facet_signal')).toBe(false);
    // Finalized #1802 soft reclassification: reach-out is the universal next
    // step, so these enrichment/reachability signals never block (missing_source_url
    // is a projection gap, not a source-less entity).
    expect(isBlockingVisibilityReason('missing_alternate_access_path')).toBe(false);
    expect(isBlockingVisibilityReason('missing_application_route')).toBe(false);
    expect(isBlockingVisibilityReason('missing_source_route')).toBe(false);
    expect(isBlockingVisibilityReason('missing_source_url')).toBe(false);
    expect(isBlockingVisibilityReason('missing_official_source')).toBe(false);
  });

  it('treats visibility reason and computed tier drift as material changes', () => {
    expect(
      isStudentVisibilityGatePlanMateriallyChanged(
        safePlan({
          currentTier: 'student_ready',
          currentComputedTier: 'student_ready',
          currentReasons: ['concrete_next_step', 'source_backed_description'],
        }),
      ),
    ).toBe(false);

    expect(
      isStudentVisibilityGatePlanMateriallyChanged(
        safePlan({
          currentTier: 'student_ready',
          currentComputedTier: 'operator_review',
          currentReasons: ['concrete_next_step', 'source_backed_description'],
        }),
      ),
    ).toBe(true);

    expect(
      isStudentVisibilityGatePlanMateriallyChanged(
        safePlan({
          currentTier: 'student_ready',
          currentComputedTier: 'student_ready',
          currentReasons: ['source_backed_description'],
        }),
      ),
    ).toBe(true);
  });

  it('counts changed visibility plans by material persisted state', async () => {
    const report = await runStudentVisibilityGateForPlans(
      [
        safePlan({
          currentTier: 'student_ready',
          currentComputedTier: 'student_ready',
          currentReasons: ['concrete_next_step', 'source_backed_description'],
        }),
        safePlan({
          recordId: 'entity-reasons-changed',
          currentTier: 'student_ready',
          currentComputedTier: 'student_ready',
          currentReasons: ['source_backed_description'],
        }),
      ],
      { mode: 'dry-run' },
    );

    expect(report.counts.changed).toBe(1);
  });

  it('promotes public-safe records and resolves any open release queue item', async () => {
    const deps = {
      updateRecordVisibility: vi.fn().mockResolvedValue(undefined),
      upsertOpenQueueItem: vi.fn().mockResolvedValue(undefined),
      resolveQueueItem: vi.fn().mockResolvedValue(undefined),
    };

    const report = await runStudentVisibilityGateForPlans([safePlan()], {
      mode: 'apply',
      deps,
    });

    expect(report.counts).toMatchObject({ promoted: 1, held: 0, resolved: 1 });
    expect(deps.updateRecordVisibility).toHaveBeenCalledWith(
      'research',
      'entity-safe',
      expect.objectContaining({
        studentVisibilityTier: 'student_ready',
        studentVisibilityComputedTier: 'student_ready',
        studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
      }),
      { timestamps: true },
    );
    expect(
      deps.updateRecordVisibility.mock.calls[0][2].studentVisibilityEvaluatedAt,
    ).toBeInstanceOf(Date);
    expect(deps.resolveQueueItem).toHaveBeenCalledWith(
      'research',
      'entity-safe',
      expect.objectContaining({ resolvedByTier: 'student_ready' }),
    );
    expect(deps.upsertOpenQueueItem).not.toHaveBeenCalled();
  });

  it('holds unsafe records in the release queue with blockers and evidence signals split', async () => {
    const deps = {
      updateRecordVisibility: vi.fn().mockResolvedValue(undefined),
      upsertOpenQueueItem: vi.fn().mockResolvedValue(undefined),
      resolveQueueItem: vi.fn().mockResolvedValue(undefined),
    };

    const report = await runStudentVisibilityGateForPlans(
      [heldPlan({ currentTier: 'student_ready' })],
      {
        mode: 'apply',
        deps,
      },
    );

    expect(report.counts).toMatchObject({ promoted: 0, held: 1, resolved: 0 });
    expect(report.reasonCounts).toMatchObject({
      missing_description: 1,
      missing_action_evidence: 1,
      concrete_next_step: 1,
    });
    expect(deps.updateRecordVisibility).toHaveBeenCalledWith(
      'research',
      'entity-held',
      expect.objectContaining({ studentVisibilityTier: 'operator_review' }),
      { timestamps: true },
    );
    expect(deps.upsertOpenQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'research',
        recordId: 'entity-held',
        blockerReasons: ['missing_description'],
        evidenceSignals: ['missing_action_evidence', 'concrete_next_step'],
        repairStage: 'source_description',
        repairStatus: 'queued',
        remainingBlockers: ['missing_description'],
        status: 'open',
      }),
    );
    expect(deps.resolveQueueItem).not.toHaveBeenCalled();
  });

  it('records only the evaluation of a row it re-decided without changing, leaving updatedAt alone', async () => {
    const deps = {
      updateRecordVisibility: vi.fn().mockResolvedValue(undefined),
      upsertOpenQueueItem: vi.fn().mockResolvedValue(undefined),
      resolveQueueItem: vi.fn().mockResolvedValue(undefined),
    };

    await runStudentVisibilityGateForPlans(
      [
        safePlan({
          currentTier: 'student_ready',
          currentComputedTier: 'student_ready',
          currentReasons: ['concrete_next_step', 'source_backed_description'],
        }),
      ],
      { mode: 'apply', deps },
    );

    expect(Object.keys(deps.updateRecordVisibility.mock.calls[0][2])).toEqual([
      'studentVisibilityEvaluatedAt',
    ]);
    expect(deps.updateRecordVisibility.mock.calls[0][3]).toEqual({ timestamps: false });
  });

  it('routes formalization-only programs to review exception instead of source repair', async () => {
    const deps = {
      updateRecordVisibility: vi.fn().mockResolvedValue(undefined),
      upsertOpenQueueItem: vi.fn().mockResolvedValue(undefined),
      resolveQueueItem: vi.fn().mockResolvedValue(undefined),
    };

    await runStudentVisibilityGateForPlans(
      [
        heldPlan({
          collection: 'programs',
          recordId: 'funding-1',
          label: 'Senior Research Fellowship',
          computedTier: 'limited_but_safe',
          tier: 'operator_review',
          reasons: [
            'formalization_only',
            'official_source',
            'application_route',
            'application_source_only',
            'undergraduate_relevant',
          ],
          nextRepairAction:
            'Keep capped unless source evidence shows mentor matching, project placement, internship, RA program, or another real entry route.',
        }),
      ],
      { mode: 'apply', deps },
    );

    expect(deps.upsertOpenQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'programs',
        blockerReasons: ['formalization_only', 'application_source_only'],
        repairStage: 'review_exception',
      }),
    );
  });

  it('dry-runs without writing visibility fields or queue rows', async () => {
    const deps = {
      updateRecordVisibility: vi.fn().mockResolvedValue(undefined),
      upsertOpenQueueItem: vi.fn().mockResolvedValue(undefined),
      resolveQueueItem: vi.fn().mockResolvedValue(undefined),
      resolveArchivedResearchQueueItems: vi.fn().mockResolvedValue(0),
    };

    const report = await runStudentVisibilityGateForPlans([safePlan(), heldPlan()], {
      mode: 'dry-run',
      deps,
    });

    expect(report.mode).toBe('dry-run');
    expect(report.counts).toMatchObject({ scanned: 2, promoted: 1, held: 1, resolved: 1 });
    expect(deps.updateRecordVisibility).not.toHaveBeenCalled();
    expect(deps.upsertOpenQueueItem).not.toHaveBeenCalled();
    expect(deps.resolveQueueItem).not.toHaveBeenCalled();
    expect(deps.resolveArchivedResearchQueueItems).not.toHaveBeenCalled();
  });

  it('cleans up stale open research queue items for archived entities after apply runs', async () => {
    const deps = {
      updateRecordVisibility: vi.fn().mockResolvedValue(undefined),
      upsertOpenQueueItem: vi.fn().mockResolvedValue(undefined),
      resolveQueueItem: vi.fn().mockResolvedValue(undefined),
      resolveArchivedResearchQueueItems: vi.fn().mockResolvedValue(12),
    };

    await runStudentVisibilityGateForPlans([heldPlan()], {
      mode: 'apply',
      deps,
    });

    expect(deps.upsertOpenQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'research',
        recordId: 'entity-held',
        status: 'open',
      }),
    );
    expect(deps.resolveArchivedResearchQueueItems).toHaveBeenCalledTimes(1);
  });
});

describe('buildStudentVisibilityGateApplyOps', () => {
  const now = new Date('2026-08-23T00:00:00.000Z');
  const alreadyPublicPlan = (overrides: Partial<StudentVisibilityGatePlan> = {}) =>
    safePlan({
      currentTier: 'student_ready',
      currentComputedTier: 'student_ready',
      currentReasons: ['source_backed_description', 'concrete_next_step'],
      ...overrides,
    });

  it('resolves an orphaned open queue item for an already-public entity that did not materially change', () => {
    const plan = alreadyPublicPlan();
    expect(isStudentVisibilityGatePlanMateriallyChanged(plan)).toBe(false);

    const { researchOps, queueOps } = buildStudentVisibilityGateApplyOps(
      [plan],
      new Set(['research:entity-safe']),
      now,
    );

    expect(researchOps).toHaveLength(0);
    expect(queueOps).toHaveLength(1);
    expect(queueOps[0].updateMany.filter).toMatchObject({
      collection: 'research',
      recordId: 'entity-safe',
      status: 'open',
    });
    expect(queueOps[0].updateMany.update.$set).toMatchObject({
      status: 'resolved',
      resolvedByTier: 'student_ready',
    });
  });

  it('emits no queue op for an already-public entity with no open queue item', () => {
    const { researchOps, queueOps } = buildStudentVisibilityGateApplyOps(
      [alreadyPublicPlan()],
      new Set(),
      now,
    );

    expect(researchOps).toHaveLength(0);
    expect(queueOps).toHaveLength(0);
  });

  it('stamps the evaluation of a row the gate re-decided without changing it', () => {
    const plan = alreadyPublicPlan();
    expect(isStudentVisibilityGatePlanMateriallyChanged(plan)).toBe(false);

    const { researchOps, researchEvaluationOps } = buildStudentVisibilityGateApplyOps(
      [plan],
      new Set(),
      now,
    );

    expect(researchOps).toHaveLength(0);
    expect(researchEvaluationOps).toHaveLength(1);
    expect(researchEvaluationOps[0].updateOne.filter).toEqual({ _id: 'entity-safe' });
    expect(researchEvaluationOps[0].updateOne.update.$set).toEqual({
      studentVisibilityEvaluatedAt: now,
    });
  });

  // An unchanged row must not look freshly written to anything that reads `updatedAt`:
  // the Meili copy of it is only refreshed for rows in `researchOps`, and the
  // materializer breaks duplicate-title ties on it.
  it('stamps an unchanged row without bumping its updatedAt', () => {
    const { researchEvaluationOps, programEvaluationOps } = buildStudentVisibilityGateApplyOps(
      [
        alreadyPublicPlan({ recordId: 'entity-unchanged' }),
        alreadyPublicPlan({ collection: 'programs', recordId: 'program-unchanged' }),
      ],
      new Set(),
      now,
    );

    expect(researchEvaluationOps[0].updateOne.timestamps).toBe(false);
    expect(programEvaluationOps[0].updateOne.timestamps).toBe(false);
  });

  it('stamps the evaluation of every plan, not only the ones that changed', () => {
    const { researchOps, researchEvaluationOps } = buildStudentVisibilityGateApplyOps(
      [
        alreadyPublicPlan({ recordId: 'entity-unchanged' }),
        safePlan({ recordId: 'entity-changed' }),
      ],
      new Set(),
      now,
    );

    expect(researchOps.map((op) => op.updateOne.filter._id)).toEqual(['entity-changed']);
    expect(researchOps[0].updateOne.update.$set.studentVisibilityEvaluatedAt).toEqual(now);
    expect(researchEvaluationOps.map((op) => op.updateOne.filter._id)).toEqual([
      'entity-unchanged',
    ]);
  });

  it('emits one op per changed row rather than a separate evaluation stamp', () => {
    const { researchOps, researchEvaluationOps } = buildStudentVisibilityGateApplyOps(
      [safePlan({ recordId: 'entity-changed' })],
      new Set(),
      now,
    );

    expect(researchOps).toHaveLength(1);
    expect(researchEvaluationOps).toHaveLength(0);
    expect(researchOps[0].updateOne.update.$set).toMatchObject({
      studentVisibilityComputedAt: now,
      studentVisibilityEvaluatedAt: now,
    });
  });

  it('keeps the evaluation stamp out of the ops the Meili resync is keyed on', () => {
    const { researchOps, programOps, researchEvaluationOps, programEvaluationOps } =
      buildStudentVisibilityGateApplyOps(
        [
          alreadyPublicPlan({ recordId: 'entity-unchanged' }),
          alreadyPublicPlan({ collection: 'programs', recordId: 'program-unchanged' }),
        ],
        new Set(),
        now,
      );

    expect(researchOps).toHaveLength(0);
    expect(programOps).toHaveLength(0);
    expect(researchEvaluationOps).toHaveLength(1);
    expect(programEvaluationOps).toHaveLength(1);
  });

  it('writes the entity doc and resolves the queue when a public plan materially changes', () => {
    const { researchOps, queueOps } = buildStudentVisibilityGateApplyOps(
      [safePlan()],
      new Set(['research:entity-safe']),
      now,
    );

    expect(researchOps).toHaveLength(1);
    expect(researchOps[0].updateOne.update.$set).toMatchObject({
      studentVisibilityTier: 'student_ready',
    });
    expect(queueOps[0].updateMany.update.$set.status).toBe('resolved');
  });

  it('leaves an in-sync held queue item untouched when it did not materially change', () => {
    const plan = heldPlan({
      currentTier: 'operator_review',
      currentComputedTier: 'operator_review',
      currentReasons: ['missing_description', 'missing_action_evidence', 'concrete_next_step'],
    });
    expect(isStudentVisibilityGatePlanMateriallyChanged(plan)).toBe(false);

    const { researchOps, queueOps } = buildStudentVisibilityGateApplyOps(
      [plan],
      new Set(['research:entity-held']),
      now,
    );

    expect(researchOps).toHaveLength(0);
    expect(queueOps).toHaveLength(0);
  });

  it('creates a missing held queue item even when the plan did not materially change', () => {
    const plan = heldPlan({
      currentTier: 'operator_review',
      currentComputedTier: 'operator_review',
      currentReasons: ['missing_description', 'missing_action_evidence', 'concrete_next_step'],
    });

    const { queueOps } = buildStudentVisibilityGateApplyOps([plan], new Set(), now);

    expect(queueOps).toHaveLength(1);
    expect(queueOps[0].updateOne.upsert).toBe(true);
    expect(queueOps[0].updateOne.update.$set).toMatchObject({
      status: 'open',
      recordId: 'entity-held',
      blockerReasons: ['missing_description'],
    });
  });

  it('leaves an unchanged entity unwritten so the sweep converges', () => {
    const plan = heldPlan({
      currentTier: 'operator_review',
      currentComputedTier: 'operator_review',
      currentReasons: ['missing_description', 'missing_action_evidence', 'concrete_next_step'],
    });
    expect(isStudentVisibilityGatePlanMateriallyChanged(plan)).toBe(false);

    const { researchOps } = buildStudentVisibilityGateApplyOps(
      [plan],
      new Set(['research:entity-held']),
      now,
    );

    expect(researchOps).toHaveLength(0);
  });

  it('suppresses an orphaned open queue item for a suppressed entity', () => {
    const plan = safePlan({
      currentTier: 'suppressed',
      currentComputedTier: 'suppressed',
      computedTier: 'suppressed',
      tier: 'suppressed',
      reasons: ['generic_directory_shell'],
      currentReasons: ['generic_directory_shell'],
    });

    const { queueOps } = buildStudentVisibilityGateApplyOps(
      [plan],
      new Set(['research:entity-safe']),
      now,
    );

    expect(queueOps).toHaveLength(1);
    expect(queueOps[0].updateMany.update.$set.status).toBe('suppressed');
  });
});

describe('evaluateStudentVisibilityGateLeadResolution', () => {
  it('flags an empty-roster gate run where research plans resolve no leads', () => {
    const plans = Array.from({ length: 30 }, (_, index) =>
      safePlan({
        recordId: `entity-${index}`,
        tier: 'operator_review',
        computedTier: 'operator_review',
        reasons: ['missing_lead'],
        hasResolvedLead: false,
      }),
    );

    const result = evaluateStudentVisibilityGateLeadResolution(plans);

    expect(result.resolvedLeadEntityCount).toBe(0);
    expect(result.zeroLeadEntityCount).toBe(30);
    expect(result.safe).toBe(false);
    expect(result.blocker).toContain('resolve zero leads');
  });

  it('stays safe when most research plans resolve a lead and ignores programs', () => {
    const plans = [
      ...Array.from({ length: 30 }, (_, index) =>
        safePlan({ recordId: `lead-${index}`, hasResolvedLead: true }),
      ),
      safePlan({
        recordId: 'missing',
        tier: 'operator_review',
        reasons: ['missing_lead'],
        hasResolvedLead: false,
      }),
      safePlan({ collection: 'programs', recordId: 'program', reasons: ['missing_lead'] }),
    ];

    const result = evaluateStudentVisibilityGateLeadResolution(plans);

    expect(result.resolvedLeadEntityCount).toBe(30);
    expect(result.zeroLeadEntityCount).toBe(1);
    expect(result.safe).toBe(true);
  });
});

describe('reachOutPlausibleSignalCreditsActionEvidence (#530)', () => {
  const officialPageEntity = {
    websiteUrl: 'https://chemistry.yale.edu/profile/ab123',
    sourceUrls: [],
  };
  const validReachOutSignal = {
    type: 'REACH_OUT_PLAUSIBLE',
    archived: false,
    source: { url: '', evidenceIds: ['64f000000000000000000abc'], name: 'dept-faculty-roster' },
  };

  it('counts a validly-persisted REACH_OUT_PLAUSIBLE that has no http source.url', () => {
    expect(
      reachOutPlausibleSignalCreditsActionEvidence({
        signal: validReachOutSignal,
        entity: officialPageEntity,
      }),
    ).toBe(true);
  });

  it('credits action evidence via a REACH_OUT_PLAUSIBLE signal, recorded as a soft signal that never gates student_ready (issue #1802)', () => {
    const entity = {
      entityType: 'LAB',
      name: 'Doe Lab',
      websiteUrl: 'https://chemistry.yale.edu/profile/ab123',
      fullDescription:
        'The Doe Lab studies catalytic reaction mechanisms with an official source-backed research description that is long enough to pass the source-backed description quality bar for this gate.',
      shortDescription: 'Catalysis research in the Doe Lab at Yale.',
      descriptionSource: 'official-scrape',
    };
    const leadMembers = [
      { role: 'pi', userId: '64f000000000000000000010', user: { fname: 'Jane', lname: 'Doe' } },
    ];

    const withoutSignal = computeResearchEntityStudentVisibility({
      entity,
      leadMembers,
      accessSignalCount: 0,
    });
    expect(withoutSignal.reasons).toContain('missing_action_evidence');

    const credited = reachOutPlausibleSignalCreditsActionEvidence({
      signal: validReachOutSignal,
      entity,
    })
      ? 1
      : 0;
    const withSignal = computeResearchEntityStudentVisibility({
      entity,
      leadMembers,
      accessSignalCount: credited,
    });
    expect(credited).toBe(1);
    expect(withSignal.reasons).not.toContain('missing_action_evidence');
    expect(withSignal.reasons).toContain('concrete_next_step');
    // Crediting evidence never changes the tier by itself (issue #1802):
    // both computations land on the same tier here regardless of the signal.
    expect(withSignal.tier).toBe(withoutSignal.tier);
  });

  it('keeps weaker or unbacked signals blocked (fail-safe)', () => {
    expect(
      reachOutPlausibleSignalCreditsActionEvidence({
        signal: { ...validReachOutSignal, type: 'NOT_CURRENTLY_AVAILABLE' },
        entity: officialPageEntity,
      }),
    ).toBe(false);
    expect(
      reachOutPlausibleSignalCreditsActionEvidence({
        signal: { ...validReachOutSignal, source: { url: '', evidenceIds: [], name: '' } },
        entity: officialPageEntity,
      }),
    ).toBe(false);
    expect(
      reachOutPlausibleSignalCreditsActionEvidence({
        signal: { ...validReachOutSignal, archived: true },
        entity: officialPageEntity,
      }),
    ).toBe(false);
    expect(
      reachOutPlausibleSignalCreditsActionEvidence({
        signal: validReachOutSignal,
        entity: { websiteUrl: 'https://reporter.nih.gov/project-details/1', sourceUrls: [] },
      }),
    ).toBe(false);
    expect(
      reachOutPlausibleSignalCreditsActionEvidence({
        signal: validReachOutSignal,
        entity: { websiteUrl: '', sourceUrls: [] },
      }),
    ).toBe(false);
  });

  it('does not double-count a REACH_OUT_PLAUSIBLE that already carries an http source.url', () => {
    expect(
      reachOutPlausibleSignalCreditsActionEvidence({
        signal: {
          ...validReachOutSignal,
          source: {
            ...validReachOutSignal.source,
            url: 'https://chemistry.yale.edu/profile/ab123',
          },
        },
        entity: officialPageEntity,
      }),
    ).toBe(false);
  });

  it('does not credit an identified-lead-fallback derivation as action evidence (#1359)', () => {
    expect(
      reachOutPlausibleSignalCreditsActionEvidence({
        signal: {
          ...validReachOutSignal,
          derivationKey: ORGANIZATIONAL_HOME_WAYS_IN_DERIVATION_KEY,
        },
        entity: officialPageEntity,
      }),
    ).toBe(false);
  });
});

describe('gate apply convergence without a version stamp', () => {
  it('re-gates a materially-changed entity and never writes a version stamp', () => {
    const plan = safePlan({
      currentTier: 'operator_review',
      currentComputedTier: 'operator_review',
      currentReasons: ['missing_action_evidence'],
      computedTier: 'student_ready',
      tier: 'student_ready',
      reasons: ['source_backed_description', 'concrete_next_step'],
    });
    expect(isStudentVisibilityGatePlanMateriallyChanged(plan)).toBe(true);

    const { researchOps } = buildStudentVisibilityGateApplyOps(
      [plan],
      new Set(['research:entity-safe']),
      new Date('2026-08-26T00:00:00.000Z'),
    );

    expect(researchOps).toHaveLength(1);
    expect(researchOps[0].updateOne.update.$set).not.toHaveProperty('studentVisibilityVersion');
    expect(researchOps[0].updateOne.update.$set).toMatchObject({
      studentVisibilityTier: 'student_ready',
    });
  });
});

describe('a trailing default document is the same destination (#2708)', () => {
  it('marks two rows citing one lab under both spellings as exact duplicates', () => {
    const ids = selectExactUrlDuplicateRiskEntityIds([
      {
        _id: 'canonical-lab',
        slug: 'example-lab',
        name: 'Example Lab',
        entityType: 'LAB',
        studentVisibilityTier: 'student_ready',
        fullDescription:
          'The lab studies airway inflammation and asthma mechanisms using human samples and mouse models at Yale.',
        shortDescription: 'Studies airway inflammation and asthma mechanisms.',
        websiteUrl: 'https://medicine.yale.edu/lab/example/',
      },
      {
        _id: 'aspx-variant',
        slug: 'ysm-example-lab',
        name: 'Example Lab',
        entityType: 'LAB',
        studentVisibilityTier: 'student_ready',
        websiteUrl: 'https://medicine.yale.edu/lab/example/index.aspx',
      },
    ]);

    expect([...ids]).toEqual(['aspx-variant']);
  });

  it('does not collapse two genuinely different pages on one host', () => {
    const ids = selectExactUrlDuplicateRiskEntityIds([
      { _id: 'one', slug: 'lab-one', websiteUrl: 'https://medicine.yale.edu/lab/one/' },
      { _id: 'two', slug: 'lab-two', websiteUrl: 'https://medicine.yale.edu/lab/two/index.aspx' },
    ]);

    expect([...ids]).toEqual([]);
  });
});
