import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async (_entityType: string, _docs: unknown[]) => {}),
  researchBulkWrite: vi.fn(async (..._args: unknown[]) => ({})),
  fellowshipBulkWrite: vi.fn(async (..._args: unknown[]) => ({})),
  queueBulkWrite: vi.fn(async (..._args: unknown[]) => ({})),
  queueUpdateMany: vi.fn(async (..._args: unknown[]) => ({ modifiedCount: 0 })),
  researchDocsById: new Map<string, Record<string, unknown>>(),
}));

const leanChain = (docs: unknown[]) => ({
  lean: async () => docs,
  select: () => ({ lean: async () => docs }),
});

vi.mock('../meiliSyncService', () => ({
  syncEntities: (entityType: string, docs: unknown[]) => mocks.syncEntities(entityType, docs),
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    bulkWrite: (...args: unknown[]) => mocks.researchBulkWrite(...args),
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

beforeEach(() => {
  mocks.syncEntities.mockClear();
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
});
