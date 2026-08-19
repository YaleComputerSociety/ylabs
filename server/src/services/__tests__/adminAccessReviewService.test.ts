import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => ({
  researchEntityFind: vi.fn(),
  researchEntityCountDocuments: vi.fn(),
  researchEntityFindByIdAndUpdate: vi.fn(),
  projectionFind: vi.fn(),
  projectionCountDocuments: vi.fn(),
  projectionSort: vi.fn(),
  projectionSkip: vi.fn(),
  projectionLimit: vi.fn(),
  projectionLean: vi.fn(),
  assertProjectionReady: vi.fn(),
  invalidateProjection: vi.fn(),
  refreshProjection: vi.fn(),
  mutateProjection: vi.fn(),
  entryPathwayFindByIdAndUpdate: vi.fn(),
  entryPathwayFindById: vi.fn(),
  entryPathwayFindOne: vi.fn(),
  entryPathwayUpdateOne: vi.fn(),
  postedOpportunityFindById: vi.fn(),
  postedOpportunityFindByIdAndUpdate: vi.fn(),
  postedOpportunityFindOneAndUpdate: vi.fn(),
  postedOpportunityUpdateOne: vi.fn(),
  countDocuments: vi.fn(),
  syncPathwaySearchIndexDocument: vi.fn(),
}));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    find: mocks.researchEntityFind,
    countDocuments: mocks.researchEntityCountDocuments,
    findByIdAndUpdate: mocks.researchEntityFindByIdAndUpdate,
  },
}));

vi.mock('../../models/adminAccessReviewProjection', () => ({
  AdminAccessReviewProjection: {
    find: (...args: unknown[]) => {
      mocks.projectionFind(...args);
      const query: any = {
        sort: (...sortArgs: unknown[]) => {
          mocks.projectionSort(...sortArgs);
          return query;
        },
        skip: (...skipArgs: unknown[]) => {
          mocks.projectionSkip(...skipArgs);
          return query;
        },
        limit: (...limitArgs: unknown[]) => {
          mocks.projectionLimit(...limitArgs);
          return query;
        },
        select: vi.fn(() => query),
        session: vi.fn(() => query),
        lean: mocks.projectionLean,
      };
      return query;
    },
    countDocuments: mocks.projectionCountDocuments,
  },
}));

vi.mock('../../models/entryPathway', () => ({
  EntryPathway: {
    aggregate: vi.fn(),
    findByIdAndUpdate: mocks.entryPathwayFindByIdAndUpdate,
    findById: mocks.entryPathwayFindById,
    findOne: mocks.entryPathwayFindOne,
    updateOne: mocks.entryPathwayUpdateOne,
    countDocuments: mocks.countDocuments,
  },
}));

vi.mock('../../models/signal', () => ({
  Signal: {
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

vi.mock('../pathwaySearchIndexService', () => ({
  syncPathwaySearchIndexDocument: mocks.syncPathwaySearchIndexDocument,
}));

vi.mock('../adminAccessReviewProjectionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../adminAccessReviewProjectionService')>()),
  assertAdminAccessReviewProjectionReady: mocks.assertProjectionReady,
  invalidateAdminAccessReviewProjection: mocks.invalidateProjection,
  refreshAdminAccessReviewProjection: mocks.refreshProjection,
  mutateAndRefreshAdminAccessReviewProjection: mocks.mutateProjection,
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
    vi.spyOn(mongoose.connection, 'transaction').mockImplementation(async (work: any) =>
      work({} as mongoose.ClientSession),
    );
    mocks.syncPathwaySearchIndexDocument.mockResolvedValue(undefined);
    mocks.assertProjectionReady.mockResolvedValue(undefined);
    mocks.projectionLean.mockResolvedValue([]);
    mocks.projectionCountDocuments.mockResolvedValue(0);
    mocks.invalidateProjection.mockResolvedValue(1);
    mocks.refreshProjection.mockResolvedValue(true);
    mocks.mutateProjection.mockImplementation(
      (_id: unknown, mutate: (session: mongoose.ClientSession) => unknown) => mutate({} as any),
    );
    const query: any = {
      select: vi.fn(() => query),
      lean: vi.fn().mockResolvedValue(null),
    };
    mocks.entryPathwayFindOne.mockReturnValue(query);
    mocks.entryPathwayFindById.mockReturnValue(query);
  });

  it('caps access review page before building Mongo skip and limit values', async () => {
    mocks.countDocuments.mockResolvedValue(0);

    const result = await listAccessReviewEntities({
      page: 999_999_999,
      pageSize: 500,
    });

    expect(mocks.projectionSkip).toHaveBeenCalledWith(99_900);
    expect(mocks.projectionLimit).toHaveBeenCalledWith(100);
    expect(result).toMatchObject({
      entities: [],
      total: 0,
      page: 1000,
      pageSize: 100,
      totalPages: 0,
    });
    expect(mongoose.connection.transaction).toHaveBeenCalledWith(expect.any(Function), {
      readConcern: { level: 'snapshot' },
      readPreference: 'primary',
    });
    expect(mocks.assertProjectionReady).toHaveBeenCalledWith(expect.any(Object));
  });

  it('runs snapshot transaction reads sequentially on one MongoDB session', async () => {
    let activeReads = 0;
    let maximumConcurrentReads = 0;
    const trackedRead = async <T>(value: T): Promise<T> => {
      activeReads += 1;
      maximumConcurrentReads = Math.max(maximumConcurrentReads, activeReads);
      await Promise.resolve();
      activeReads -= 1;
      return value;
    };
    mocks.projectionLean.mockImplementation(() => trackedRead([]));
    mocks.projectionCountDocuments.mockImplementation(() => trackedRead(0));
    mocks.countDocuments.mockImplementation(() => trackedRead(0));

    await listAccessReviewEntities();

    expect(maximumConcurrentReads).toBe(1);
  });

  it('rejects oversized access review search before model lookup', async () => {
    await expect(
      listAccessReviewEntities({
        search: 'a'.repeat(121),
      }),
    ).rejects.toThrow('Search query is too long');

    expect(mocks.projectionFind).not.toHaveBeenCalled();
    expect(mocks.researchEntityCountDocuments).not.toHaveBeenCalled();
  });

  it('uses bounded indexed substring prefixes for queue search', async () => {
    mocks.countDocuments.mockResolvedValue(0);

    await listAccessReviewEntities({ search: ' Example   Lab ' });

    expect(mocks.projectionFind).toHaveBeenCalledWith({
      searchPrefixes: { $all: [/^example/, /^lab/] },
    });
  });

  it('returns no queue matches for punctuation-only search', async () => {
    mocks.countDocuments.mockResolvedValue(0);

    await listAccessReviewEntities({ search: '---' });

    expect(mocks.projectionFind).toHaveBeenCalledWith({ searchPrefixes: { $in: [] } });
  });

  it('preserves substring matching within queue search words', async () => {
    mocks.countDocuments.mockResolvedValue(0);

    await listAccessReviewEntities({ search: 'ale' });

    expect(mocks.projectionFind).toHaveBeenCalledWith({ searchPrefixes: { $all: [/^ale/] } });
  });

  it('filters and sorts the queue by aggregate unreviewed work without returning record data', async () => {
    const researchEntityId = new mongoose.Types.ObjectId('64f111111111111111111111');
    mocks.projectionLean.mockResolvedValue([
      {
        researchEntityId,
        counts: {
          entryPathways: 1,
          accessSignals: 0,
          contactRoutes: 0,
          postedOpportunities: 1,
        },
        unreviewedCounts: {
          entryPathways: 1,
          accessSignals: 0,
          contactRoutes: 0,
          postedOpportunities: 0,
        },
        totalUnreviewed: 1,
        hasOfficialApplication: true,
      },
    ]);
    mocks.projectionCountDocuments.mockResolvedValue(1);
    const entityQuery: any = {
      select: vi.fn(() => entityQuery),
      session: vi.fn(() => entityQuery),
      lean: vi
        .fn()
        .mockResolvedValue([{ _id: researchEntityId, name: 'Example Lab', slug: 'example' }]),
    };
    mocks.researchEntityFind.mockReturnValue(entityQuery);
    mocks.countDocuments.mockResolvedValue(2);

    const result = await listAccessReviewEntities({
      hasUnreviewed: 'true',
      sort: 'official_application',
    });
    expect(mocks.projectionFind).toHaveBeenCalledWith({ totalUnreviewed: { $gt: 0 } });
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
    const originalBackend = process.env.PATHWAY_SEARCH_BACKEND;
    const originalSync = process.env.PATHWAY_SEARCH_SYNC;
    process.env.PATHWAY_SEARCH_BACKEND = 'meili';
    delete process.env.PATHWAY_SEARCH_SYNC;
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
    const pathwayUpdatedAt = new Date('2026-07-14T12:00:00.000Z');
    const pathwayQuery: any = {
      select: vi.fn(() => pathwayQuery),
      lean: vi.fn().mockResolvedValue({
        derivationKey: `faculty-opportunity:${id}`,
        status: 'ACTIVE',
        archived: false,
        review: { status: 'unreviewed' },
        updatedAt: pathwayUpdatedAt,
      }),
    };
    mocks.entryPathwayFindById.mockReturnValue(pathwayQuery);
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
    expect(mocks.entryPathwayUpdateOne.mock.calls[0][0]).toMatchObject({
      _id: pathwayId,
      derivationKey: `faculty-opportunity:${id}`,
      status: 'ACTIVE',
      archived: false,
      'review.status': 'unreviewed',
      updatedAt: pathwayUpdatedAt,
    });
    expect(mocks.syncPathwaySearchIndexDocument).toHaveBeenCalledWith(pathwayId.toHexString());
    if (originalBackend === undefined) delete process.env.PATHWAY_SEARCH_BACKEND;
    else process.env.PATHWAY_SEARCH_BACKEND = originalBackend;
    if (originalSync === undefined) delete process.env.PATHWAY_SEARCH_SYNC;
    else process.env.PATHWAY_SEARCH_SYNC = originalSync;
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

  it('rolls back moderation when the linked pathway is missing', async () => {
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
    ).rejects.toThrow('Linked pathway changed');

    expect(mocks.postedOpportunityUpdateOne).not.toHaveBeenCalled();
  });

  it('rolls back without compensating over a concurrent faculty lifecycle write', async () => {
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
    ).rejects.toThrow('Linked pathway changed');

    expect(mocks.postedOpportunityUpdateOne).not.toHaveBeenCalled();
  });

  it('rolls back when the linked pathway changes before moderation propagation', async () => {
    const id = '64f222222222222222222222';
    const pathwayId = new mongoose.Types.ObjectId('64f333333333333333333333');
    const pathwayUpdatedAt = new Date('2026-07-14T12:00:00.000Z');
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
        revision: 10,
      }),
    };
    const pathwayQuery: any = {
      select: vi.fn(() => pathwayQuery),
      lean: vi.fn().mockResolvedValue({
        derivationKey: `faculty-opportunity:${id}`,
        status: 'ACTIVE',
        archived: false,
        review: { status: 'unreviewed' },
        updatedAt: pathwayUpdatedAt,
      }),
    };
    mocks.postedOpportunityFindById.mockReturnValue(recordQuery);
    mocks.entryPathwayFindById.mockReturnValue(pathwayQuery);
    mocks.postedOpportunityFindOneAndUpdate.mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        _id: id,
        archived: false,
        status: 'OPEN',
        revision: 11,
        submissionStatus: 'REVIEWED',
        review: { status: 'approved' },
      }),
    });
    mocks.entryPathwayUpdateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    mocks.postedOpportunityUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    await expect(
      updateAccessReviewRecordReview({ type: 'postedOpportunity', id, status: 'approved' }),
    ).rejects.toThrow('Linked pathway changed');

    expect(mocks.entryPathwayUpdateOne.mock.calls[0][0]).toMatchObject({
      _id: pathwayId,
      status: 'ACTIVE',
      archived: false,
      'review.status': 'unreviewed',
      updatedAt: pathwayUpdatedAt,
    });
    expect(mocks.postedOpportunityUpdateOne).not.toHaveBeenCalled();
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
