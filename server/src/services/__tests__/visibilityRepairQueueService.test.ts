import { describe, expect, it, vi } from 'vitest';

import {
  buildVisibilityRepairPiMemberUpsert,
  buildVisibilityRepairPlan,
  buildVisibilityRepairPlans,
  classifyVisibilityRepairStage,
  normalizeVisibilityRepairObjectId,
  runVisibilityRepairQueue,
  type VisibilityRepairQueueItemInput,
} from '../visibilityRepairQueueService';

const queueItem = (
  overrides: Partial<VisibilityRepairQueueItemInput> = {},
): VisibilityRepairQueueItemInput => ({
  _id: 'queue-1',
  collection: 'research',
  recordId: 'entity-1',
  label: 'Queued Lab',
  blockerReasons: ['missing_description'],
  sourceNames: ['ysm-atoz-index'],
  ...overrides,
});

describe('visibilityRepairQueueService', () => {
  it('normalizes visibility repair ObjectIds without object-shaped coercion', () => {
    expect(normalizeVisibilityRepairObjectId(' 507f1f77bcf86cd799439011 ')).toBe(
      '507f1f77bcf86cd799439011',
    );
    expect(normalizeVisibilityRepairObjectId('queue-1')).toBeUndefined();
    expect(
      normalizeVisibilityRepairObjectId({
        toString: () => '507f1f77bcf86cd799439011',
      }),
    ).toBeUndefined();
  });

  it('builds PI member upserts against current PI rows only', () => {
    const now = new Date('2026-06-05T04:00:00.000Z');

    const upsert = buildVisibilityRepairPiMemberUpsert(
      'entity-1',
      'user-1',
      {
        sourceUrl: 'https://medicine.yale.edu/profile/example-faculty/',
        sourceName: 'visibility-repair-queue',
        confidence: 0.95,
      },
      now,
    );

    expect(upsert).toEqual({
      filter: {
        researchEntityId: 'entity-1',
        userId: 'user-1',
        role: 'pi',
        isCurrentMember: true,
      },
      update: {
        $set: expect.objectContaining({
          researchEntityId: 'entity-1',
          researchGroupId: 'entity-1',
          userId: 'user-1',
          role: 'pi',
          isCurrentMember: true,
          archived: false,
          sourceUrl: 'https://medicine.yale.edu/profile/example-faculty/',
          confidence: 0.95,
          lastObservedAt: now,
          'confidenceByField.role': 0.95,
          'fieldProvenance.role': {
            sourceName: 'visibility-repair-queue',
            sourceUrl: 'https://medicine.yale.edu/profile/example-faculty/',
            observedAt: now,
            confidence: 0.95,
          },
        }),
        $setOnInsert: { startedAt: now },
      },
      options: { upsert: true },
    });
  });

  it('classifies blockers into automatic repair stages', () => {
    expect(classifyVisibilityRepairStage(['missing_description'])).toBe('source_description');
    expect(classifyVisibilityRepairStage(['missing_card_description'])).toBe('source_description');
    expect(classifyVisibilityRepairStage(['missing_lead'])).toBe('pi_identity');
    expect(classifyVisibilityRepairStage(['missing_action_evidence'])).toBe('action_evidence');
    expect(classifyVisibilityRepairStage(['exact_url_duplicate_risk', 'missing_description'])).toBe(
      'suppression',
    );
    expect(classifyVisibilityRepairStage(['generic_directory_shell', 'missing_lead'])).toBe(
      'suppression',
    );
    expect(classifyVisibilityRepairStage(['content_page_risk'])).toBe('suppression');
    expect(classifyVisibilityRepairStage(['research_infrastructure_only'])).toBe('suppression');
    expect(classifyVisibilityRepairStage(['formalization_only'])).toBe('review_exception');
    expect(classifyVisibilityRepairStage(['formalization_only', 'application_source_only'])).toBe(
      'review_exception',
    );
    expect(classifyVisibilityRepairStage(['unknown_reason'])).toBe('review_exception');
  });

  it('does not auto-attempt formalization-only review exceptions', () => {
    const plan = buildVisibilityRepairPlan(
      queueItem({
        collection: 'programs',
        blockerReasons: ['formalization_only', 'application_source_only'],
      }),
    );

    expect(plan.repairStage).toBe('review_exception');
    expect(plan.safeToAttempt).toBe(false);
    expect(plan.nextRepairAction).toContain('Keep capped');
  });

  it('prioritizes source and description repair before PI and action evidence', () => {
    const plans = buildVisibilityRepairPlans([
      queueItem({
        _id: 'action',
        recordId: 'action',
        label: 'Action',
        blockerReasons: ['missing_action_evidence'],
      }),
      queueItem({
        _id: 'pi',
        recordId: 'pi',
        label: 'PI',
        blockerReasons: ['missing_lead'],
      }),
      queueItem({
        _id: 'description',
        recordId: 'description',
        label: 'Description',
        blockerReasons: ['missing_description', 'missing_lead', 'missing_action_evidence'],
      }),
    ]);

    expect(plans.map((plan) => plan.repairStage)).toEqual([
      'source_description',
      'pi_identity',
      'action_evidence',
    ]);
    expect(plans[0]).toMatchObject({
      recordId: 'description',
      safeToAttempt: true,
    });
  });

  it('dry-runs repair planning without applying patches or rerunning gates', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([queueItem()]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        description:
          'The lab studies immune mechanisms in cancer and develops translational approaches for therapy.',
        websiteUrl: 'https://medicine.yale.edu/example-lab',
        sourceUrls: ['https://medicine.yale.edu/example-lab'],
      }),
      updateResearchEntity: vi.fn(),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue({ mode: 'dry-run', collection: 'research' }, deps);

    expect(report.repaired).toBe(1);
    expect(deps.updateResearchEntity).not.toHaveBeenCalled();
    expect(deps.updateQueueItem).not.toHaveBeenCalled();
    expect(deps.runGate).not.toHaveBeenCalled();
  });

  it('applies deterministic source-backed description repairs and reruns the gate', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([queueItem()]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        description:
          'The lab studies immune mechanisms in cancer and develops translational approaches for therapy.',
        websiteUrl: 'https://medicine.yale.edu/example-lab',
        sourceUrls: ['https://medicine.yale.edu/example-lab'],
      }),
      updateResearchEntity: vi.fn().mockResolvedValue(undefined),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue({ mode: 'apply', collection: 'research' }, deps);

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.updateResearchEntity).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({
        fullDescription: expect.stringContaining('immune mechanisms'),
        shortDescription: expect.stringContaining('immune mechanisms'),
      }),
    );
    expect(deps.updateQueueItem).toHaveBeenCalledWith(
      'queue-1',
      expect.objectContaining({
        repairStage: 'source_description',
        repairStatus: 'repaired',
        remainingBlockers: [],
      }),
    );
    expect(deps.runGate).toHaveBeenCalledWith('research', ['entity-1'], 'apply');
  });

  it('resolves stale source-description blockers when current quality is already complete', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_card_description'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'Research fields include machine learning, algorithms, data compression, and automata theory.',
        shortDescription: 'Studies machine learning, algorithms, data compression, and automata theory.',
        websiteUrl: 'https://engineering.yale.edu/research-and-faculty/faculty-directory/drew-fixture',
        sourceUrls: [
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/drew-fixture',
        ],
      }),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
        },
      ]),
      updateResearchEntity: vi.fn(),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue({ mode: 'apply', collection: 'research' }, deps);

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'repaired',
      patchSummary: ['resolved stale source-description queue blockers against current quality'],
      remainingBlockers: [],
    });
    expect(deps.updateResearchEntity).not.toHaveBeenCalled();
    expect(deps.updateQueueItem).toHaveBeenCalledWith(
      'queue-1',
      expect.objectContaining({
        repairStatus: 'repaired',
        remainingBlockers: [],
      }),
    );
    expect(deps.runGate).toHaveBeenCalledWith('research', ['entity-1'], 'apply');
  });

  it('derives missing card descriptions from an existing source-backed fullDescription', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_card_description'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'Research fields include machine learning, algorithms, data compression, and automata theory.',
        shortDescription: '',
        websiteUrl: 'https://engineering.yale.edu/research-and-faculty/faculty-directory/drew-fixture',
        sourceUrls: [
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/drew-fixture',
        ],
      }),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
        },
      ]),
      updateResearchEntity: vi.fn().mockResolvedValue(undefined),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue({ mode: 'apply', collection: 'research' }, deps);

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'repaired',
      patchSummary: ['derived shortDescription from source-backed fullDescription'],
      remainingBlockers: [],
    });
    expect(deps.updateResearchEntity).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({
        shortDescription: expect.stringMatching(
          /machine learning, algorithms, data compression, and automata theory/i,
        ),
      }),
    );
    expect(deps.updateQueueItem).toHaveBeenCalledWith(
      'queue-1',
      expect.objectContaining({
        repairStatus: 'repaired',
        remainingBlockers: [],
      }),
    );
    expect(deps.runGate).toHaveBeenCalledWith('research', ['entity-1'], 'apply');
  });

  it('blocks PI identity repair for archived research entities before member upsert', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_lead'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        archived: true,
        canonicalGroupId: 'canonical-entity',
        sourceUrls: ['https://medicine.yale.edu/profile/example-faculty/'],
      }),
      findResearchEntityMembers: vi.fn(),
      findUserByProfileUrl: vi.fn(),
      upsertResearchEntityMember: vi.fn(),
      updateResearchEntity: vi.fn(),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue({ mode: 'apply', collection: 'research' }, deps);

    expect(report).toMatchObject({ repaired: 0, blocked: 1, resolvedByGate: 0 });
    expect(report.attempts[0]).toMatchObject({
      applied: false,
      status: 'blocked',
      remainingBlockers: ['missing_lead', 'archived_research_entity'],
      repairSource: 'https://medicine.yale.edu/profile/example-faculty/',
    });
    expect(deps.findUserByProfileUrl).not.toHaveBeenCalled();
    expect(deps.upsertResearchEntityMember).not.toHaveBeenCalled();
    expect(deps.runGate).not.toHaveBeenCalled();
  });

  it('blocks action evidence repair for archived research entities before artifact upserts', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        archived: true,
        websiteUrl: 'https://medicine.yale.edu/example-lab',
        sourceUrls: ['https://medicine.yale.edu/example-lab'],
      }),
      findResearchEntityMembers: vi.fn(),
      findActionEvidenceObservationIds: vi.fn(),
      upsertEntryPathway: vi.fn(),
      upsertAccessSignal: vi.fn(),
      upsertContactRoute: vi.fn(),
      updateResearchEntity: vi.fn(),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue({ mode: 'apply', collection: 'research' }, deps);

    expect(report).toMatchObject({ repaired: 0, blocked: 1, resolvedByGate: 0 });
    expect(report.attempts[0]).toMatchObject({
      applied: false,
      status: 'blocked',
      remainingBlockers: ['missing_action_evidence', 'archived_research_entity'],
      repairSource: 'https://medicine.yale.edu/example-lab',
    });
    expect(deps.findActionEvidenceObservationIds).not.toHaveBeenCalled();
    expect(deps.upsertEntryPathway).not.toHaveBeenCalled();
    expect(deps.upsertAccessSignal).not.toHaveBeenCalled();
    expect(deps.upsertContactRoute).not.toHaveBeenCalled();
    expect(deps.runGate).not.toHaveBeenCalled();
  });

  it('attaches missing source URLs from field provenance without clearing missing description', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_description', 'missing_source_url'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        sourceUrls: [],
        fieldProvenance: {
          undergradAccessEvidence: {
            sourceName: 'lab-microsite-undergrad-llm',
            sourceUrl: 'https://history.yale.edu/people/abbas-amanat',
          },
        },
      }),
      updateResearchEntity: vi.fn().mockResolvedValue(undefined),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 0 } }),
    };

    const report = await runVisibilityRepairQueue({ mode: 'apply', collection: 'research' }, deps);

    expect(report).toMatchObject({ repaired: 0, blocked: 1 });
    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'blocked',
      patchSummary: ['attached sourceUrls from field provenance'],
      remainingBlockers: ['missing_description'],
      repairSource: 'https://history.yale.edu/people/abbas-amanat',
    });
    expect(deps.updateResearchEntity).toHaveBeenCalledWith('entity-1', {
      sourceUrls: ['https://history.yale.edu/people/abbas-amanat'],
    });
    expect(deps.updateQueueItem).toHaveBeenCalledWith(
      'queue-1',
      expect.objectContaining({
        repairStatus: 'blocked',
        remainingBlockers: ['missing_description'],
      }),
    );
  });

  it('does not attach metadata-only field provenance as source URLs', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_description', 'missing_source_url'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        sourceUrls: [],
        fieldProvenance: {
          undergradAccessEvidence: {
            sourceName: 'orcid',
            sourceUrl: 'https://orcid.org/0000-0000-0000-0000',
          },
        },
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 0 } }),
    };

    const report = await runVisibilityRepairQueue({ mode: 'apply', collection: 'research' }, deps);

    expect(report).toMatchObject({ repaired: 0, blocked: 1 });
    expect(report.attempts[0]).toMatchObject({
      applied: false,
      status: 'blocked',
      patchSummary: [],
      remainingBlockers: ['missing_description', 'missing_source_url'],
      repairSource: 'https://orcid.org/0000-0000-0000-0000',
    });
    expect(deps.updateResearchEntity).not.toHaveBeenCalled();
    expect(deps.runGate).not.toHaveBeenCalled();
  });

  it('selects only queued repair items by default', async () => {
    const openItems = [
      queueItem({ _id: 'blocked', repairStatus: 'blocked' }),
      queueItem({ _id: 'repaired', recordId: 'entity-3', repairStatus: 'repaired' }),
      queueItem({ _id: 'attempted', recordId: 'entity-4', repairStatus: 'queued', attemptCount: 1 }),
      queueItem({ _id: 'queued', recordId: 'entity-2', repairStatus: 'queued' }),
    ];
    const deps = {
      findOpenQueueItems: vi.fn(async (options) =>
        openItems.filter((item) =>
          options.retryBlocked
            ? item.repairStatus === 'queued' || item.repairStatus === 'blocked'
            : item.repairStatus === 'queued' && (item.attemptCount || 0) === 0,
        ),
      ),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-2',
        description:
          'The lab studies microbial physiology, infection biology, and host-pathogen interaction mechanisms.',
        websiteUrl: 'https://medicine.yale.edu/example-lab',
        sourceUrls: ['https://medicine.yale.edu/example-lab'],
      }),
      updateResearchEntity: vi.fn().mockResolvedValue(undefined),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue({ mode: 'apply', collection: 'research' }, deps);

    expect(deps.findOpenQueueItems).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'apply', collection: 'research' }),
    );
    expect(report.plans.map((plan) => plan.queueItemId)).toEqual(['queued']);
  });

  it('backfills missing card descriptions from useful full descriptions', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_card_description'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'The lab studies quantum simulation, ultracold atoms, optical lattices, and topology in many-body physics. Current projects examine how unusual lattice geometries shape quantum behavior.',
        shortDescription: '',
        websiteUrl: 'https://physics.yale.edu/example-lab',
        sourceUrls: ['https://physics.yale.edu/example-lab'],
      }),
      updateResearchEntity: vi.fn().mockResolvedValue(undefined),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue({ mode: 'apply', collection: 'research' }, deps);

    expect(report.repaired).toBe(1);
    expect(deps.updateResearchEntity).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({
        shortDescription: expect.stringMatching(/quantum|lattice|topology/i),
      }),
    );
  });

  it('blocks missing card repair when only directory source URLs support the description', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_card_description'],
        }),
      ]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'Research fields include cancer immunology, tumor microenvironment, and translational oncology.',
        shortDescription: '',
        websiteUrl: '',
        sourceUrls: ['https://medicine.yale.edu/cancer/research/membership/directory'],
      }),
      updateResearchEntity: vi.fn(),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue({ mode: 'dry-run', collection: 'research' }, deps);

    expect(report.repaired).toBe(0);
    expect(report.blocked).toBe(1);
    expect(report.attempts[0]).toMatchObject({
      applied: false,
      status: 'blocked',
      repairSource: 'https://medicine.yale.edu/cancer/research/membership/directory',
    });
  });

  it('blocks missing card repair when the derived short description still fails quality', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_card_description'],
        }),
      ]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'I am a professor at Yale University. My office is on campus and students can read more about my work online.',
        shortDescription: '',
        websiteUrl: 'https://medicine.yale.edu/profile/example-faculty/',
        sourceUrls: ['https://medicine.yale.edu/profile/example-faculty/'],
      }),
      updateResearchEntity: vi.fn(),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue({ mode: 'dry-run', collection: 'research' }, deps);

    expect(report.repaired).toBe(0);
    expect(report.blocked).toBe(1);
  });

  it('repairs source description from source-backed entity profile fields', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([queueItem()]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        profile: {
          overview:
            'This lab studies how students learn from official archival and field evidence across disciplines.',
        },
        websiteUrl: 'https://official.yale.edu/lab',
        sourceUrls: ['https://official.yale.edu/lab'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 0 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'dry-run',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'repaired',
      patchSummary: expect.arrayContaining([
        'copied useful source-backed profile overview into fullDescription',
      ]),
      repairSource: 'https://official.yale.edu/lab',
    });
  });

  it('repairs source description from official lead member research interests', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([queueItem()]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        websiteUrl: '',
        sourceUrls: ['https://medicine.yale.edu/profile/example-faculty/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          user: {
            fname: 'Example',
            lname: 'Faculty',
            researchInterests: [
              'RNA splicing',
              'zebrafish development',
              'single-cell genomics',
            ],
            profileUrls: {
              medicine: 'https://medicine.yale.edu/profile/example-faculty/',
            },
          },
        },
      ]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 0 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'dry-run',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'repaired',
      patchSummary: expect.arrayContaining([
        'copied useful source-backed lead profile research interests into fullDescription',
      ]),
      repairSource: 'https://medicine.yale.edu/profile/example-faculty/',
    });
    expect(report.attempts[0].patchSummary).toContain(
      'derived shortDescription from source-backed lead profile research interests',
    );
  });

  it('repairs source description from an attached lead profile bio', async () => {
    const sourceUrl = 'https://erm.yale.edu/people/fiona-castellan-moreau';
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_description', 'missing_source_url'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Fiona Castellan Moreau Lab',
        sourceUrls: [],
      }),
      updateResearchEntity: vi.fn().mockResolvedValue(undefined),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Fiona',
            lname: 'Castellan Moreau',
            bio:
              "Fiona Castellan Moreau's research examines migration, borderlands, Latinx literature, and social movements across the Americas. Her work analyzes cultural politics, state power, and community organizing through literary, historical, and media evidence.",
            profileUrls: {
              departmental: sourceUrl,
            },
          },
        },
      ]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue({ mode: 'apply', collection: 'research' }, deps);

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'repaired',
      patchSummary: expect.arrayContaining([
        'attached sourceUrls from trusted website fields',
        'copied useful source-backed lead profile bio into fullDescription',
        'derived shortDescription from source-backed lead profile bio',
      ]),
      remainingBlockers: [],
      repairSource: sourceUrl,
    });
    expect(deps.updateResearchEntity).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({
        sourceUrls: [sourceUrl],
        fullDescription: expect.stringContaining('migration, borderlands'),
        shortDescription: expect.stringMatching(/migration|borderlands|Latinx/i),
      }),
    );
    expect(deps.updateQueueItem).toHaveBeenCalledWith(
      'queue-1',
      expect.objectContaining({
        repairStatus: 'repaired',
        remainingBlockers: [],
      }),
    );
  });

  it('does not repair source description from teaching-only lead profile chrome', async () => {
    const sourceUrl = 'https://english.yale.edu/people/full-part-time-lecturers/samuel-prescott';
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          label: 'Samuel Prescott — Research',
          blockerReasons: ['missing_card_description'],
        }),
      ]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Samuel Prescott — Research',
        sourceUrls: [sourceUrl],
        fullDescription:
          'Samuel Prescott teaches expository writing in the English Department. A former trusts and estates lawyer, Samuel also teaches an undergraduate introduction to legal reasoning and writing.',
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Samuel',
            lname: 'Prescott',
            bio:
              'Interests Samuel Prescott teaches expository writing in the English Department. A former trusts and estates lawyer, Samuel also teaches an undergraduate introduction to legal reasoning and writing. Courses Undergraduate: Reading and Writing the Modern Essay; Thinking and Writing about the Law',
            profileUrls: {
              departmental: sourceUrl,
            },
          },
        },
      ]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'dry-run',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 0, blocked: 1, resolvedByGate: 0 });
    expect(report.attempts[0]).toMatchObject({
      applied: false,
      status: 'blocked',
      patchSummary: [],
      remainingBlockers: ['missing_card_description'],
      repairSource: sourceUrl,
    });
    expect(deps.updateResearchEntity).not.toHaveBeenCalled();
  });

  it('does not repair source-less descriptions from generic faculty-directory provenance', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_description', 'missing_source_url'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Example Faculty Research',
        sourceUrls: [],
        fullDescription:
          'Example Faculty studies systems biology, computational modeling, and collaborative experimental methods for biomedical discovery.',
        fieldProvenance: {
          fullDescription: {
            sourceUrl: 'https://engineering.yale.edu/faculty-directory',
          },
        },
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 0 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 0, blocked: 1 });
    expect(report.attempts[0]).toMatchObject({
      applied: false,
      status: 'blocked',
      patchSummary: [],
      remainingBlockers: ['missing_description', 'missing_source_url'],
      repairSource: 'https://engineering.yale.edu/faculty-directory',
    });
    expect(deps.updateResearchEntity).not.toHaveBeenCalled();
  });

  it(‘keeps full-description-only profile repairs blocked when the card description is still missing’, async () => {
    const sourceUrl =
      ‘https://english.yale.edu/people/adjunct-professors-and-senior-lecturers-full-part-time-lecturers-creative-writers/jordan-oakes’;
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: [‘profile_fallback_only’],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: ‘entity-1’,
        name: ‘Jordan Oakes — Research’,
        sourceUrls: [sourceUrl],
      }),
      updateResearchEntity: vi.fn().mockResolvedValue(undefined),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: ‘pi’,
          userId: ‘user-1’,
          user: {
            _id: ‘user-1’,
            fname: ‘Jordan’,
            lname: ‘Oakes’,
            bio:
              ‘Jordan Oakes’s writing has been published in the Bellevue Literary Review, the Baltimore Sun, the Boston Phoenix, the Mississippi Review, the New York Times, Off Assignment, Post Road, the Village Voice, and other publications. His books include Difficult Listening and Master Class in Fiction Writing. With a team of visual artists he adapted four of Shakespeare’s tragedies as manga, and his anthology Rap on Rap was acquired by Harvard’s W.E.B. DuBois Institute for African and African American Research.’,
            profileUrls: {
              departmental: sourceUrl,
            },
          },
        },
      ]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'dry-run',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 0, blocked: 1, resolvedByGate: 0 });
    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'blocked',
      patchSummary: expect.arrayContaining([
        'copied useful source-backed lead profile bio into fullDescription',
      ]),
      remainingBlockers: ['missing_card_description'],
      repairSource: sourceUrl,
    });
  });

  it('repairs source description from research-focused sentences inside appointment-heavy lead bios', async () => {
    const profileUrl = 'https://politicalscience.yale.edu/people/lise-beaumont';
    const website = 'http://www.elisebeaumont.com/';
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_description', 'missing_source_url', 'missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Elise Beaumont-Leclair — Research',
        sourceUrls: [],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Élise',
            lname: 'Beaumont',
            website,
            bio:
              'Bio Élise Beaumont is a Professor of Political Science at Yale University, with a secondary appointment in Philosophy. Her research and teaching interests include democratic theory, political epistemology, and the ethics and politics of artificial intelligence.',
            profileUrls: {
              departmental: profileUrl,
            },
          },
        },
      ]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'dry-run',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'blocked',
      patchSummary: expect.arrayContaining([
        'attached sourceUrls from trusted website fields',
        'copied useful source-backed lead profile research summary into fullDescription',
        'derived shortDescription from source-backed lead profile research summary',
      ]),
      remainingBlockers: ['missing_action_evidence'],
      repairSource: profileUrl,
    });
    expect(deps.updateResearchEntity).not.toHaveBeenCalled();
  });

  it('repairs mixed source-description rows with entity-level action evidence fallback', async () => {
    const profileUrl = 'https://politicalscience.yale.edu/people/lise-beaumont';
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_description', 'missing_source_url', 'missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Elise Beaumont-Leclair — Research',
        sourceUrls: [],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Élise',
            lname: 'Beaumont',
            bio:
              'Bio Élise Beaumont is a Professor of Political Science at Yale University, with a secondary appointment in Philosophy. Her research and teaching interests include democratic theory, political epistemology, and the ethics and politics of artificial intelligence.',
            profileUrls: {
              departmental: profileUrl,
            },
          },
        },
      ]),
      findEntityActionEvidenceObservationIds: vi.fn().mockResolvedValue([
        {
          id: 'observation-1',
          excerpt: 'Students may contact the program about research opportunities.',
          sourceUrl: profileUrl,
          sourceName: 'department-profile',
        },
      ]),
      upsertEntryPathway: vi.fn(),
      upsertAccessSignal: vi.fn(),
      upsertContactRoute: vi.fn(),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'dry-run',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'repaired',
      patchSummary: expect.arrayContaining([
        'attached sourceUrls from trusted website fields',
        'copied useful source-backed lead profile research summary into fullDescription',
        'derived shortDescription from source-backed lead profile research summary',
        'created exploratory pathway from entity-level undergraduate evidence',
      ]),
      remainingBlockers: [],
      repairSource: profileUrl,
    });
    expect(deps.findEntityActionEvidenceObservationIds).toHaveBeenCalledWith({
      researchEntityId: 'entity-1',
      sourceUrl: profileUrl,
      sourceUrls: expect.arrayContaining([profileUrl]),
    });
  });

  it('derives card-safe summaries from scholarship-focused lead profile bios', async () => {
    const profileUrl = 'https://erm.yale.edu/people/sonya-claire-fontaine';
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_description', 'missing_source_url', 'missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Sonya-Claire Fontaine — Research',
        sourceUrls: [],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Sonya-Claire',
            lname: 'Fontaine',
            bio:
              'Sonya-Claire Fontaine is Assistant Professor of Ethnicity, Race, and Migration. She received her PhD in Chicana/o and Central American Studies from University of California Los Angeles. She is an interdisciplinary scholar whose scholarship integrates ethnographic methods, digital humanities, and Latinx geographies in analyzing contemporary urban labor struggles and resistance.',
            profileUrls: {
              departmental: profileUrl,
            },
          },
        },
      ]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'dry-run',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'blocked',
      patchSummary: expect.arrayContaining([
        'copied useful source-backed lead profile research summary into fullDescription',
        'derived shortDescription from source-backed lead profile research summary',
      ]),
      remainingBlockers: ['missing_action_evidence'],
      repairSource: profileUrl,
    });
  });

  it('derives card-safe summaries from playwright creative-practice bios', async () => {
    const profileUrl = 'https://tdps.yale.edu/profile/faye-hollister';
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          label: 'Devon Roster — Research',
          blockerReasons: ['missing_description', 'missing_source_url'],
        }),
      ]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Devon Roster — Research',
        sourceUrls: [],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Faye',
            lname: 'Hollister',
            bio:
              'Faye Hollister is a playwright, actor, and founding member of Split Britches Theater Company. She is the author of numerous plays, including Imagining Madoff and Turquoise.',
            profileUrls: {
              departmental: profileUrl,
            },
          },
        },
      ]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'dry-run',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'repaired',
      patchSummary: expect.arrayContaining([
        'copied useful source-backed lead profile creative practice summary into fullDescription',
        'derived shortDescription from source-backed lead profile creative practice summary',
      ]),
      repairSource: profileUrl,
    });
  });

  it('derives card-safe summaries from dance-performance creative-practice bios', async () => {
    const profileUrl = ‘https://tdps.yale.edu/profile/grace-ellery’;
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          label: ‘Grace Ellery — Research’,
          blockerReasons: [‘missing_description’, ‘missing_source_url’],
        }),
      ]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: ‘entity-1’,
        name: ‘Grace Ellery — Research’,
        sourceUrls: [],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: ‘pi’,
          userId: ‘user-1’,
          user: {
            _id: ‘user-1’,
            fname: ‘Grace’,
            lname: ‘Ellery’,
            bio:
              ‘Grace Ellery has performed internationally with New York City Ballet, Mikhail Baryshnikov’s White Oak Dance Project, Twyla Tharp, and Yvonne Rainer. Career highlights include three duets with Baryshnikov.’,
            profileUrls: {
              departmental: profileUrl,
            },
          },
        },
      ]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'dry-run',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'repaired',
      patchSummary: expect.arrayContaining([
        'copied useful source-backed lead profile creative practice summary into fullDescription',
        'derived shortDescription from source-backed lead profile creative practice summary',
      ]),
      repairSource: profileUrl,
    });
  });

  it('derives summaries from publication-focused lead profile bios', async () => {
    const profileUrl = 'https://yalemusic.yale.edu/people/kazimierczak';
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          label: 'RS R. Kazimierczak — Research',
          blockerReasons: ['missing_description', 'missing_source_url', 'missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'RS R. Kazimierczak — Research',
        sourceUrls: [],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'RS',
            lname: 'Kazimierczak',
            bio:
              "RS (R. Kazimierczak) received their Ph.D. in historical musicology from Harvard University in 2010. Bringing the history of musical forms and notation into dialogue with medieval literature, iconography, and the history of ideas, RS's publications have focused on French and northern Italian music of the fourteenth and fifteenth centuries.",
            profileUrls: {
              departmental: profileUrl,
            },
          },
        },
      ]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'dry-run',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'blocked',
      patchSummary: expect.arrayContaining([
        'copied useful source-backed lead profile research summary into fullDescription',
        'derived shortDescription from source-backed lead profile research summary',
      ]),
      remainingBlockers: ['missing_action_evidence'],
      repairSource: profileUrl,
    });
  });

  it('does not use uncorroborated lead interests when an official profile bio is available', async () => {
    const profileUrl = 'https://yalemusic.yale.edu/people/peter-walden';
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          label: 'Peter Walden — Research',
          blockerReasons: ['missing_description', 'missing_source_url', 'missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Peter Walden — Research',
        sourceUrls: [],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Peter',
            lname: 'Walden',
            bio:
              "Peter Walden received his Ph.D in ethnomusicology from Wesleyan University. A self-described musical pan-Africanist, Walden's work has typically addressed musical topics within the black Atlantic cultural sphere of Africa and the African diaspora.",
            researchInterests: [
              'Health Systems',
              'Economic Evaluations',
              'Quality of Life',
              'Global Healthcare and Medical Tourism',
            ],
            profileUrls: {
              departmental: profileUrl,
            },
          },
        },
      ]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'dry-run',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report.attempts[0].patchSummary).toEqual(
      expect.arrayContaining([
        'copied useful source-backed lead profile research summary into fullDescription',
        'derived shortDescription from source-backed lead profile research summary',
      ]),
    );
    expect(report.attempts[0].patchSummary).not.toContain(
      'derived shortDescription from source-backed lead research interests',
    );
  });

  it('does not attach mismatched lead person-profile URLs during source-description repair', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          label: 'Mei Chen Lab',
          blockerReasons: ['missing_description', 'missing_source_url'],
        }),
      ]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Mei Chen Lab',
        sourceUrls: [],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Mei',
            lname: 'Chen',
            researchInterests: [
              'tumor immunology',
              'immune-cell engineering',
              'translational oncology',
            ],
            profileUrls: {
              east_asian_languages: 'https://eall.yale.edu/people/jiahao-chen',
            },
          },
        },
      ]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 0 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 0, blocked: 1 });
    expect(report.attempts[0]).toMatchObject({
      applied: false,
      status: 'blocked',
      remainingBlockers: ['missing_description', 'missing_source_url'],
      repairSource: '',
    });
    expect(deps.updateResearchEntity).not.toHaveBeenCalled();
  });

  it('does not attach mismatched Yale faculty person URLs during source-description repair', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          label: 'Mei Chen Lab',
          blockerReasons: ['missing_description', 'missing_source_url'],
        }),
      ]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Mei Chen Lab',
        sourceUrls: [],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Mei',
            lname: 'Chen',
            researchInterests: [
              'tumor immunology',
              'immune-cell engineering',
              'translational oncology',
            ],
            profileUrls: {
              departmental: 'https://eall.yale.edu/faculty/jiahao-chen',
            },
          },
        },
      ]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 0 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 0, blocked: 1 });
    expect(report.attempts[0]).toMatchObject({
      applied: false,
      status: 'blocked',
      remainingBlockers: ['missing_description', 'missing_source_url'],
      repairSource: '',
    });
    expect(deps.updateResearchEntity).not.toHaveBeenCalled();
  });

  it('derives summaries from scholarship-employs lead profile bios', async () => {
    const profileUrl = 'https://erm.yale.edu/people/oona-delacroix';
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          label: 'Oona Delacroix — Research',
          blockerReasons: ['missing_description', 'missing_source_url'],
        }),
      ]),
      updateQueueItem: vi.fn(),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Oona Delacroix — Research',
        sourceUrls: [],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Oona',
            lname: 'Delacroix',
            bio:
              'Oona Delacroix is Assistant Professor in Ethnicity, Race, and Migration. Her scholarship employs critical Indigenous studies to re-evaluate and re-narrativize stories of the early medieval North Atlantic.',
            profileUrls: {
              departmental: profileUrl,
            },
          },
        },
      ]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'dry-run',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'repaired',
      patchSummary: expect.arrayContaining([
        'copied useful source-backed lead profile research summary into fullDescription',
        'derived shortDescription from source-backed lead profile research summary',
      ]),
      repairSource: profileUrl,
    });
  });

  it('blocks PI repairs when no exact official profile match exists', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_lead', 'duplicate_name_risk'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        websiteUrl: 'https://medicine.yale.edu/profile/example-faculty/',
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      findUserByProfileUrl: vi.fn().mockResolvedValue(null),
      upsertResearchEntityMember: vi.fn(),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'pi_identity',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 0, blocked: 1 });
    expect(deps.upsertResearchEntityMember).not.toHaveBeenCalled();
  });

  it('repairs PI identity only from an exact official profile URL match', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_lead'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Example Faculty Research',
        websiteUrl: 'https://medicine.yale.edu/profile/example-faculty/',
        sourceUrls: ['https://medicine.yale.edu/profile/example-faculty/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      findUserByProfileUrl: vi.fn().mockResolvedValue({
        _id: 'user-1',
        netid: 'example1',
        profileUrls: {
          medicine: 'https://medicine.yale.edu/profile/example-faculty/',
        },
      }),
      upsertResearchEntityMember: vi.fn().mockResolvedValue(undefined),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'pi_identity',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.upsertResearchEntityMember).toHaveBeenCalledWith(
      'entity-1',
      'user-1',
      expect.objectContaining({
        sourceUrl: 'https://medicine.yale.edu/profile/example-faculty/',
        sourceName: 'visibility-repair-queue',
      }),
    );
  });

  it('repairs PI identity and action evidence together from an exact official profile URL match', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_lead', 'missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Example Faculty Research',
        websiteUrl: 'https://medicine.yale.edu/profile/example-faculty/',
        sourceUrls: ['https://medicine.yale.edu/profile/example-faculty/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      findUserByProfileUrl: vi.fn().mockResolvedValue({
        _id: 'user-1',
        fname: 'Example',
        lname: 'Faculty',
        netid: 'example1',
        profileUrls: {
          medicine: 'https://medicine.yale.edu/profile/example-faculty/',
        },
      }),
      upsertResearchEntityMember: vi.fn().mockResolvedValue(undefined),
      upsertEntryPathway: vi.fn().mockResolvedValue({ pathwayId: 'pathway-1' }),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findActionEvidenceObservationIds: vi.fn().mockResolvedValue(['obs-1']),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'pi_identity',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(report.attempts[0]).toMatchObject({
      patchSummary: [
        'attached PI member from exact source/user URL match',
        'created low-confidence exploratory pathway from official PI profile',
        'created reach-out-plausible access signal from official PI profile',
        'created public faculty profile contact route',
      ],
      remainingBlockers: [],
    });
    expect(deps.upsertEntryPathway).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: 'entity-1',
        pathwayType: 'EXPLORATORY_CONTACT',
        sourceEvidenceIds: ['obs-1'],
        sourceUrls: ['https://medicine.yale.edu/profile/example-faculty/'],
      }),
    );
    expect(deps.upsertContactRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Example Faculty',
        url: 'https://medicine.yale.edu/profile/example-faculty/',
        sourceEvidenceIds: ['obs-1'],
      }),
    );
  });

  it('keeps duplicate-risk PI repairs blocked after attaching an exact PI member', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['duplicate_risk'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Example Faculty Research',
        websiteUrl: 'https://medicine.yale.edu/profile/example-faculty/',
        sourceUrls: ['https://medicine.yale.edu/profile/example-faculty/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      findUserByProfileUrl: vi.fn().mockResolvedValue({
        _id: 'user-1',
        netid: 'example1',
        profileUrls: {
          medicine: 'https://medicine.yale.edu/profile/example-faculty/',
        },
      }),
      upsertResearchEntityMember: vi.fn().mockResolvedValue(undefined),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'dry-run',
        collection: 'research',
        stage: 'pi_identity',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 0, blocked: 1, resolvedByGate: 0 });
    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'blocked',
      patchSummary: ['attached PI member from exact source/user URL match'],
      remainingBlockers: ['duplicate_risk'],
    });
  });

  it('repairs PI identity from an exact own website match when the user name matches', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_lead'],
          label: 'Fixture Lead Lab',
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Fixture Lead Lab',
        websiteUrl: 'https://physics.yale.edu/fixture-lead',
        sourceUrls: ['https://physics.yale.edu/faculty'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      findUserByProfileUrl: vi.fn().mockResolvedValue(null),
      findUserByExactWebsiteUrl: vi.fn().mockResolvedValue({
        _id: '000000000000000000000001',
        fname: 'Fixture',
        lname: 'Lead',
        netid: 'fl000',
        website: 'https://physics.yale.edu/fixture-lead',
      }),
      upsertResearchEntityMember: vi.fn().mockResolvedValue(undefined),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'pi_identity',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.findUserByExactWebsiteUrl).toHaveBeenCalledWith(
      expect.arrayContaining(['https://physics.yale.edu/fixture-lead']),
    );
    expect(deps.upsertResearchEntityMember).toHaveBeenCalledWith(
      'entity-1',
      '000000000000000000000001',
      expect.objectContaining({
        sourceUrl: 'https://physics.yale.edu/fixture-lead',
        sourceName: 'visibility-repair-queue',
      }),
    );
  });

  it('blocks exact own website PI repairs when the matched user name does not match', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_lead'],
          label: 'Fixture Researcher Lab',
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Fixture Researcher Lab',
        websiteUrl: 'https://physics.yale.edu/fixture-researcher',
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      findUserByProfileUrl: vi.fn().mockResolvedValue(null),
      findUserByExactWebsiteUrl: vi.fn().mockResolvedValue({
        _id: 'user-1',
        fname: 'Sample',
        lname: 'Person',
        netid: 'sp000',
        website: 'https://physics.yale.edu/fixture-researcher',
      }),
      upsertResearchEntityMember: vi.fn().mockResolvedValue(undefined),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'pi_identity',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 0, blocked: 1 });
    expect(deps.upsertResearchEntityMember).not.toHaveBeenCalled();
  });

  it('repairs action evidence only from source-backed records with an official lead profile', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'The lab studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        shortDescription:
          'Studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        websiteUrl: 'https://medicine.yale.edu/profile/example-faculty/',
        sourceUrls: ['https://medicine.yale.edu/profile/example-faculty/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            firstName: 'Example',
            lastName: 'Faculty',
            website: 'https://orcid.org/0000-0000-0000-0000',
            profileUrls: {
              medicine: 'https://medicine.yale.edu/profile/example-faculty/',
            },
          },
        },
      ]),
      upsertEntryPathway: vi.fn().mockResolvedValue({ pathwayId: 'pathway-1' }),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findActionEvidenceObservationIds: vi.fn().mockResolvedValue(['obs-1']),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.upsertEntryPathway).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: 'entity-1',
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
        evidenceStrength: 'WEAK',
        sourceUrls: ['https://medicine.yale.edu/profile/example-faculty/'],
        sourceEvidenceIds: ['obs-1'],
      }),
    );
    expect(deps.upsertAccessSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: 'entity-1',
        entryPathwayId: 'pathway-1',
        signalType: 'REACH_OUT_PLAUSIBLE',
        confidence: 'LOW',
        sourceEvidenceId: 'obs-1',
      }),
    );
    expect(deps.upsertContactRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: 'entity-1',
        entryPathwayId: 'pathway-1',
        routeType: 'FACULTY_PI',
        visibility: 'PUBLIC',
        contactPolicy: 'OFFICIAL_ROUTE_PREFERRED',
        url: 'https://medicine.yale.edu/profile/example-faculty/',
        sourceEvidenceIds: ['obs-1'],
      }),
    );
  });

  it('reuses an existing exploratory contact pathway for official profile action evidence', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'The lab studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        shortDescription:
          'Studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        websiteUrl: 'https://medicine.yale.edu/profile/example-faculty/',
        sourceUrls: ['https://medicine.yale.edu/profile/example-faculty/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            firstName: 'Example',
            lastName: 'Faculty',
            profileUrls: {
              medicine: 'https://medicine.yale.edu/profile/example-faculty/',
            },
          },
        },
      ]),
      findReusableExploratoryContactPathway: vi.fn().mockResolvedValue({
        pathwayId: 'existing-pathway-1',
        doc: { _id: 'existing-pathway-1', pathwayType: 'EXPLORATORY_CONTACT' },
      }),
      upsertEntryPathway: vi.fn().mockResolvedValue({ pathwayId: 'new-pathway-1' }),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findActionEvidenceObservationIds: vi.fn().mockResolvedValue(['obs-1']),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.findReusableExploratoryContactPathway).toHaveBeenCalledWith('entity-1');
    expect(deps.upsertEntryPathway).not.toHaveBeenCalled();
    expect(deps.upsertAccessSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: 'entity-1',
        entryPathwayId: 'existing-pathway-1',
        signalType: 'REACH_OUT_PLAUSIBLE',
      }),
    );
    expect(deps.upsertContactRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: 'entity-1',
        entryPathwayId: 'existing-pathway-1',
        routeType: 'FACULTY_PI',
      }),
    );
  });

  it('uses reusable pathway evidence when official profile observation lookup misses', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'The lab studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        shortDescription:
          'Studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        websiteUrl: 'https://medicine.yale.edu/profile/example-faculty/',
        sourceUrls: ['https://medicine.yale.edu/profile/example-faculty/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            firstName: 'Example',
            lastName: 'Faculty',
            profileUrls: {
              medicine: 'https://medicine.yale.edu/profile/example-faculty/',
            },
          },
        },
      ]),
      findReusableExploratoryContactPathway: vi.fn().mockResolvedValue({
        pathwayId: 'existing-pathway-1',
        doc: {
          _id: 'existing-pathway-1',
          pathwayType: 'EXPLORATORY_CONTACT',
          sourceEvidenceIds: ['existing-obs-1'],
        },
      }),
      upsertEntryPathway: vi.fn(),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findActionEvidenceObservationIds: vi.fn().mockResolvedValue([]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.upsertEntryPathway).not.toHaveBeenCalled();
    expect(deps.upsertAccessSignal).not.toHaveBeenCalled();
    expect(deps.upsertContactRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        entryPathwayId: 'existing-pathway-1',
        sourceEvidenceIds: ['existing-obs-1'],
      }),
    );
  });

  it('creates an entity-source contact route from reusable pathway evidence without a trusted lead profile', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'The lab studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        shortDescription:
          'Studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        websiteUrl: 'https://example.yale.edu/lab',
        sourceUrls: ['https://example.yale.edu/lab'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            firstName: 'Example',
            lastName: 'Faculty',
          },
        },
      ]),
      findReusableExploratoryContactPathway: vi.fn().mockResolvedValue({
        pathwayId: 'existing-pathway-1',
        doc: {
          _id: 'existing-pathway-1',
          pathwayType: 'EXPLORATORY_CONTACT',
          sourceEvidenceIds: ['existing-obs-1'],
        },
      }),
      upsertEntryPathway: vi.fn(),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findActionEvidenceObservationIds: vi.fn(),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.findActionEvidenceObservationIds).not.toHaveBeenCalled();
    expect(deps.upsertAccessSignal).not.toHaveBeenCalled();
    expect(deps.upsertContactRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        entryPathwayId: 'existing-pathway-1',
        routeType: 'UNKNOWN',
        role: 'Research entity source',
        url: 'https://example.yale.edu/lab',
        sourceEvidenceIds: ['existing-obs-1'],
      }),
    );
  });

  it('derives card descriptions from existing full descriptions when a trusted source URL follows metadata URLs', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_card_description'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'The lab studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy. The group develops computational and experimental approaches to improve patient outcomes.',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/11283508',
          'https://medicine.yale.edu/profile/example-faculty/',
        ],
      }),
      updateResearchEntity: vi.fn().mockResolvedValue(undefined),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      findUserByProfileUrl: vi.fn().mockResolvedValue(null),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.updateResearchEntity).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({
        shortDescription: expect.stringMatching(/immunology|tumor|cancer/i),
      }),
    );
  });

  it('repairs mixed source-description rows from an exact official profile user match', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_description', 'missing_lead', 'missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Priya Mehta Lab',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/11283508',
          'https://medicine.yale.edu/profile/priya-mehta/',
        ],
      }),
      updateResearchEntity: vi.fn().mockResolvedValue(undefined),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      findUserByProfileUrl: vi.fn().mockResolvedValue({
        _id: 'user-1',
        fname: 'Priya',
        lname: 'Mehta',
        bio:
          'Priya Mehta studies pediatric hematology, inherited blood disorders, and clinical outcomes for children with complex diseases.',
        researchInterests: [
          'Pediatric hematology',
          'Inherited blood disorders',
          'Clinical outcomes research',
        ],
        profileUrls: {
          medicine: 'https://medicine.yale.edu/profile/priya-mehta/',
        },
      }),
      upsertResearchEntityMember: vi.fn().mockResolvedValue(undefined),
      upsertEntryPathway: vi.fn().mockResolvedValue({ pathwayId: 'pathway-1' }),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findActionEvidenceObservationIds: vi.fn().mockResolvedValue(['obs-1']),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'source_description',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.updateResearchEntity).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({
        fullDescription: expect.stringMatching(/pediatric hematology/i),
        shortDescription: expect.stringMatching(/pediatric hematology/i),
      }),
    );
    expect(deps.upsertResearchEntityMember).toHaveBeenCalledWith(
      'entity-1',
      'user-1',
      expect.objectContaining({
        sourceUrl: 'https://medicine.yale.edu/profile/priya-mehta/',
        sourceName: 'visibility-repair-queue',
      }),
    );
    expect(deps.upsertEntryPathway).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: 'entity-1',
        pathwayType: 'EXPLORATORY_CONTACT',
        sourceUrls: ['https://medicine.yale.edu/profile/priya-mehta/'],
        sourceEvidenceIds: ['obs-1'],
      }),
    );
    expect(deps.upsertContactRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Priya Mehta',
        url: 'https://medicine.yale.edu/profile/priya-mehta/',
        sourceEvidenceIds: ['obs-1'],
      }),
    );
  });

  it('rejects mismatched person-profile URLs before creating action evidence', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'The lab studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        shortDescription:
          'Studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        websiteUrl: 'https://medicine.yale.edu/lab/chen/',
        sourceUrls: ['https://medicine.yale.edu/lab/chen/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Mei',
            lname: 'Chen',
            profileUrls: {
              east_asian_languages: 'https://eall.yale.edu/people/jiahao-chen',
            },
          },
        },
      ]),
      upsertEntryPathway: vi.fn(),
      upsertAccessSignal: vi.fn(),
      upsertContactRoute: vi.fn(),
      findActionEvidenceObservationIds: vi.fn(),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 0, blocked: 1 });
    expect(deps.findActionEvidenceObservationIds).not.toHaveBeenCalled();
    expect(deps.upsertEntryPathway).not.toHaveBeenCalled();
    expect(deps.upsertAccessSignal).not.toHaveBeenCalled();
    expect(deps.upsertContactRoute).not.toHaveBeenCalled();
  });

  it('accepts matching official profile URLs from fname and lname user fields', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'The lab studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        shortDescription:
          'Studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        websiteUrl: 'https://medicine.yale.edu/lab/chen/',
        sourceUrls: ['https://medicine.yale.edu/lab/chen/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Mei',
            lname: 'Chen',
            profileUrls: {
              medicine: 'https://medicine.yale.edu/profile/mei-chen/',
            },
          },
        },
      ]),
      upsertEntryPathway: vi.fn().mockResolvedValue({ pathwayId: 'pathway-1' }),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findActionEvidenceObservationIds: vi.fn().mockResolvedValue(['obs-1']),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.upsertEntryPathway).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrls: ['https://medicine.yale.edu/profile/mei-chen/'],
      }),
    );
    expect(deps.upsertContactRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Mei Chen',
        url: 'https://medicine.yale.edu/profile/mei-chen/',
      }),
    );
  });

  it('accepts official profile URLs that match the Yale email local-part and stored last name', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'The lab studies computational biology, machine learning, systems biology, and drug discovery.',
        shortDescription: 'Studies computational biology, machine learning, and drug discovery.',
        sourceUrls: ['https://medicine.yale.edu/profile/jordan-queue/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Jordan',
            lname: 'Queue',
            email: 'jordan.queue@yale.edu',
            profileUrls: {
              medicine: 'https://medicine.yale.edu/profile/jordan-queue/',
            },
          },
        },
      ]),
      upsertEntryPathway: vi.fn().mockResolvedValue({ pathwayId: 'pathway-1' }),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findActionEvidenceObservationIds: vi.fn().mockResolvedValue(['obs-1']),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.findActionEvidenceObservationIds).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        sourceUrl: 'https://medicine.yale.edu/profile/jordan-queue/',
      }),
    );
    expect(deps.upsertContactRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Jordan Queue',
        url: 'https://medicine.yale.edu/profile/jordan-queue/',
      }),
    );
  });

  it('keeps readable official profile slugs blocked when neither name nor email local-part matches', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'The lab studies biostatistics, epidemiologic methods, clinical trials, and longitudinal data analysis.',
        shortDescription: 'Studies biostatistics, epidemiologic methods, and clinical trials.',
        sourceUrls: ['https://medicine.yale.edu/profile/fixture-rotation-lead/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Leying',
            lname: 'Guan',
            email: 'lee.queue@yale.edu',
            profileUrls: {
              medicine: 'https://medicine.yale.edu/profile/fixture-rotation-lead/',
            },
          },
        },
      ]),
      upsertEntryPathway: vi.fn(),
      upsertAccessSignal: vi.fn(),
      upsertContactRoute: vi.fn(),
      findActionEvidenceObservationIds: vi.fn(),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 0, blocked: 1 });
    expect(deps.findActionEvidenceObservationIds).not.toHaveBeenCalled();
    expect(deps.upsertEntryPathway).not.toHaveBeenCalled();
    expect(deps.upsertContactRoute).not.toHaveBeenCalled();
  });

  it('prefers a name-matched person profile over a lead member website for action evidence', async () => {
    const profileUrl = 'https://yalemusic.yale.edu/people/daniel-harrison';
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'Research fields include musicology and musical analysis, diverse musicological studies, and music technology and sound studies.',
        shortDescription:
          'Studies musicology and musical analysis, diverse musicological studies, and music technology and sound studies.',
        sourceUrls: ['https://sites.google.com/a/yale.edu/daniel-harrison/', profileUrl],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Daniel',
            lname: 'Harrison',
            website: 'https://sites.google.com/a/yale.edu/daniel-harrison/',
            profileUrls: {
              departmental: profileUrl,
            },
          },
        },
      ]),
      upsertEntryPathway: vi.fn().mockResolvedValue({ pathwayId: 'pathway-1' }),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findActionEvidenceObservationIds: vi.fn().mockResolvedValue(['obs-1']),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.findActionEvidenceObservationIds).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: profileUrl,
      }),
    );
    expect(deps.upsertEntryPathway).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrls: [profileUrl],
      }),
    );
    expect(deps.upsertContactRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        url: profileUrl,
      }),
    );
  });

  it('uses an attached lead official profile when the profile URL matches the entity name variant', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          label: 'John D Roberts Research',
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'John D Roberts Research',
        fullDescription:
          'Studies clinical research, clinical trials, hematology, oncology, and palliative care for adults with sickle cell disease.',
        shortDescription:
          'Studies clinical research, clinical trials, hematology, oncology, and palliative care.',
        websiteUrl: 'https://medicine.yale.edu/cancer/profile/john-d-roberts/',
        sourceUrls: ['https://medicine.yale.edu/cancer/profile/john-d-roberts/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          sourceUrl: 'https://medicine.yale.edu/cancer/profile/john-d-roberts/',
          user: {
            _id: 'user-1',
            fname: 'Jackson',
            lname: 'Roberts',
            profileUrls: {
              medicine: 'https://medicine.yale.edu/cancer/profile/john-d-roberts/',
            },
          },
        },
      ]),
      upsertEntryPathway: vi.fn().mockResolvedValue({ pathwayId: 'pathway-1' }),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findActionEvidenceObservationIds: vi.fn().mockResolvedValue(['obs-1']),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.findActionEvidenceObservationIds).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        sourceUrl: 'https://medicine.yale.edu/cancer/profile/john-d-roberts/',
      }),
    );
    expect(deps.upsertContactRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'John D Roberts',
        routeType: 'FACULTY_PI',
        url: 'https://medicine.yale.edu/cancer/profile/john-d-roberts/',
      }),
    );
  });

  it('blocks action evidence repairs without any trusted lead identity', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'The lab studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        shortDescription:
          'Studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        websiteUrl: 'https://medicine.yale.edu/profile/example-faculty/',
        sourceUrls: ['https://medicine.yale.edu/profile/example-faculty/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          user: {
            profileUrls: {
              external: 'https://example.edu/profile/example-faculty/',
            },
          },
        },
      ]),
      upsertEntryPathway: vi.fn(),
      upsertAccessSignal: vi.fn(),
      upsertContactRoute: vi.fn(),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 0, blocked: 1 });
    expect(deps.upsertEntryPathway).not.toHaveBeenCalled();
    expect(deps.upsertAccessSignal).not.toHaveBeenCalled();
    expect(deps.upsertContactRoute).not.toHaveBeenCalled();
  });

  it('repairs source-backed program action evidence from entity-level undergraduate observations', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        entityType: 'PROGRAM',
        fullDescription:
          'The program supports interdisciplinary research and teaching across artificial intelligence, emerging technologies, policy, and national power.',
        shortDescription:
          'Supports interdisciplinary research and teaching across artificial intelligence, emerging technologies, policy, and national power.',
        websiteUrl: 'https://jackson.yale.edu/centers-initiatives/example-program/',
        sourceUrls: ['https://jackson.yale.edu/centers-initiatives/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      findReusableExploratoryContactPathway: vi.fn().mockResolvedValue(null),
      findEntityActionEvidenceObservationIds: vi.fn().mockResolvedValue([
        {
          id: 'obs-1',
          excerpt: 'The program places teaching undergraduate, graduate, and professional students at the core of its mission.',
          sourceUrl: 'https://jackson.yale.edu/centers-initiatives/',
          sourceName: 'research-entity-cache-backfill',
        },
      ]),
      upsertEntryPathway: vi.fn().mockResolvedValue({ pathwayId: 'pathway-1' }),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.findEntityActionEvidenceObservationIds).toHaveBeenCalledWith({
      researchEntityId: 'entity-1',
      sourceUrl: 'https://jackson.yale.edu/centers-initiatives/example-program/',
      sourceUrls: [
        'https://jackson.yale.edu/centers-initiatives/example-program/',
        'https://jackson.yale.edu/centers-initiatives/',
      ],
    });
    expect(deps.upsertEntryPathway).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: 'entity-1',
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
        evidenceStrength: 'WEAK',
        sourceEvidenceIds: ['obs-1'],
        sourceUrls: [
          'https://jackson.yale.edu/centers-initiatives/',
          'https://jackson.yale.edu/centers-initiatives/example-program/',
        ],
        derivationKey: 'visibility-repair:entity-source-outreach:entity-1',
      }),
    );
    expect(deps.upsertAccessSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: 'entity-1',
        entryPathwayId: 'pathway-1',
        signalType: 'REACH_OUT_PLAUSIBLE',
        confidence: 'LOW',
        sourceEvidenceId: 'obs-1',
        sourceName: 'research-entity-cache-backfill',
        sourceUrl: 'https://jackson.yale.edu/centers-initiatives/',
      }),
    );
    expect(deps.upsertContactRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: 'entity-1',
        entryPathwayId: 'pathway-1',
        routeType: 'UNKNOWN',
        role: 'Research entity source',
        url: 'https://jackson.yale.edu/centers-initiatives/example-program/',
        sourceEvidenceIds: ['obs-1'],
      }),
    );
  });

  it('repairs mixed PI rows with entity-level action evidence while keeping missing lead blocked', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_lead', 'missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        entityType: 'CENTER',
        kind: 'center',
        fullDescription:
          'The center supports interdisciplinary teaching and research focused on generating actionable knowledge that contributes to strategic statecraft.',
        shortDescription:
          'Supports interdisciplinary teaching and research focused on generating actionable knowledge for strategic statecraft.',
        websiteUrl: 'https://jackson.yale.edu/centers-initiatives/blue-center/',
        sourceUrls: [
          'https://jackson.yale.edu/centers-initiatives/',
          'https://jackson.yale.edu/centers-initiatives/blue-center/',
        ],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      findUserByProfileUrl: vi.fn().mockResolvedValue(null),
      findUserByExactWebsiteUrl: vi.fn().mockResolvedValue(null),
      findEntityActionEvidenceObservationIds: vi.fn().mockResolvedValue([
        {
          id: 'obs-1',
          excerpt: 'The Blue Center supports teaching at both the undergraduate and graduate levels.',
          sourceUrl: 'https://jackson.yale.edu/centers-initiatives/',
          sourceName: 'research-entity-cache-backfill',
        },
      ]),
      upsertResearchEntityMember: vi.fn(),
      upsertEntryPathway: vi.fn().mockResolvedValue({ pathwayId: 'pathway-1' }),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 0 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'pi_identity',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 0, blocked: 1 });
    expect(report.attempts[0]).toMatchObject({
      applied: true,
      status: 'blocked',
      remainingBlockers: ['missing_lead'],
      repairSource: 'https://jackson.yale.edu/centers-initiatives/',
    });
    expect(deps.upsertResearchEntityMember).not.toHaveBeenCalled();
    expect(deps.findEntityActionEvidenceObservationIds).toHaveBeenCalledWith({
      researchEntityId: 'entity-1',
      sourceUrl: 'https://jackson.yale.edu/centers-initiatives/blue-center/',
      sourceUrls: [
        'https://jackson.yale.edu/centers-initiatives/blue-center/',
        'https://jackson.yale.edu/centers-initiatives/',
      ],
    });
    expect(deps.upsertEntryPathway).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: 'entity-1',
        pathwayType: 'EXPLORATORY_CONTACT',
        sourceEvidenceIds: ['obs-1'],
      }),
    );
    expect(deps.updateQueueItem).toHaveBeenCalledWith(
      'queue-1',
      expect.objectContaining({
        repairStatus: 'blocked',
        remainingBlockers: ['missing_lead'],
      }),
    );
    expect(deps.runGate).toHaveBeenCalledWith('research', ['entity-1'], 'apply');
  });

  it('blocks source-backed program action evidence when entity observations are missing', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        entityType: 'PROGRAM',
        fullDescription:
          'The program supports interdisciplinary research and teaching across climate, communication, public policy, and environmental decision making.',
        shortDescription:
          'Supports interdisciplinary research and teaching across climate, communication, public policy, and environmental decision making.',
        websiteUrl: 'https://environment.yale.edu/example-program',
        sourceUrls: ['https://environment.yale.edu/example-program'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([]),
      findReusableExploratoryContactPathway: vi.fn().mockResolvedValue(null),
      findEntityActionEvidenceObservationIds: vi.fn().mockResolvedValue([]),
      upsertEntryPathway: vi.fn(),
      upsertAccessSignal: vi.fn(),
      upsertContactRoute: vi.fn(),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 0, blocked: 1 });
    expect(report.attempts[0].remainingBlockers).toContain('missing_source_evidence');
    expect(deps.upsertEntryPathway).not.toHaveBeenCalled();
    expect(deps.upsertAccessSignal).not.toHaveBeenCalled();
    expect(deps.upsertContactRoute).not.toHaveBeenCalled();
  });

  it('repairs action evidence from a non-official lead profile source when no official source exists', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'The lab studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        shortDescription:
          'Studies translational immunology, tumor microenvironments, and immune-cell engineering for cancer therapy.',
        websiteUrl: 'https://chemistry.yale.edu/example-lab',
        sourceUrls: ['https://chemistry.yale.edu/example-lab'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            firstName: 'Example',
            lastName: 'Faculty',
            website: 'https://example.edu/profile/example-faculty/',
            profileUrls: {
              external: 'https://example.edu/profile/example-faculty/',
            },
          },
        },
      ]),
      upsertEntryPathway: vi.fn().mockResolvedValue({ pathwayId: 'pathway-1' }),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findActionEvidenceObservationIds: vi.fn().mockResolvedValue(['obs-1']),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.upsertEntryPathway).toHaveBeenCalledWith(
      expect.objectContaining({
        researchEntityId: 'entity-1',
        pathwayType: 'EXPLORATORY_CONTACT',
        status: 'PLAUSIBLE',
        sourceUrls: ['https://example.edu/profile/example-faculty/'],
        sourceEvidenceIds: ['obs-1'],
      }),
    );
  });

  it('repairs action evidence from opaque Yale Medicine profile slugs that match PI initials', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          label: 'Bradley Reeves Lab',
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Bradley Reeves Lab',
        fullDescription:
          'The lab studies B cell dysfunction in inflammatory neuropathies and autoimmune neuromuscular disorders using bioinformatics and molecular biology.',
        shortDescription:
          'Studies B cell dysfunction in inflammatory neuropathies and autoimmune neuromuscular disorders.',
        sourceUrls: ['https://medicine.yale.edu/profile/br574/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Bradley',
            lname: 'Reeves',
            profileUrls: {
              medicine: 'https://medicine.yale.edu/profile/br574/',
            },
          },
        },
      ]),
      upsertEntryPathway: vi.fn().mockResolvedValue({ pathwayId: 'pathway-1' }),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findActionEvidenceObservationIds: vi.fn().mockResolvedValue(['obs-1']),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.findActionEvidenceObservationIds).toHaveBeenCalledWith({
      researchEntityId: 'entity-1',
      userId: 'user-1',
      sourceUrl: 'https://medicine.yale.edu/profile/br574/',
    });
    expect(deps.upsertContactRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        routeType: 'FACULTY_PI',
        url: 'https://medicine.yale.edu/profile/br574/',
      }),
    );
  });

  it('does not repair action evidence from readable wrong-person Yale profile slugs', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          label: 'Lee Queue Lab',
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        name: 'Lee Queue Lab',
        fullDescription:
          'The lab studies statistical methods for biomedical imaging and public health data.',
        shortDescription: 'Studies statistical methods for biomedical imaging and public health data.',
        sourceUrls: ['https://medicine.yale.edu/profile/fixture-rotation-lead/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Leying',
            lname: 'Guan',
            profileUrls: {
              medicine: 'https://medicine.yale.edu/profile/fixture-rotation-lead/',
            },
          },
        },
      ]),
      upsertEntryPathway: vi.fn(),
      upsertAccessSignal: vi.fn(),
      upsertContactRoute: vi.fn(),
      findActionEvidenceObservationIds: vi.fn(),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn(),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 0, blocked: 1 });
    expect(report.attempts[0].remainingBlockers).toContain('missing_source_evidence');
    expect(deps.findActionEvidenceObservationIds).not.toHaveBeenCalled();
    expect(deps.upsertContactRoute).not.toHaveBeenCalled();
  });

  it('uses entity source action evidence instead of creating ORCID contact routes', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'The center studies infectious disease modeling, public health interventions, and health policy through interdisciplinary data science.',
        shortDescription:
          'Studies infectious disease modeling, public health interventions, and health policy through interdisciplinary data science.',
        websiteUrl: 'https://cidma.us/',
        sourceUrls: ['https://orcid.org/0000-0002-2059-6716', 'https://cidma.us/'],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          user: {
            _id: 'user-1',
            fname: 'Alison',
            lname: 'Galvani',
            profileUrls: {
              orcid: 'https://orcid.org/0000-0002-2059-6716',
            },
          },
        },
      ]),
      upsertEntryPathway: vi.fn().mockResolvedValue({ pathwayId: 'pathway-1' }),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findActionEvidenceObservationIds: vi.fn().mockResolvedValue([]),
      findEntityActionEvidenceObservationIds: vi.fn().mockResolvedValue([
        {
          id: 'obs-1',
          sourceUrl: 'https://cidma.us/',
          sourceName: 'lab-microsite-description-llm',
          excerpt: 'The center hosts interdisciplinary infectious disease modeling research.',
        },
      ]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.findActionEvidenceObservationIds).not.toHaveBeenCalled();
    expect(deps.findEntityActionEvidenceObservationIds).toHaveBeenCalledWith({
      researchEntityId: 'entity-1',
      sourceUrl: 'https://cidma.us/',
      sourceUrls: ['https://cidma.us/', 'https://orcid.org/0000-0002-2059-6716'],
    });
    expect(deps.upsertEntryPathway).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrls: ['https://cidma.us/'],
        sourceEvidenceIds: ['obs-1'],
      }),
    );
    expect(deps.upsertContactRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        routeType: 'UNKNOWN',
        role: 'Research entity source',
        url: 'https://cidma.us/',
        sourceEvidenceIds: ['obs-1'],
      }),
    );
  });

  it('prefers official profile entity action evidence over grant project pages', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          blockerReasons: ['missing_action_evidence'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn().mockResolvedValue({
        _id: 'entity-1',
        fullDescription:
          'The center studies infectious disease modeling, public health interventions, and health policy through interdisciplinary data science.',
        shortDescription:
          'Studies infectious disease modeling, public health interventions, and health policy through interdisciplinary data science.',
        websiteUrl: 'https://cidma.us/',
        sourceUrls: [
          'https://reporter.nih.gov/project-details/10774311',
          'https://medicine.yale.edu/profile/fixture-modeling-lead/',
          'https://cidma.us/',
        ],
      }),
      updateResearchEntity: vi.fn(),
      findResearchEntityMembers: vi.fn().mockResolvedValue([
        {
          role: 'pi',
          userId: 'user-1',
          sourceUrl: 'https://reporter.nih.gov/project-details/10774311',
          user: {
            _id: 'user-1',
            fname: 'Alison',
            lname: 'Galvani',
          },
        },
      ]),
      upsertEntryPathway: vi.fn().mockResolvedValue({ pathwayId: 'pathway-1' }),
      upsertAccessSignal: vi.fn().mockResolvedValue({ signalId: 'signal-1' }),
      upsertContactRoute: vi.fn().mockResolvedValue({ contactRouteId: 'route-1' }),
      findActionEvidenceObservationIds: vi.fn().mockResolvedValue([]),
      findEntityActionEvidenceObservationIds: vi.fn().mockResolvedValue([
        {
          id: 'obs-1',
          sourceUrl: 'https://medicine.yale.edu/profile/fixture-modeling-lead/',
          sourceName: 'official-profile-pi-backfill',
        },
      ]),
      findProgram: vi.fn(),
      updateProgram: vi.fn(),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 1 } }),
    };

    const report = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'research',
        stage: 'action_evidence',
        limit: 1,
      },
      deps,
    );

    expect(report).toMatchObject({ repaired: 1, blocked: 0, resolvedByGate: 1 });
    expect(deps.findActionEvidenceObservationIds).not.toHaveBeenCalled();
    expect(deps.findEntityActionEvidenceObservationIds).toHaveBeenCalledWith({
      researchEntityId: 'entity-1',
      sourceUrl: 'https://medicine.yale.edu/profile/fixture-modeling-lead/',
      sourceUrls: [
        'https://medicine.yale.edu/profile/fixture-modeling-lead/',
        'https://cidma.us/',
        'https://reporter.nih.gov/project-details/10774311',
      ],
    });
    expect(deps.upsertContactRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        routeType: 'UNKNOWN',
        role: 'Research entity source',
        url: 'https://medicine.yale.edu/profile/fixture-modeling-lead/',
      }),
    );
  });

  it('only suppresses suppression-stage records when explicitly requested', async () => {
    const deps = {
      findOpenQueueItems: vi.fn().mockResolvedValue([
        queueItem({
          collection: 'programs',
          blockerReasons: ['archive_review', 'not_undergraduate_relevant'],
        }),
      ]),
      updateQueueItem: vi.fn().mockResolvedValue(undefined),
      findResearchEntity: vi.fn(),
      updateResearchEntity: vi.fn(),
      findProgram: vi.fn(),
      updateProgram: vi.fn().mockResolvedValue(undefined),
      runGate: vi.fn().mockResolvedValue({ counts: { resolved: 0 } }),
    };

    const blocked = await runVisibilityRepairQueue(
      { mode: 'apply', collection: 'programs', stage: 'suppression' },
      deps,
    );
    expect(blocked).toMatchObject({ repaired: 0, blocked: 1 });
    expect(deps.updateProgram).not.toHaveBeenCalled();

    const suppressed = await runVisibilityRepairQueue(
      {
        mode: 'apply',
        collection: 'programs',
        stage: 'suppression',
        suppressUnsafe: true,
      },
      deps,
    );

    expect(suppressed).toMatchObject({ repaired: 1, blocked: 0 });
    expect(deps.updateProgram).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({
        studentVisibilityOverrideTier: 'suppressed',
        studentVisibilitySuppressionReason: expect.stringContaining('archive_review'),
      }),
    );
  });
});
