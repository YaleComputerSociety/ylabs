import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => ({
  researchEntityFind: vi.fn(),
  researchEntityCountDocuments: vi.fn(),
  researchEntityFindByIdAndUpdate: vi.fn(),
  researchEntityAggregate: vi.fn(),
  entryPathwayFindByIdAndUpdate: vi.fn(),
  entryPathwayFindOne: vi.fn(),
  entryPathwayUpdateOne: vi.fn(),
  postedOpportunityFindById: vi.fn(),
  postedOpportunityFindByIdAndUpdate: vi.fn(),
  postedOpportunityFindOneAndUpdate: vi.fn(),
  postedOpportunityUpdateOne: vi.fn(),
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
    findOne: mocks.entryPathwayFindOne,
    updateOne: mocks.entryPathwayUpdateOne,
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
    findById: mocks.postedOpportunityFindById,
    findByIdAndUpdate: mocks.postedOpportunityFindByIdAndUpdate,
    findOneAndUpdate: mocks.postedOpportunityFindOneAndUpdate,
    updateOne: mocks.postedOpportunityUpdateOne,
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
    const query: any = {
      select: vi.fn(() => query),
      lean: vi.fn().mockResolvedValue(null),
    };
    mocks.entryPathwayFindOne.mockReturnValue(query);
  });

  it('caps access review page before building Mongo skip and limit values', async () => {
    mocks.researchEntityAggregate.mockReturnValue({
      exec: vi.fn().mockResolvedValue([{ rows: [], meta: [] }]),
    });
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
      exec: vi.fn().mockResolvedValue([
        {
          rows: [
            {
              _id: new mongoose.Types.ObjectId('64f111111111111111111111'),
              name: 'Example Lab',
              slug: 'example',
              _pathways: [{ status: 'unreviewed' }],
              _signals: [],
              _routes: [],
              _opportunities: [{ status: 'approved', applicationUrl: 'https://example.edu/apply' }],
              totalUnreviewed: 1,
              hasOfficialApplication: true,
            },
          ],
          meta: [{ total: 1 }],
        },
      ]),
    });
    mocks.countDocuments.mockResolvedValue(2);

    const result = await listAccessReviewEntities({
      hasUnreviewed: 'true',
      sort: 'official_application',
    });
    const pipeline = mocks.researchEntityAggregate.mock.calls[0][0];

    expect(pipeline).toContainEqual({ $match: { totalUnreviewed: { $gt: 0 } } });
    expect(result.entities[0]).toMatchObject({
      totalUnreviewed: 1,
      hasOfficialApplication: true,
      unreviewedCounts: { entryPathways: 1, postedOpportunities: 0 },
    });
    expect(result.entities[0]).not.toHaveProperty('_pathways');
    expect(result.progress).toEqual({ remaining: 8, reviewedToday: 8 });
    expect(mocks.countDocuments.mock.calls[0][0]).toMatchObject({
      derivationKey: { $not: /^faculty-opportunity:/ },
    });
    expect(mocks.countDocuments.mock.calls[6][0]).toMatchObject({
      submissionStatus: { $ne: 'DRAFT' },
    });
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
    expect(
      redactAccessReviewContactRoute({
        _id: 'route-1',
        email: 'private@example.edu',
        url: 'mailto:private@example.edu',
        destination: 'private@example.edu',
        sourceUrl: 'https://example.edu/evidence',
      }),
    ).toEqual({ _id: 'route-1', sourceUrl: 'https://example.edu/evidence' });
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

  it('approves only a submitted faculty opportunity and its linked pathway', async () => {
    const id = '64f222222222222222222222';
    const pathwayId = new mongoose.Types.ObjectId('64f333333333333333333333');
    const facultyId = new mongoose.Types.ObjectId('64f444444444444444444444');
    const recordQuery: any = {
      select: vi.fn(() => recordQuery),
      lean: vi.fn().mockResolvedValue({
        _id: id,
        createdByUserId: facultyId,
        entryPathwayId: pathwayId,
        submissionStatus: 'PENDING_REVIEW',
        review: { status: 'unreviewed' },
        status: 'OPEN',
        archived: false,
        revision: 6,
      }),
    };
    mocks.postedOpportunityFindById.mockReturnValue(recordQuery);
    mocks.postedOpportunityFindOneAndUpdate.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: id,
        archived: false,
        status: 'OPEN',
        revision: 7,
        submissionStatus: 'REVIEWED',
        review: { status: 'approved' },
      }),
    });
    mocks.entryPathwayUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const result = await updateAccessReviewRecordReview({
      type: 'postedOpportunity',
      id,
      status: 'approved',
      reviewerId: '64f555555555555555555555',
    });

    expect(result).toMatchObject({ review: { status: 'approved' } });
    expect(mocks.postedOpportunityFindOneAndUpdate.mock.calls[0][0]).toMatchObject({
      _id: new mongoose.Types.ObjectId(id),
      revision: 6,
      status: 'OPEN',
      archived: false,
      submissionStatus: 'PENDING_REVIEW',
      'review.status': 'unreviewed',
    });
    expect(mocks.postedOpportunityFindOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
      submissionStatus: 'REVIEWED',
      'review.status': 'approved',
    });
    expect(mocks.postedOpportunityFindOneAndUpdate.mock.calls[0][1].$inc).toEqual({ revision: 1 });
    expect(mocks.entryPathwayUpdateOne.mock.calls[0][1].$set).toMatchObject({
      'review.status': 'approved',
    });
  });

  it('does not let an administrator approve an unsubmitted faculty draft', async () => {
    const id = '64f222222222222222222222';
    const recordQuery: any = {
      select: vi.fn(() => recordQuery),
      lean: vi.fn().mockResolvedValue({
        _id: id,
        createdByUserId: new mongoose.Types.ObjectId(),
        entryPathwayId: new mongoose.Types.ObjectId(),
        submissionStatus: 'DRAFT',
        review: { status: 'unreviewed' },
      }),
    };
    mocks.postedOpportunityFindById.mockReturnValue(recordQuery);

    await expect(
      updateAccessReviewRecordReview({ type: 'postedOpportunity', id, status: 'approved' }),
    ).resolves.toBeNull();
    expect(mocks.postedOpportunityFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mocks.entryPathwayUpdateOne).not.toHaveBeenCalled();
  });

  it('compensates moderation when the linked pathway is missing', async () => {
    const id = '64f222222222222222222222';
    const pathwayId = new mongoose.Types.ObjectId('64f333333333333333333333');
    const recordQuery: any = {
      select: vi.fn(() => recordQuery),
      lean: vi.fn().mockResolvedValue({
        _id: id,
        createdByUserId: new mongoose.Types.ObjectId(),
        entryPathwayId: pathwayId,
        submissionStatus: 'PENDING_REVIEW',
        review: { status: 'unreviewed' },
        status: 'OPEN',
        archived: false,
        revision: 4,
      }),
    };
    mocks.postedOpportunityFindById.mockReturnValue(recordQuery);
    mocks.postedOpportunityFindOneAndUpdate.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: id,
        review: { status: 'approved' },
        status: 'OPEN',
        archived: false,
        revision: 5,
      }),
    });
    mocks.entryPathwayUpdateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    mocks.postedOpportunityUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    await expect(
      updateAccessReviewRecordReview({ type: 'postedOpportunity', id, status: 'approved' }),
    ).rejects.toThrow('Linked pathway not found');

    expect(mocks.postedOpportunityUpdateOne.mock.calls[0][1].$set).toEqual({
      submissionStatus: 'PENDING_REVIEW',
      review: { status: 'unreviewed' },
      archived: false,
    });
    expect(mocks.postedOpportunityUpdateOne.mock.calls[0][1].$inc).toEqual({ revision: 1 });
    expect(mocks.postedOpportunityUpdateOne.mock.calls[0][0]).toMatchObject({
      _id: new mongoose.Types.ObjectId(id),
      revision: 5,
      status: 'OPEN',
      archived: false,
      submissionStatus: 'REVIEWED',
      'review.status': 'approved',
      'review.reviewedAt': expect.any(Date),
    });
  });

  it('does not compensate over a concurrent faculty lifecycle write', async () => {
    const id = '64f222222222222222222222';
    const recordQuery: any = {
      select: vi.fn(() => recordQuery),
      lean: vi.fn().mockResolvedValue({
        _id: id,
        createdByUserId: new mongoose.Types.ObjectId(),
        entryPathwayId: new mongoose.Types.ObjectId(),
        submissionStatus: 'PENDING_REVIEW',
        review: { status: 'unreviewed' },
        status: 'OPEN',
        archived: false,
        revision: 8,
      }),
    };
    mocks.postedOpportunityFindById.mockReturnValue(recordQuery);
    mocks.postedOpportunityFindOneAndUpdate.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: id,
        archived: false,
        status: 'OPEN',
        revision: 9,
        submissionStatus: 'REVIEWED',
        review: { status: 'approved' },
      }),
    });
    mocks.entryPathwayUpdateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    mocks.postedOpportunityUpdateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    await expect(
      updateAccessReviewRecordReview({ type: 'postedOpportunity', id, status: 'approved' }),
    ).rejects.toThrow('Faculty opportunity moderation compensation failed');

    expect(mocks.postedOpportunityUpdateOne.mock.calls[0][0]).toMatchObject({
      revision: 9,
      status: 'OPEN',
      archived: false,
      submissionStatus: 'REVIEWED',
      'review.status': 'approved',
    });
  });

  it('does not approve when faculty submission state changes after the moderation read', async () => {
    const id = '64f222222222222222222222';
    const recordQuery: any = {
      select: vi.fn(() => recordQuery),
      lean: vi.fn().mockResolvedValue({
        _id: id,
        createdByUserId: new mongoose.Types.ObjectId(),
        entryPathwayId: new mongoose.Types.ObjectId(),
        submissionStatus: 'PENDING_REVIEW',
        review: { status: 'unreviewed' },
        status: 'OPEN',
        archived: false,
        revision: 3,
      }),
    };
    mocks.postedOpportunityFindById.mockReturnValue(recordQuery);
    mocks.postedOpportunityFindOneAndUpdate.mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    });

    await expect(
      updateAccessReviewRecordReview({ type: 'postedOpportunity', id, status: 'approved' }),
    ).resolves.toBeNull();

    expect(mocks.postedOpportunityFindOneAndUpdate.mock.calls[0][0]).toMatchObject({
      revision: 3,
      status: 'OPEN',
      archived: false,
      submissionStatus: 'PENDING_REVIEW',
      'review.status': 'unreviewed',
    });
    expect(mocks.postedOpportunityFindOneAndUpdate.mock.calls[0][1].$inc).toEqual({ revision: 1 });
    expect(mocks.entryPathwayUpdateOne).not.toHaveBeenCalled();
  });

  it('does not allow independent review of an opportunity-managed pathway', async () => {
    const id = '64f333333333333333333333';
    const query: any = {
      select: vi.fn(() => query),
      lean: vi.fn().mockResolvedValue({ _id: id }),
    };
    mocks.entryPathwayFindOne.mockReturnValue(query);

    await expect(
      updateAccessReviewRecordReview({ type: 'entryPathway', id, status: 'approved' }),
    ).resolves.toBeNull();
    expect(mocks.entryPathwayFindByIdAndUpdate).not.toHaveBeenCalled();
  });
});
