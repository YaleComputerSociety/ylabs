import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

vi.mock('../../services/studentVisibilityGateService', () => ({
  runStudentVisibilityGate: vi.fn(async () => ({ counts: { scanned: 1 } })),
  planStudentVisibilityGate: vi.fn(async () => []),
  applyStudentVisibilityGatePlans: vi.fn(async () => {}),
}));

import { ResearchEntity } from '../../models/researchEntity';
import { runEponymousFraLabMergeStage } from '../researchEntityEponymousMergeStage';

const SINCE = '2026-08-01T00:00:00.000Z';
const TOUCHED_AT = new Date('2026-08-26T00:00:00.000Z');

describe('runEponymousFraLabMergeStage idempotency (DB-backed)', () => {
  let replSet: MongoMemoryReplSet;
  const labId = new mongoose.Types.ObjectId();
  const shellId = new mongoose.Types.ObjectId();
  const personId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
    await db.collection('research_entities').insertMany([
      {
        _id: labId,
        slug: 'ysm-roe-lab',
        name: 'Roe Laboratory',
        kind: 'lab',
        entityType: 'LAB',
        websiteUrl: 'https://medicine.yale.edu/lab/roe/',
        sourceUrls: ['https://medicine.yale.edu/lab/roe/'],
        departments: ['Immunobiology'],
        archived: false,
        lastObservedAt: TOUCHED_AT,
      },
      {
        _id: shellId,
        slug: 'faculty-research-area-jane-roe',
        name: 'Jane Roe Research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrls: ['https://medicine.yale.edu/profile/jane-roe/'],
        departments: ['Immunobiology'],
        archived: false,
        lastObservedAt: TOUCHED_AT,
      },
    ]);
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: 'Jane Roe',
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: labId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
    });
  });

  const shellDoc = () =>
    ResearchEntity.findById(shellId).lean<{ archived?: boolean; canonicalGroupId?: unknown }>();

  it('merges the eponymous shell once, then a re-run is a no-op', async () => {
    const first = await runEponymousFraLabMergeStage({
      apply: true,
      maxMerges: 50,
      sinceIso: SINCE,
    });

    expect(first.plannedMergeCount).toBe(1);
    expect(first.appliedMergeCount).toBe(1);
    expect(first.mergedPairs).toEqual([
      {
        piUserId: personId.toHexString(),
        fraEntityId: shellId.toHexString(),
        fraSlug: 'faculty-research-area-jane-roe',
        labEntityId: labId.toHexString(),
        labSlug: 'ysm-roe-lab',
      },
    ]);
    expect(meiliMocks.deleteFromIndex).toHaveBeenCalledWith(
      'researchEntity',
      shellId.toHexString(),
    );

    const afterFirst = await shellDoc();
    expect(afterFirst?.archived).toBe(true);
    expect(String(afterFirst?.canonicalGroupId)).toBe(labId.toHexString());

    meiliMocks.deleteFromIndex.mockClear();

    const second = await runEponymousFraLabMergeStage({
      apply: true,
      maxMerges: 50,
      sinceIso: SINCE,
    });

    expect(second.plannedMergeCount).toBe(0);
    expect(second.appliedMergeCount).toBe(0);
    expect(meiliMocks.deleteFromIndex).not.toHaveBeenCalled();

    const afterSecond = await shellDoc();
    expect(afterSecond?.archived).toBe(true);
    expect(String(afterSecond?.canonicalGroupId)).toBe(labId.toHexString());
  });
});
