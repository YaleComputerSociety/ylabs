import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  ADMIN_ACCESS_REVIEW_PROJECTION_STATE_ID,
  AdminAccessReviewProjection,
  AdminAccessReviewProjectionState,
} from '../../models/adminAccessReviewProjection';
import { AccessSignal } from '../../models/accessSignal';
import { ResearchEntity } from '../../models/researchEntity';
import { rebuildAdminAccessReviewProjection } from '../../services/adminAccessReviewProjectionService';
import { parseRebuildAdminAccessReviewProjectionArgs } from '../rebuildAdminAccessReviewProjection';

describe('rebuildAdminAccessReviewProjection CLI', () => {
  it('defaults to a dry-run for an explicit non-production target', () => {
    expect(parseRebuildAdminAccessReviewProjectionArgs(['--environment=development'])).toEqual({
      environment: 'development',
      apply: false,
      batchSize: 100,
    });
  });

  it('requires a reviewed artifact and exact environment confirmation for apply', () => {
    expect(() =>
      parseRebuildAdminAccessReviewProjectionArgs([
        '--environment=beta',
        '--apply',
        '--confirm-admin-access-review-projection=beta',
      ]),
    ).toThrow(/--apply-from/);

    expect(
      parseRebuildAdminAccessReviewProjectionArgs([
        '--environment=beta',
        '--apply',
        '--apply-from=/tmp/access-review-plan.json',
        '--confirm-admin-access-review-projection=beta',
        '--batch-size=250',
      ]),
    ).toMatchObject({
      environment: 'beta',
      apply: true,
      applyFrom: '/tmp/access-review-plan.json',
      confirmEnvironment: 'beta',
      batchSize: 250,
    });
  });

  it('rejects direct production projection writes', () => {
    expect(() => parseRebuildAdminAccessReviewProjectionArgs(['--environment=production'])).toThrow(
      /Production is not a permitted/,
    );
  });
});

let memoryReplSet: MongoMemoryReplSet | undefined;

describe('admin access-review projection reconciliation with MongoDB', () => {
  beforeAll(async () => {
    let mongoUrl = process.env.ACCESS_REVIEW_TEST_MONGO_URL;
    if (!mongoUrl) {
      memoryReplSet = await MongoMemoryReplSet.create({
        binary: { version: '8.0.12' },
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      mongoUrl = memoryReplSet.getUri('access_review_test');
    }
    await mongoose.connect(mongoUrl);
  }, 120_000);

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('applies a fingerprint-bound plan idempotently and rejects drift', async () => {
    const researchEntityId = new mongoose.Types.ObjectId();
    await ResearchEntity.collection.insertOne({
      _id: researchEntityId,
      name: 'Synthetic Research Group',
      slug: 'synthetic-research-group',
      departments: ['Synthetic Studies'],
      researchAreas: ['Testing'],
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const dryRun = await rebuildAdminAccessReviewProjection();
    expect(dryRun).toMatchObject({
      mode: 'dry-run',
      scanned: 1,
      missing: 1,
      writesPlanned: 1,
      writesApplied: 0,
    });

    const applied = await rebuildAdminAccessReviewProjection({
      apply: true,
      expectedPlanFingerprint: dryRun.planFingerprint,
    });
    expect(applied).toMatchObject({ mode: 'apply', writesPlanned: 1, writesApplied: 1 });
    await expect(
      AdminAccessReviewProjectionState.findById(ADMIN_ACCESS_REVIEW_PROJECTION_STATE_ID).lean(),
    ).resolves.toMatchObject({ ready: true, rebuilding: false });

    const repeatedDryRun = await rebuildAdminAccessReviewProjection();
    expect(repeatedDryRun).toMatchObject({
      mode: 'dry-run',
      scanned: 1,
      unchanged: 1,
      writesPlanned: 0,
      writesApplied: 0,
    });
    const repeatedApply = await rebuildAdminAccessReviewProjection({
      apply: true,
      expectedPlanFingerprint: repeatedDryRun.planFingerprint,
    });
    expect(repeatedApply).toMatchObject({ mode: 'apply', writesPlanned: 0, writesApplied: 0 });

    await AccessSignal.collection.insertOne({
      researchEntityId,
      signalType: 'DIRECT_EMAIL',
      confidence: 'HIGH',
      observedAt: new Date('2026-01-02T00:00:00.000Z'),
      review: { status: 'unreviewed' },
    });
    await expect(
      rebuildAdminAccessReviewProjection({
        apply: true,
        expectedPlanFingerprint: repeatedDryRun.planFingerprint,
      }),
    ).rejects.toThrow(/plan drifted/i);
    await expect(
      AdminAccessReviewProjection.findOne({ researchEntityId }).lean(),
    ).resolves.toMatchObject({
      counts: { accessSignals: 0 },
      stale: false,
    });
  });
});
