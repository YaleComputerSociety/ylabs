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
  signalFindByIdAndUpdate: vi.fn(),
  countDocuments: vi.fn(),
  accountFindOne: vi.fn(),
  accountLean: vi.fn(),
}));

vi.mock('../../models/account', () => ({
  Account: {
    findOne: (...args: unknown[]) => {
      mocks.accountFindOne(...args);
      return { select: () => ({ lean: mocks.accountLean }) };
    },
  },
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

vi.mock('../../models/signal', () => ({
  Signal: {
    aggregate: vi.fn(),
    countDocuments: mocks.countDocuments,
    findById: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }),
    findByIdAndUpdate: mocks.signalFindByIdAndUpdate,
  },
}));

vi.mock('../../models/observation', () => ({
  Observation: {
    find: vi.fn(),
  },
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
} from '../adminAccessReviewService';

describe('adminAccessReviewService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(mongoose.connection, 'transaction').mockImplementation(async (work: any) =>
      work({} as mongoose.ClientSession),
    );
    mocks.assertProjectionReady.mockResolvedValue(undefined);
    mocks.projectionLean.mockResolvedValue([]);
    mocks.projectionCountDocuments.mockResolvedValue(0);
    mocks.invalidateProjection.mockResolvedValue(1);
    mocks.refreshProjection.mockResolvedValue(true);
    mocks.mutateProjection.mockImplementation(
      (_id: unknown, mutate: (session: mongoose.ClientSession) => unknown) => mutate({} as any),
    );
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
          accessSignals: 1,
        },
        unreviewedCounts: {
          accessSignals: 1,
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
      unreviewedCounts: { accessSignals: 1 },
    });
    expect(result.entities[0]).not.toHaveProperty('_pathways');
    expect(result.progress).toEqual({ remaining: 2, reviewedToday: 2 });
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
    mocks.signalFindByIdAndUpdate.mockReturnValue(chain);

    await updateAccessReviewRecordReview({
      type: 'accessSignal',
      id,
      lockedFields: [' sourceUrl ', 'bad$field', 'x'.repeat(121), 'sourceUrl'],
    });

    const [updatedId, update] = mocks.signalFindByIdAndUpdate.mock.calls[0];
    expect(String(updatedId)).toBe(id);
    expect(update).toEqual({
      $set: { 'review.lockedFields': ['sourceUrl'] },
    });
  });

  it('ignores non-string reviewer netids before persisting review metadata', async () => {
    const id = '64f222222222222222222222';
    mocks.signalFindByIdAndUpdate.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: id }),
    });

    await updateAccessReviewRecordReview({
      type: 'accessSignal',
      id,
      status: 'approved',
      reviewerNetid: { toString: () => 'abc123' },
    });

    const [, update] = mocks.signalFindByIdAndUpdate.mock.calls[0];
    expect(update.$set).toMatchObject({ 'review.status': 'approved' });
    expect(update.$set).not.toHaveProperty('review.reviewedByAccountId');
    expect(mocks.accountFindOne).not.toHaveBeenCalled();
  });

  it('resolves the reviewer netid to an account id when persisting review metadata', async () => {
    const id = '64f222222222222222222222';
    const accountId = new mongoose.Types.ObjectId('64f333333333333333333333');
    mocks.signalFindByIdAndUpdate.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: id }),
    });
    mocks.accountLean.mockResolvedValue({ _id: accountId });

    await updateAccessReviewRecordReview({
      type: 'accessSignal',
      id,
      status: 'approved',
      reviewerNetid: '  ABC123  ',
    });

    expect(mocks.accountFindOne).toHaveBeenCalledWith({ netid: 'abc123' });
    const [, update] = mocks.signalFindByIdAndUpdate.mock.calls[0];
    expect(update.$set['review.reviewedByAccountId']).toBe(accountId);
  });

  it('omits reviewer attribution when the netid matches no account', async () => {
    const id = '64f222222222222222222222';
    mocks.signalFindByIdAndUpdate.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: id }),
    });
    mocks.accountLean.mockResolvedValue(null);

    await updateAccessReviewRecordReview({
      type: 'accessSignal',
      id,
      status: 'approved',
      reviewerNetid: 'ghost',
    });

    const [, update] = mocks.signalFindByIdAndUpdate.mock.calls[0];
    expect(update.$set).not.toHaveProperty('review.reviewedByAccountId');
  });
});
