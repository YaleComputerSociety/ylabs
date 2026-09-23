import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async (_entityType: string, docs: unknown[]) => docs.length),
  readIndexedFieldByDocumentId: vi.fn(
    async (_entityType: string, _field: string) => new Map<string, unknown>(),
  ),
  researchBulkWrite: vi.fn(async (..._args: unknown[]) => ({})),
  fellowshipBulkWrite: vi.fn(async (..._args: unknown[]) => ({})),
  queueBulkWrite: vi.fn(async (..._args: unknown[]) => ({})),
  queueUpdateMany: vi.fn(async (..._args: unknown[]) => ({ modifiedCount: 0 })),
  researchUpdateMany: vi.fn(async (..._args: unknown[]) => ({ modifiedCount: 0 })),
  researchDocsById: new Map<string, Record<string, unknown>>(),
}));

const leanChain = (docs: unknown[]) => ({
  lean: async () => docs,
  select: () => ({ lean: async () => docs }),
});

vi.mock('../meiliSyncService', () => ({
  syncEntities: (entityType: string, docs: unknown[]) => mocks.syncEntities(entityType, docs),
  readIndexedFieldByDocumentId: (entityType: string, field: string) =>
    mocks.readIndexedFieldByDocumentId(entityType, field),
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    bulkWrite: (...args: unknown[]) => mocks.researchBulkWrite(...args),
    updateMany: (...args: unknown[]) => mocks.researchUpdateMany(...args),
    find: (query: any) => {
      if (query?.archived === true) return leanChain([]);
      const ids: unknown[] = query?._id?.$in ?? [];
      const docs = ids
        .map((id) => mocks.researchDocsById.get(String(id)))
        .filter((doc): doc is Record<string, unknown> => Boolean(doc));
      return leanChain(docs);
    },
  },
}));

vi.mock('../../models/fellowship', () => ({
  Fellowship: {
    bulkWrite: (...args: unknown[]) => mocks.fellowshipBulkWrite(...args),
  },
}));

vi.mock('../../models/visibilityReleaseQueueItem', () => ({
  VisibilityReleaseQueueItem: {
    find: () => leanChain([]),
    updateMany: (...args: unknown[]) => mocks.queueUpdateMany(...args),
    bulkWrite: (...args: unknown[]) => mocks.queueBulkWrite(...args),
  },
}));

import {
  applyStudentVisibilityGatePlans,
  studentVisibilityGateIndexSyncBlocker,
  type StudentVisibilityGatePlan,
} from '../studentVisibilityGateService';

const objectIdHex = (suffix: number): string =>
  `${suffix.toString(16).padStart(24, '0')}`.slice(-24);

const changedPlan = (recordId: string): StudentVisibilityGatePlan => ({
  collection: 'research',
  recordId,
  label: 'Changed Lab',
  currentTier: 'operator_review',
  computedTier: 'student_ready',
  tier: 'student_ready',
  reasons: ['source_backed_description', 'concrete_next_step'],
  sourceNames: ['department-undergrad-research'],
  nextRepairAction: 'Operator review.',
});

const unchangedPlan = (recordId: string): StudentVisibilityGatePlan => ({
  ...changedPlan(recordId),
  currentTier: 'student_ready',
  currentComputedTier: 'student_ready',
  currentReasons: ['source_backed_description', 'concrete_next_step'],
  computedTier: 'student_ready',
  tier: 'student_ready',
});

beforeEach(() => {
  mocks.syncEntities.mockClear();
  mocks.syncEntities.mockImplementation(async (_entityType: string, docs: unknown[]) => docs.length);
  mocks.readIndexedFieldByDocumentId.mockClear();
  mocks.readIndexedFieldByDocumentId.mockImplementation(async () => new Map<string, unknown>());
  mocks.researchBulkWrite.mockClear();
  mocks.researchDocsById.clear();
});

describe('applyStudentVisibilityGatePlans Meili sync', () => {
  it('re-syncs the research entities it wrote to the search index', async () => {
    const recordId = objectIdHex(1);
    mocks.researchDocsById.set(recordId, { _id: recordId, slug: 'changed-lab' });

    await applyStudentVisibilityGatePlans([changedPlan(recordId)]);

    expect(mocks.researchBulkWrite).toHaveBeenCalledTimes(1);
    expect(mocks.syncEntities).toHaveBeenCalledTimes(1);
    const [entityType, docs] = mocks.syncEntities.mock.calls[0];
    expect(entityType).toBe('researchEntity');
    expect(docs).toEqual([{ _id: recordId, slug: 'changed-lab' }]);
  });

  it('chunks the re-sync so a large re-gate does not load the corpus at once', async () => {
    const recordIds = Array.from({ length: 501 }, (_, index) => objectIdHex(index + 1));
    for (const recordId of recordIds) {
      mocks.researchDocsById.set(recordId, { _id: recordId, slug: `lab-${recordId}` });
    }

    await applyStudentVisibilityGatePlans(recordIds.map((recordId) => changedPlan(recordId)));

    expect(mocks.syncEntities).toHaveBeenCalledTimes(2);
    expect((mocks.syncEntities.mock.calls[0][1] as unknown[]).length).toBe(500);
    expect((mocks.syncEntities.mock.calls[1][1] as unknown[]).length).toBe(1);
  });

  it('does not sync when no research plan materially changed', async () => {
    await applyStudentVisibilityGatePlans([
      {
        ...changedPlan(objectIdHex(1)),
        currentTier: 'student_ready',
        computedTier: 'student_ready',
        tier: 'student_ready',
      },
    ]);

    expect(mocks.syncEntities).not.toHaveBeenCalled();
  });

  // The stamp is what makes a re-gate verifiable, so it has to be written for a row the
  // gate re-decided and left alone, without dragging that row into the resync (#2604).
  it('stamps the evaluation of an unchanged row without re-syncing it', async () => {
    const recordId = objectIdHex(1);
    mocks.researchDocsById.set(recordId, { _id: recordId, slug: 'unchanged-lab' });

    await applyStudentVisibilityGatePlans([unchangedPlan(recordId)]);

    expect(mocks.researchBulkWrite).toHaveBeenCalledTimes(1);
    const writes = mocks.researchBulkWrite.mock.calls[0][0] as Array<{
      updateOne: {
        filter: Record<string, unknown>;
        update: { $set: Record<string, unknown> };
        timestamps?: boolean;
      };
    }>;
    expect(writes).toHaveLength(1);
    expect(writes[0].updateOne.filter).toEqual({ _id: recordId });
    expect(Object.keys(writes[0].updateOne.update.$set)).toEqual(['studentVisibilityEvaluatedAt']);
    expect(writes[0].updateOne.update.$set.studentVisibilityEvaluatedAt).toBeInstanceOf(Date);
    expect(writes[0].updateOne.timestamps).toBe(false);
    expect(mocks.syncEntities).not.toHaveBeenCalled();
  });
});

describe('applyStudentVisibilityGatePlans index divergence repair', () => {
  it('re-syncs a row the index disagrees with even though no plan materially changed', async () => {
    const recordId = objectIdHex(7);
    mocks.researchDocsById.set(recordId, {
      _id: recordId,
      slug: 'stale-in-index-lab',
      studentVisibilityTier: 'operator_review',
    });
    mocks.readIndexedFieldByDocumentId.mockImplementation(
      async () => new Map<string, unknown>([[recordId, 'student_ready']]),
    );

    const result = await applyStudentVisibilityGatePlans([unchangedPlan(recordId)]);

    expect(result.divergentTierRecordIds).toEqual([recordId]);
    expect(result.syncedRecordIds).toEqual([recordId]);
    expect(result.unsyncedRecordIds).toEqual([]);
    expect(studentVisibilityGateIndexSyncBlocker(result)).toBeUndefined();
    expect(mocks.syncEntities).toHaveBeenCalledTimes(1);
    expect(mocks.syncEntities.mock.calls[0][1]).toEqual([
      { _id: recordId, slug: 'stale-in-index-lab', studentVisibilityTier: 'operator_review' },
    ]);
  });

  it('leaves a row the index already agrees with alone', async () => {
    const recordId = objectIdHex(8);
    mocks.researchDocsById.set(recordId, {
      _id: recordId,
      slug: 'agreeing-lab',
      studentVisibilityTier: 'student_ready',
    });
    mocks.readIndexedFieldByDocumentId.mockImplementation(
      async () => new Map<string, unknown>([[recordId, 'student_ready']]),
    );

    const result = await applyStudentVisibilityGatePlans([unchangedPlan(recordId)]);

    expect(result.divergentTierRecordIds).toEqual([]);
    expect(result.missingFromIndex).toBe(0);
    expect(mocks.syncEntities).not.toHaveBeenCalled();
  });

  it('counts a planned row the index does not hold without pushing the corpus at it', async () => {
    const recordId = objectIdHex(9);
    mocks.researchDocsById.set(recordId, {
      _id: recordId,
      slug: 'absent-from-index-lab',
      studentVisibilityTier: 'student_ready',
    });

    const result = await applyStudentVisibilityGatePlans([unchangedPlan(recordId)]);

    expect(result.missingFromIndex).toBe(1);
    expect(result.divergentTierRecordIds).toEqual([]);
    expect(mocks.syncEntities).not.toHaveBeenCalled();
  });

  it('records the rows a failed index write left divergent instead of reporting a clean apply', async () => {
    const recordId = objectIdHex(10);
    mocks.researchDocsById.set(recordId, {
      _id: recordId,
      slug: 'unsynced-lab',
      studentVisibilityTier: 'operator_review',
    });
    mocks.readIndexedFieldByDocumentId.mockImplementation(
      async () => new Map<string, unknown>([[recordId, 'student_ready']]),
    );
    mocks.syncEntities.mockImplementation(async () => 0);

    const result = await applyStudentVisibilityGatePlans([unchangedPlan(recordId)]);

    expect(result.syncedRecordIds).toEqual([]);
    expect(result.unsyncedRecordIds).toEqual([recordId]);
    expect(studentVisibilityGateIndexSyncBlocker(result)).toContain('rejected 1 of 1');
  });

  it('reports an unreadable index rather than treating it as no drift', async () => {
    const recordId = objectIdHex(11);
    mocks.researchDocsById.set(recordId, { _id: recordId, slug: 'unreadable-index-lab' });
    mocks.readIndexedFieldByDocumentId.mockImplementation(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    const result = await applyStudentVisibilityGatePlans([unchangedPlan(recordId)]);

    expect(result.indexReadFailed).toBe(true);
    expect(studentVisibilityGateIndexSyncBlocker(result)).toContain('Could not read the search index');
  });
});
