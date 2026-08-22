import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  bulkWrite: vi.fn(),
  aggregate: vi.fn(),
  distinct: vi.fn(),
  signalFind: vi.fn(),
  roster: vi.fn(),
  queueBulkWrite: vi.fn(),
  queueFind: vi.fn(),
  resolveArchived: vi.fn(),
}));

vi.mock('../../models/researchEntity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/researchEntity')>()),
  ResearchEntity: {
    find: mocks.find,
    bulkWrite: mocks.bulkWrite,
  },
}));

vi.mock('../../models/signal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/signal')>()),
  Signal: {
    aggregate: mocks.aggregate,
    distinct: mocks.distinct,
    find: mocks.signalFind,
  },
}));

vi.mock('../../models/visibilityReleaseQueueItem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/visibilityReleaseQueueItem')>()),
  VisibilityReleaseQueueItem: {
    bulkWrite: mocks.queueBulkWrite,
    find: mocks.queueFind,
    updateMany: mocks.resolveArchived,
  },
}));

vi.mock('../researchEntityMembershipAccessor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../researchEntityMembershipAccessor')>()),
  getResearchEntityRosterByEntityId: mocks.roster,
}));

import { runStudentVisibilityGate } from '../studentVisibilityGateService';

const leadlessLabEntities = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    _id: `lab-${index}`,
    name: `Lab ${index}`,
    slug: `lab-${index}`,
    entityType: 'LAB',
    kind: 'lab',
  }));

const stubResearchEntityFind = (entities: unknown[]) => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(entities),
  };
  mocks.find.mockReturnValue(chain);
};

describe('runStudentVisibilityGate apply guard', () => {
  beforeEach(() => {
    mocks.aggregate.mockResolvedValue([]);
    mocks.distinct.mockResolvedValue([]);
    mocks.signalFind.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    });
    mocks.roster.mockResolvedValue(new Map());
    mocks.bulkWrite.mockResolvedValue(undefined);
    mocks.queueBulkWrite.mockResolvedValue(undefined);
    mocks.queueFind.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    });
    mocks.resolveArchived.mockResolvedValue({ modifiedCount: 0 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('refuses to apply and writes nothing when the canonical roster resolves zero leads', async () => {
    stubResearchEntityFind(leadlessLabEntities(30));

    await expect(
      runStudentVisibilityGate({ collection: 'research', mode: 'apply' }),
    ).rejects.toThrow(/Refusing to apply student visibility gate/);

    expect(mocks.bulkWrite).not.toHaveBeenCalled();
    expect(mocks.queueBulkWrite).not.toHaveBeenCalled();
  });

  it('still applies for a scoped roster too small to enforce the empty-roster guard', async () => {
    stubResearchEntityFind(leadlessLabEntities(5));

    const report = await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    expect(report.mode).toBe('apply');
    expect(mocks.bulkWrite).toHaveBeenCalledTimes(1);
  });
});
