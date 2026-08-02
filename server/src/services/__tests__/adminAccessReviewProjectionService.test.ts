import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => ({
  entityLean: vi.fn(),
  pathwayExec: vi.fn(),
  signalExec: vi.fn(),
  routeExec: vi.fn(),
  opportunityExec: vi.fn(),
  projectionFindOneAndUpdateLean: vi.fn(),
  projectionUpdateOne: vi.fn(),
  projectionDeleteOne: vi.fn(),
  stateLean: vi.fn(),
  staleLean: vi.fn(),
}));

function aggregateModel(exec: any) {
  return {
    aggregate: vi.fn((pipeline: unknown) => ({
      exec: () => exec(pipeline),
    })),
  };
}

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    findById: vi.fn(() => {
      const query: any = {
        select: vi.fn(() => query),
        lean: mocks.entityLean,
      };
      return query;
    }),
  },
}));

vi.mock('../../models/entryPathway', () => ({ EntryPathway: aggregateModel(mocks.pathwayExec) }));
vi.mock('../../models/accessSignal', () => ({ AccessSignal: aggregateModel(mocks.signalExec) }));
vi.mock('../../models/contactRoute', () => ({ ContactRoute: aggregateModel(mocks.routeExec) }));
vi.mock('../../models/postedOpportunity', () => ({
  PostedOpportunity: aggregateModel(mocks.opportunityExec),
}));

vi.mock('../../models/adminAccessReviewProjection', () => ({
  ADMIN_ACCESS_REVIEW_PROJECTION_SCHEMA_VERSION: 1,
  ADMIN_ACCESS_REVIEW_PROJECTION_STATE_ID: 'admin-access-review',
  AdminAccessReviewProjection: {
    findOneAndUpdate: vi.fn(() => {
      const query: any = {
        select: vi.fn(() => query),
        lean: mocks.projectionFindOneAndUpdateLean,
      };
      return query;
    }),
    updateOne: mocks.projectionUpdateOne,
    deleteOne: mocks.projectionDeleteOne,
    findOne: vi.fn(() => {
      const query: any = {
        select: vi.fn(() => query),
        lean: mocks.staleLean,
      };
      return query;
    }),
  },
  AdminAccessReviewProjectionState: {
    findById: vi.fn(() => {
      const query: any = {
        select: vi.fn(() => query),
        lean: mocks.stateLean,
      };
      return query;
    }),
  },
}));

import {
  AdminAccessReviewProjectionUnavailableError,
  assertAdminAccessReviewProjectionReady,
  buildAdminAccessReviewProjection,
  invalidateAdminAccessReviewProjection,
  mutateAndRefreshAdminAccessReviewProjection,
  refreshAdminAccessReviewProjection,
} from '../adminAccessReviewProjectionService';

describe('adminAccessReviewProjectionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.entityLean.mockResolvedValue({
      name: 'Example Lab',
      displayName: 'Example Research Group',
      slug: 'example-lab',
      departments: ['Computer Science'],
      researchAreas: ['Machine Learning'],
      updatedAt: new Date('2026-08-01T12:00:00.000Z'),
    });
    mocks.pathwayExec.mockResolvedValue([{ count: 3, unreviewed: 2 }]);
    mocks.signalExec.mockResolvedValue([{ count: 2, unreviewed: 1 }]);
    mocks.routeExec.mockResolvedValue([{ count: 1, unreviewed: 0 }]);
    mocks.opportunityExec.mockResolvedValue([{ count: 4, unreviewed: 1, officialApplications: 2 }]);
    mocks.projectionFindOneAndUpdateLean.mockResolvedValue({ generation: 4 });
    mocks.projectionUpdateOne.mockResolvedValue({ matchedCount: 1 });
    mocks.projectionDeleteOne.mockResolvedValue({ deletedCount: 1 });
    mocks.stateLean.mockResolvedValue({ schemaVersion: 1, ready: true, rebuilding: false });
    mocks.staleLean.mockResolvedValue(null);
  });

  it('builds only bounded queue fields from per-entity canonical aggregates', async () => {
    const id = new mongoose.Types.ObjectId('64f111111111111111111111');
    const value = await buildAdminAccessReviewProjection(id);

    expect(value).toMatchObject({
      researchEntityId: id,
      searchPrefixes: expect.arrayContaining(['example', 'lab', 'research', 'computer', 'machine']),
      counts: {
        entryPathways: 3,
        accessSignals: 2,
        contactRoutes: 1,
        postedOpportunities: 4,
      },
      totalUnreviewed: 4,
      hasOfficialApplication: true,
      schemaVersion: 1,
    });
    const pathwayPipeline = mocks.pathwayExec.mock.calls[0][0];
    const opportunityPipeline = mocks.opportunityExec.mock.calls[0][0];
    expect(pathwayPipeline[0].$match).toMatchObject({
      researchEntityId: id,
      derivationKey: { $not: /^faculty-opportunity:/ },
    });
    expect(opportunityPipeline[0].$match).toMatchObject({
      researchEntityId: id,
      submissionStatus: { $ne: 'DRAFT' },
    });
  });

  it('uses generation tokens so a concurrent invalidation cannot be cleared', async () => {
    const id = '64f111111111111111111111';
    await expect(invalidateAdminAccessReviewProjection(id)).resolves.toBe(4);
    await expect(refreshAdminAccessReviewProjection(id, 4)).resolves.toBe(true);

    expect(mocks.projectionUpdateOne.mock.calls[0][0]).toEqual({
      researchEntityId: new mongoose.Types.ObjectId(id),
      generation: 4,
    });
    expect(mocks.projectionUpdateOne.mock.calls[0][2]).toEqual({ upsert: false });
  });

  it('commits canonical writes and invalidation in the same transaction', async () => {
    const id = '64f111111111111111111111';
    const session = {} as mongoose.ClientSession;
    const transaction = vi
      .spyOn(mongoose.connection, 'transaction')
      .mockImplementation(async (work: any) => work(session));
    const mutate = vi.fn().mockResolvedValue('written');

    await expect(mutateAndRefreshAdminAccessReviewProjection(id, mutate)).resolves.toBe('written');

    expect(transaction).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledWith(session);
    expect(
      (await import('../../models/adminAccessReviewProjection')).AdminAccessReviewProjection
        .findOneAndUpdate,
    ).toHaveBeenCalledWith(
      { researchEntityId: new mongoose.Types.ObjectId(id) },
      expect.any(Object),
      expect.objectContaining({ session }),
    );
    transaction.mockRestore();
  });

  it('fails the queue closed when state is missing or any projection is stale', async () => {
    mocks.staleLean.mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
    await expect(assertAdminAccessReviewProjectionReady()).rejects.toBeInstanceOf(
      AdminAccessReviewProjectionUnavailableError,
    );
  });
});
