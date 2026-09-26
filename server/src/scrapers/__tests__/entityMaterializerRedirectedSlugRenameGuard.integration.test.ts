import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntity: vi.fn().mockResolvedValue(undefined),
  deleteFromIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: meiliMocks.syncEntity,
    deleteFromIndex: meiliMocks.deleteFromIndex,
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../entityMaterializer';

const SHELL_SLUG = 'research-yale-imaging-shell';
const CANONICAL_SLUG = 'ysm-imaging-center';

describe('a redirected shell slug is never planned onto the live canonical', () => {
  let replSet: MongoMemoryReplSet;
  let canonicalId: mongoose.Types.ObjectId;
  let shellId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await ResearchEntity.syncIndexes();
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
      'observations',
      'research_entities',
      'research_entity_redirects',
      'role_assignments',
    ]) {
      await db.collection(name).deleteMany({});
    }

    canonicalId = new mongoose.Types.ObjectId();
    shellId = new mongoose.Types.ObjectId();
    await ResearchEntity.create({
      _id: canonicalId,
      slug: CANONICAL_SLUG,
      name: 'Yale Imaging Center',
      kind: 'center',
      entityType: 'CENTER',
      archived: false,
      studentVisibilityTier: 'student_ready',
    });
    await ResearchEntity.create({
      _id: shellId,
      slug: SHELL_SLUG,
      name: 'Yale Imaging Shell',
      kind: 'center',
      entityType: 'CORE_FACILITY',
      archived: true,
      studentVisibilityTier: 'suppressed',
      canonicalGroupId: canonicalId,
    });

    const sourceId = new mongoose.Types.ObjectId();
    for (const [field, value] of [
      ['slug', SHELL_SLUG],
      ['name', 'Yale Imaging Shell Renamed'],
      ['websiteUrl', 'https://research.yale.edu/imaging-shell'],
    ] as const) {
      await Observation.create({
        entityType: 'researchEntity',
        entityKey: SHELL_SLUG,
        field,
        value,
        sourceId,
        sourceName: 'yale-research-official',
        sourceUrl: 'https://research.yale.edu/imaging-shell',
        confidence: 0.9,
        observedAt: new Date('2026-02-01T00:00:00Z'),
        superseded: false,
      });
    }
  });

  it('plans no slug write when the identifier redirected to a different canonical', async () => {
    const result = await materializeEntity(
      'researchEntity',
      { entityKey: SHELL_SLUG },
      { dryRun: true },
    );

    expect(String(result.entityId)).toBe(canonicalId.toHexString());
    expect(result.plannedSet).toBeDefined();
    const plannedFields = Object.keys(result.plannedSet as Record<string, unknown>);
    expect(plannedFields).not.toContain('slug');
    expect(plannedFields).not.toContain('fieldProvenance.slug');
    expect(plannedFields).not.toContain('name');
  });

  it('leaves both slugs intact on apply instead of colliding with the unique index', async () => {
    await materializeEntity('researchEntity', { entityKey: SHELL_SLUG });

    const canonical = await ResearchEntity.findById(canonicalId)
      .select('slug archived')
      .lean<any>();
    const shell = await ResearchEntity.findById(shellId).select('slug archived').lean<any>();
    expect(canonical?.slug).toBe(CANONICAL_SLUG);
    expect(canonical?.archived).toBe(false);
    expect(shell?.slug).toBe(SHELL_SLUG);
  });
});
