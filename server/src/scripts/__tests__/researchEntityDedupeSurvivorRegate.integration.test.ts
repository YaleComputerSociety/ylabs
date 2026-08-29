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
import { publicStudentVisibilityTiers } from '../../models/studentVisibility';
import { resolveArchivedResearchEntityCanonicalSlug } from '../../services/researchGroupService';
import { applyResearchEntityDedupeMergeGroup } from '../dedupeResearchEntitiesByPi';

const SHARED_URL = 'https://medicine.yale.edu/lab/roe/';
const READY_FULL =
  'The Roe Laboratory investigates the molecular mechanisms of immune regulation and cancer immunotherapy, focusing on how T cells recognize and respond to the tumor microenvironment, and develops single-cell and spatial approaches to map the signaling circuits that shape durable anti-tumor responses.';
const READY_SHORT =
  'Studies immune regulation and cancer immunotherapy in the tumor microenvironment.';

type PersistedVisibility = {
  slug?: string;
  archived?: boolean;
  studentVisibilityTier?: string;
  studentVisibilityReasons?: string[];
};

const publicTiers = new Set<string>(publicStudentVisibilityTiers);

describe('merge survivor re-gate (issue #2210)', () => {
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
      'visibility_release_queue_items',
      'signals',
      'observations',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedPi = async (entityId: mongoose.Types.ObjectId) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: 'Jane Roe',
      firstName: 'Jane',
      lastName: 'Roe',
      netid: 'jr9999',
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
    });
    return personId;
  };

  const seedDuplicatePairSharingOneUrl = async (survivorTier: string) => {
    const survivorId = new mongoose.Types.ObjectId();
    const loserId = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').insertMany([
      {
        _id: survivorId,
        slug: 'ysm-faculty-jane-roe',
        name: 'Roe Lab',
        displayName: 'Roe Lab',
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
        // Stale pre-merge suppression: the only blockers are the duplicate risks
        // that exist purely because the twin below is still live.
        studentVisibilityTier: survivorTier,
        studentVisibilityReasons: ['exact_url_duplicate_risk', 'duplicate_risk'],
        fullDescription: READY_FULL,
        shortDescription: READY_SHORT,
        websiteUrl: SHARED_URL,
        sourceUrls: [SHARED_URL],
      },
      {
        _id: loserId,
        slug: 'dept-mcdb-jane-roe',
        name: 'Roe Lab',
        displayName: 'Roe Lab',
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
        studentVisibilityTier: 'student_ready',
        studentVisibilityReasons: ['source_backed_description'],
        fullDescription: READY_FULL,
        shortDescription: READY_SHORT,
        websiteUrl: SHARED_URL,
        sourceUrls: [SHARED_URL],
      },
    ]);
    await seedPi(loserId);
    return { survivorId, loserId };
  };

  const mergeLoserIntoSurvivor = (
    survivorId: mongoose.Types.ObjectId,
    loserId: mongoose.Types.ObjectId,
  ) =>
    applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: survivorId.toHexString(),
        duplicateEntityIds: [loserId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [SHARED_URL],
      } as any,
      { deleteDuplicates: false, relinkReferences: true },
    );

  it('promotes the survivor out of duplicate-only suppression and makes the archived slug redirect', async () => {
    const { survivorId, loserId } = await seedDuplicatePairSharingOneUrl('suppressed');

    const result = (await mergeLoserIntoSurvivor(survivorId, loserId)) as {
      survivorVisibility?: { regated?: boolean; tierBefore?: string; tierAfter?: string };
    };

    expect(result.survivorVisibility?.regated).toBe(true);
    expect(result.survivorVisibility?.tierBefore).toBe('suppressed');

    const survivor = await ResearchEntity.findById(survivorId).lean<PersistedVisibility>();
    expect(survivor?.archived).not.toBe(true);
    expect(publicTiers.has(String(survivor?.studentVisibilityTier))).toBe(true);
    expect(survivor?.studentVisibilityReasons).not.toContain('duplicate_risk');
    expect(survivor?.studentVisibilityReasons).not.toContain('exact_url_duplicate_risk');

    const loser = await ResearchEntity.findById(loserId).lean<PersistedVisibility>();
    expect(loser?.archived).toBe(true);

    await expect(resolveArchivedResearchEntityCanonicalSlug('dept-mcdb-jane-roe')).resolves.toBe(
      'ysm-faculty-jane-roe',
    );
  }, 60000);

  it('leaves an already-servable survivor untouched instead of paying for a re-gate', async () => {
    const { survivorId, loserId } = await seedDuplicatePairSharingOneUrl('student_ready');

    const result = (await mergeLoserIntoSurvivor(survivorId, loserId)) as {
      survivorVisibility?: { regated?: boolean; tierBefore?: string };
    };

    expect(result.survivorVisibility?.regated).toBe(false);
    expect(result.survivorVisibility?.tierBefore).toBe('student_ready');

    const survivor = await ResearchEntity.findById(survivorId).lean<PersistedVisibility>();
    expect(survivor?.studentVisibilityTier).toBe('student_ready');
    expect(survivor?.studentVisibilityReasons).toEqual([
      'exact_url_duplicate_risk',
      'duplicate_risk',
    ]);
  }, 60000);
});
