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

import { ResearchEntity } from '../../models/researchEntity';
import { ResearchEntityRedirect } from '../../models/researchEntityRedirect';
import { applyResearchEntityDedupeMergeGroup } from '../dedupeResearchEntitiesByPi';

const READY_FULL =
  'The Roe Laboratory investigates the molecular mechanisms of immune regulation and cancer immunotherapy, focusing on how T cells recognize and respond to the tumor microenvironment, and develops single-cell and spatial approaches to map the signaling circuits that shape durable anti-tumor responses.';
const READY_SHORT = 'Studies immune regulation and cancer immunotherapy in the tumor microenvironment.';
const SHARED_URL = 'https://medicine.yale.edu/lab/roe/';

type PersistedEntity = { archived?: boolean; fullDescription?: string; shortDescription?: string };

describe('never-demote merge guard', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => vi.clearAllMocks());

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'research_entities',
      'research_entity_redirects',
      'role_assignments',
      'researchers',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedReadyLead = async (entityId: mongoose.Types.ObjectId) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({ _id: personId, displayName: 'Jane Roe', archived: false });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
    });
  };

  it('keeps the identity-preferred shell but hydrates it so the merge does not demote', async () => {
    const shellId = new mongoose.Types.ObjectId();
    const readyId = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').insertMany([
      {
        _id: shellId,
        slug: 'ysm-roe',
        name: 'Roe Lab',
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
        studentVisibilityTier: 'suppressed',
        fullDescription: '',
        shortDescription: '',
        sourceUrls: [SHARED_URL],
      },
      {
        _id: readyId,
        slug: 'ysm-faculty-jane-roe',
        name: 'Roe Lab',
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
        studentVisibilityTier: 'student_ready',
        fullDescription: READY_FULL,
        shortDescription: READY_SHORT,
        sourceUrls: [SHARED_URL],
      },
    ]);
    await seedReadyLead(readyId);

    await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: shellId.toHexString(),
        duplicateEntityIds: [readyId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [SHARED_URL],
      },
      { deleteDuplicates: false, relinkReferences: true, neverDemote: true },
    );

    const shell = await ResearchEntity.findById(shellId).lean<PersistedEntity>();
    const ready = await ResearchEntity.findById(readyId).lean<PersistedEntity>();
    // Preferred shell survives and was hydrated with the student-ready card.
    expect(shell?.archived).not.toBe(true);
    expect(shell?.fullDescription).toBe(READY_FULL);
    expect(shell?.shortDescription).toBe(READY_SHORT);
    expect(ready?.archived).toBe(true);
  });

  it('swaps the survivor to the holding twin and repairs search + recompute against the resolved canonical', async () => {
    const mismatchedShellId = new mongoose.Types.ObjectId();
    const readyId = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').insertMany([
      {
        _id: mismatchedShellId,
        slug: 'ysm-smith',
        name: 'Smith Lab',
        kind: 'lab',
        entityType: 'CENTER',
        archived: false,
        studentVisibilityTier: 'suppressed',
        fullDescription: '',
        shortDescription: '',
        sourceUrls: [SHARED_URL],
      },
      {
        _id: readyId,
        slug: 'ysm-faculty-jane-roe',
        name: 'Roe Lab',
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
        studentVisibilityTier: 'student_ready',
        fullDescription: READY_FULL,
        shortDescription: READY_SHORT,
        sourceUrls: [SHARED_URL],
      },
    ]);
    await seedReadyLead(readyId);

    const result = await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: mismatchedShellId.toHexString(),
        duplicateEntityIds: [readyId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [SHARED_URL],
      },
      { deleteDuplicates: false, relinkReferences: true, neverDemote: true },
    );

    const typedResult = result as { canonicalEntityId: string; duplicateEntityIds: string[] };
    expect(typedResult.canonicalEntityId).toBe(readyId.toHexString());
    expect(typedResult.duplicateEntityIds).toEqual([mismatchedShellId.toHexString()]);

    const shell = await ResearchEntity.findById(mismatchedShellId).lean<PersistedEntity>();
    const ready = await ResearchEntity.findById(readyId).lean<PersistedEntity>();
    expect(ready?.archived).not.toBe(true);
    expect(shell?.archived).toBe(true);

    expect(meiliMocks.deleteFromIndex).toHaveBeenCalledWith(
      'researchEntity',
      mismatchedShellId.toHexString(),
    );
    expect(meiliMocks.deleteFromIndex).not.toHaveBeenCalledWith(
      'researchEntity',
      readyId.toHexString(),
    );
  });

  it('defers rather than demoting when no survivor can hold the best input tier', async () => {
    const shellId = new mongoose.Types.ObjectId();
    const staleReadyId = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').insertMany([
      {
        _id: shellId,
        slug: 'ysm-doe',
        name: 'Doe Lab',
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
        studentVisibilityTier: 'suppressed',
        fullDescription: '',
        shortDescription: '',
        sourceUrls: ['https://medicine.yale.edu/lab/doe/'],
      },
      {
        _id: staleReadyId,
        slug: 'ysm-faculty-john-doe',
        name: 'Doe Lab',
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
        // Stale tier: marked ready but carries no usable content or lead, so no
        // survivor can be hydrated back to student_ready.
        studentVisibilityTier: 'student_ready',
        fullDescription: '',
        shortDescription: '',
        sourceUrls: ['https://medicine.yale.edu/lab/doe/'],
      },
    ]);

    const result = await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: shellId.toHexString(),
        duplicateEntityIds: [staleReadyId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: ['https://medicine.yale.edu/lab/doe/'],
      },
      { deleteDuplicates: false, relinkReferences: true, neverDemote: true },
    );

    expect((result as { deferredAsWouldDemote?: boolean }).deferredAsWouldDemote).toBe(true);
    const shell = await ResearchEntity.findById(shellId).lean<PersistedEntity>();
    const stale = await ResearchEntity.findById(staleReadyId).lean<PersistedEntity>();
    expect(shell?.archived).not.toBe(true);
    expect(stale?.archived).not.toBe(true);
    expect(await ResearchEntityRedirect.countDocuments({})).toBe(0);
  });
});
