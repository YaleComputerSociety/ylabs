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

import { ResearchEntityRedirect } from '../../models/researchEntityRedirect';
import { applyResearchEntityDedupeMergeGroup } from '../dedupeResearchEntitiesByPi';
import { runEponymousFraLabMergeStage } from '../researchEntityEponymousMergeStage';

const SINCE = '2026-08-01T00:00:00.000Z';
const TOUCHED_AT = new Date('2026-08-26T00:00:00.000Z');

describe('dedupe merge persists a durable canonical redirect', () => {
  let replSet: MongoMemoryReplSet;

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
    for (const name of [
      'research_entities',
      'research_entity_redirects',
      'role_assignments',
      'researchers',
      'observations',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedLabAndShell = async (
    labId: mongoose.Types.ObjectId,
    shellId: mongoose.Types.ObjectId,
  ) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').insertMany([
      {
        _id: labId,
        slug: 'ysm-roe-lab',
        name: 'Roe Laboratory',
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
        lastObservedAt: TOUCHED_AT,
      },
      {
        _id: shellId,
        slug: 'faculty-research-area-jane-roe',
        name: 'Jane Roe Research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        archived: false,
        lastObservedAt: TOUCHED_AT,
      },
    ]);
  };

  it('writes the shell -> canonical redirect via the shared merge primitive and is idempotent', async () => {
    const labId = new mongoose.Types.ObjectId();
    const shellId = new mongoose.Types.ObjectId();
    await seedLabAndShell(labId, shellId);

    await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: labId.toHexString(),
        duplicateEntityIds: [shellId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
      },
      {
        deleteDuplicates: false,
        relinkReferences: true,
        redirectReason: 'eponymous_fra_lab_merge',
      },
    );

    const redirect = await ResearchEntityRedirect.findOne({ mergedEntityId: shellId }).lean<{
      mergedSlug?: string;
      canonicalEntityId?: mongoose.Types.ObjectId;
      reason?: string;
    }>();
    expect(redirect?.mergedSlug).toBe('faculty-research-area-jane-roe');
    expect(String(redirect?.canonicalEntityId)).toBe(labId.toHexString());
    expect(redirect?.reason).toBe('eponymous_fra_lab_merge');

    await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: labId.toHexString(),
        duplicateEntityIds: [shellId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [],
      },
      {
        deleteDuplicates: false,
        relinkReferences: true,
        redirectReason: 'eponymous_fra_lab_merge',
      },
    );
    expect(await ResearchEntityRedirect.countDocuments({ mergedEntityId: shellId })).toBe(1);
  });

  it('writes the same redirect through the eponymous merge stage (CLI-equivalent path)', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const labId = new mongoose.Types.ObjectId();
    const shellId = new mongoose.Types.ObjectId();
    const personId = new mongoose.Types.ObjectId();
    await seedLabAndShell(labId, shellId);
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

    const delta = await runEponymousFraLabMergeStage({
      apply: true,
      maxMerges: 50,
      sinceIso: SINCE,
    });
    expect(delta.appliedMergeCount).toBe(1);

    const redirect = await ResearchEntityRedirect.findOne({ mergedEntityId: shellId }).lean<{
      canonicalEntityId?: mongoose.Types.ObjectId;
      reason?: string;
    }>();
    expect(String(redirect?.canonicalEntityId)).toBe(labId.toHexString());
    expect(redirect?.reason).toBe('eponymous_fra_lab_merge');
  });
});
