import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  researchEntityFind: vi.fn(),
  researchEntityCountDocuments: vi.fn(),
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    find: mocks.researchEntityFind,
    countDocuments: mocks.researchEntityCountDocuments,
  },
}));

vi.mock('../../models/entryPathway', () => ({
  EntryPathway: {
    aggregate: vi.fn(),
  },
}));

vi.mock('../../models/accessSignal', () => ({
  AccessSignal: {
    aggregate: vi.fn(),
  },
}));

vi.mock('../../models/contactRoute', () => ({
  ContactRoute: {
    aggregate: vi.fn(),
  },
}));

vi.mock('../../models/postedOpportunity', () => ({
  PostedOpportunity: {
    aggregate: vi.fn(),
  },
}));

vi.mock('../../models/observation', () => ({
  Observation: {
    find: vi.fn(),
  },
}));

import { listAccessReviewEntities } from '../adminAccessReviewService';

const findChain = () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue([]),
  };
  mocks.researchEntityFind.mockReturnValue(chain);
  return chain;
};

describe('adminAccessReviewService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caps access review page before building Mongo skip and limit values', async () => {
    const chain = findChain();
    mocks.researchEntityCountDocuments.mockResolvedValue(0);

    const result = await listAccessReviewEntities({
      page: 999_999_999,
      pageSize: 500,
    });

    expect(chain.skip).toHaveBeenCalledWith(99_900);
    expect(chain.limit).toHaveBeenCalledWith(100);
    expect(result).toMatchObject({
      entities: [],
      total: 0,
      page: 1000,
      pageSize: 100,
      totalPages: 0,
    });
  });

  it('rejects oversized access review search before model lookup', async () => {
    await expect(
      listAccessReviewEntities({
        search: 'a'.repeat(121),
      }),
    ).rejects.toThrow('Search query is too long');

    expect(mocks.researchEntityFind).not.toHaveBeenCalled();
    expect(mocks.researchEntityCountDocuments).not.toHaveBeenCalled();
  });
});
