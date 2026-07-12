import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => ({
  researchEntityFind: vi.fn(),
  researchEntityCountDocuments: vi.fn(),
  researchEntityFindByIdAndUpdate: vi.fn(),
  researchEntityAggregate: vi.fn(),
  entryPathwayFindByIdAndUpdate: vi.fn(),
  countDocuments: vi.fn(),
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    find: mocks.researchEntityFind,
    countDocuments: mocks.researchEntityCountDocuments,
    findByIdAndUpdate: mocks.researchEntityFindByIdAndUpdate,
    aggregate: mocks.researchEntityAggregate,
  },
}));

vi.mock('../../models/entryPathway', () => ({
  EntryPathway: {
    aggregate: vi.fn(),
    findByIdAndUpdate: mocks.entryPathwayFindByIdAndUpdate,
    countDocuments: mocks.countDocuments,
  },
}));

vi.mock('../../models/accessSignal', () => ({
  AccessSignal: {
    aggregate: vi.fn(),
    countDocuments: mocks.countDocuments,
  },
}));

vi.mock('../../models/contactRoute', () => ({
  ContactRoute: {
    aggregate: vi.fn(),
    countDocuments: mocks.countDocuments,
  },
}));

vi.mock('../../models/postedOpportunity', () => ({
  PostedOpportunity: {
    aggregate: vi.fn(),
    countDocuments: mocks.countDocuments,
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
  redactAccessReviewContactRoute,
} from '../adminAccessReviewService';

describe('adminAccessReviewService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caps access review page before building Mongo skip and limit values', async () => {
    mocks.researchEntityAggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([{ rows: [], meta: [] }]) });
    mocks.countDocuments.mockResolvedValue(0);

    const result = await listAccessReviewEntities({
      page: 999_999_999,
      pageSize: 500,
    });

    const pipeline = mocks.researchEntityAggregate.mock.calls[0][0];
    expect(pipeline.at(-1).$facet.rows).toEqual([{ $skip: 99_900 }, { $limit: 100 }]);
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

    expect(mocks.researchEntityAggregate).not.toHaveBeenCalled();
    expect(mocks.researchEntityCountDocuments).not.toHaveBeenCalled();
  });

  it('filters and sorts the queue by aggregate unreviewed work without returning record data', async () => {
    mocks.researchEntityAggregate.mockReturnValue({
      exec: vi.fn().mockResolvedValue([{ rows: [{
        _id: new mongoose.Types.ObjectId('64f111111111111111111111'),
        name: 'Example Lab', slug: 'example', _pathways: [{ status: 'unreviewed' }],
        _signals: [], _routes: [], _opportunities: [{ status: 'approved', applicationUrl: 'https://example.edu/apply' }],
        totalUnreviewed: 1, hasOfficialApplication: true,
      }], meta: [{ total: 1 }] }]),
    });
    mocks.countDocuments.mockResolvedValue(2);

    const result = await listAccessReviewEntities({ hasUnreviewed: 'true', sort: 'official_application' });
    const pipeline = mocks.researchEntityAggregate.mock.calls[0][0];

    expect(pipeline).toContainEqual({ $match: { totalUnreviewed: { $gt: 0 } } });
    expect(result.entities[0]).toMatchObject({
      totalUnreviewed: 1,
      hasOfficialApplication: true,
      unreviewedCounts: { entryPathways: 1, postedOpportunities: 0 },
    });
    expect(result.entities[0]).not.toHaveProperty('_pathways');
    expect(result.progress).toEqual({ remaining: 8, reviewedToday: 8 });
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

  it('redacts raw contact destinations from access-review responses', () => {
    expect(redactAccessReviewContactRoute({
      _id: 'route-1',
      email: 'private@example.edu',
      url: 'mailto:private@example.edu',
      destination: 'private@example.edu',
      sourceUrl: 'https://example.edu/evidence',
    })).toEqual({ _id: 'route-1', sourceUrl: 'https://example.edu/evidence' });
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
