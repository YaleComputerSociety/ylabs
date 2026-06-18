import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => ({
  researchEntityFind: vi.fn(),
  researchEntityCountDocuments: vi.fn(),
  researchEntityFindByIdAndUpdate: vi.fn(),
  entryPathwayFindByIdAndUpdate: vi.fn(),
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    find: mocks.researchEntityFind,
    countDocuments: mocks.researchEntityCountDocuments,
    findByIdAndUpdate: mocks.researchEntityFindByIdAndUpdate,
  },
}));

vi.mock('../../models/entryPathway', () => ({
  EntryPathway: {
    aggregate: vi.fn(),
    findByIdAndUpdate: mocks.entryPathwayFindByIdAndUpdate,
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

import {
  normalizeAccessReviewObjectId,
  normalizeAccessReviewLockedFields,
  updateAccessReviewManualLocks,
  updateAccessReviewRecordReview,
  listAccessReviewEntities,
} from '../adminAccessReviewService';

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

  it('normalizes access review locked fields as bounded identifiers', () => {
    const normalized = normalizeAccessReviewLockedFields([
      ' summary ',
      'summary',
      'review.lockedFields',
      'field-name:ok_1',
      'bad$field',
      'x'.repeat(121),
      '',
      123,
    ]);

    expect(normalized).toEqual(['summary', 'review.lockedFields', 'field-name:ok_1']);
  });

  it('normalizes access review ObjectIds without arbitrary object coercion', () => {
    const id = '64f111111111111111111111';

    expect(normalizeAccessReviewObjectId(id)?.toHexString()).toBe(id);
    expect(normalizeAccessReviewObjectId(new mongoose.Types.ObjectId(id))?.toHexString()).toBe(id);
    expect(
      normalizeAccessReviewObjectId({
        toString: () => id,
      }),
    ).toBeNull();
  });

  it('normalizes manual lock fields before persisting research entities', async () => {
    const id = '64f111111111111111111111';
    const chain = {
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ _id: id, manuallyLockedFields: ['summary'] }),
    };
    mocks.researchEntityFindByIdAndUpdate.mockReturnValue(chain);

    await updateAccessReviewManualLocks(id, [
      ' summary ',
      'bad$field',
      'x'.repeat(121),
      'review.lockedFields',
    ]);

    const [updatedId, update] = mocks.researchEntityFindByIdAndUpdate.mock.calls[0];
    expect(String(updatedId)).toBe(id);
    expect(update).toEqual({
      $set: { manuallyLockedFields: ['summary', 'review.lockedFields'] },
    });
  });

  it('normalizes record review lock fields before persisting review metadata', async () => {
    const id = '64f222222222222222222222';
    const chain = {
      lean: vi.fn().mockResolvedValue({ _id: id }),
    };
    mocks.entryPathwayFindByIdAndUpdate.mockReturnValue(chain);

    await updateAccessReviewRecordReview({
      type: 'entryPathway',
      id,
      lockedFields: [' sourceUrl ', 'bad$field', 'x'.repeat(121), 'sourceUrl'],
    });

    const [updatedId, update] = mocks.entryPathwayFindByIdAndUpdate.mock.calls[0];
    expect(String(updatedId)).toBe(id);
    expect(update).toEqual({
      $set: { 'review.lockedFields': ['sourceUrl'] },
    });
  });

  it('ignores object-shaped reviewer ids before persisting review metadata', async () => {
    const id = '64f222222222222222222222';
    const chain = {
      lean: vi.fn().mockResolvedValue({ _id: id }),
    };
    mocks.entryPathwayFindByIdAndUpdate.mockReturnValue(chain);

    await updateAccessReviewRecordReview({
      type: 'entryPathway',
      id,
      status: 'approved',
      reviewerId: {
        toString: () => '64f333333333333333333333',
      },
    });

    const [, update] = mocks.entryPathwayFindByIdAndUpdate.mock.calls[0];
    expect(update.$set).toMatchObject({
      'review.status': 'approved',
    });
    expect(update.$set).not.toHaveProperty('review.reviewedByUserId');
  });
});
