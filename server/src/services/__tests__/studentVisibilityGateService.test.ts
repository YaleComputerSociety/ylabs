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
  isProfileAreaDuplicateCounterpart,
  isBlockingVisibilityReason,
  isStudentVisibilityGatePlanMateriallyChanged,
  listVisibilityReleaseQueue,
  normalizeStudentVisibilityGateObjectId,
  researchEntityGateProjection,
  runStudentVisibilityGateForPlans,
  selectExactUrlDuplicateRiskEntityIds,
  type StudentVisibilityGatePlan,
} from '../studentVisibilityGateService';

const safePlan = (overrides: Partial<StudentVisibilityGatePlan> = {}): StudentVisibilityGatePlan => ({
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

const heldPlan = (overrides: Partial<StudentVisibilityGatePlan> = {}): StudentVisibilityGatePlan => ({
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

  it('loads manual visibility overrides when planning research entity gates', () => {
    expect(researchEntityGateProjection.split(/\s+/)).toContain('studentVisibilityOverrideTier');
  });

  it('caps release queue page before building Mongo skip and limit values', async () => {
    const chain = {
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    };
    mocks.queueFind.mockReturnValue(chain);
    mocks.queueCountDocuments.mockResolvedValue(0);

    const result = await listVisibilityReleaseQueue({
      page: 999_999_999,
      pageSize: 500,
    });

    expect(chain.skip).toHaveBeenCalledWith(99_900);
    expect(chain.limit).toHaveBeenCalledWith(100);
    expect(result).toMatchObject({
      page: 1000,
      pageSize: 100,
      totalPages: 0,
    });
  });

  it('bounds release queue filters before building Mongo queries', async () => {
    const chain = {
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    };
    mocks.queueFind.mockReturnValue(chain);
    mocks.queueCountDocuments.mockResolvedValue(0);

    await listVisibilityReleaseQueue({
      status: '$where',
      reason: 'x'.repeat(121),
      sourceName: '  ysm-atoz-index  ',
    });

    expect(mocks.queueFind).toHaveBeenCalledWith({
      status: 'open',
      sourceNames: 'ysm-atoz-index',
    });
    expect(mocks.queueCountDocuments).toHaveBeenCalledWith({
      status: 'open',
      sourceNames: 'ysm-atoz-index',
    });
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

  it('classifies missing-data reasons as blockers and evidence reasons as signals', () => {
    expect(isBlockingVisibilityReason('missing_description')).toBe(true);
    expect(isBlockingVisibilityReason('thin_description')).toBe(true);
    expect(isBlockingVisibilityReason('content_page_risk')).toBe(true);
    expect(isBlockingVisibilityReason('pi_identity_conflict')).toBe(true);
    expect(isBlockingVisibilityReason('exact_url_duplicate_risk')).toBe(true);
    expect(isBlockingVisibilityReason('generic_directory_shell')).toBe(true);
    expect(isBlockingVisibilityReason('profile_biography_shell')).toBe(true);
    expect(isBlockingVisibilityReason('non_owner_grant_shell')).toBe(true);
    expect(isBlockingVisibilityReason('research_infrastructure_only')).toBe(true);
    expect(isBlockingVisibilityReason('formalization_only')).toBe(true);
    expect(isBlockingVisibilityReason('source_backed_description')).toBe(false);
    expect(isBlockingVisibilityReason('concrete_next_step')).toBe(false);
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
    );
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

    const report = await runStudentVisibilityGateForPlans([heldPlan()], {
      mode: 'apply',
      deps,
    });

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
    );
    expect(deps.upsertOpenQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'research',
        recordId: 'entity-held',
        blockerReasons: ['missing_description', 'missing_action_evidence'],
        evidenceSignals: ['concrete_next_step'],
        repairStage: 'source_description',
        repairStatus: 'queued',
        remainingBlockers: ['missing_description', 'missing_action_evidence'],
        status: 'open',
      }),
    );
    expect(deps.resolveQueueItem).not.toHaveBeenCalled();
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
