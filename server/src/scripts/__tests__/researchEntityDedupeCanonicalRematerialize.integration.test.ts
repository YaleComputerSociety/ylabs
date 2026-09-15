import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
  isSyncableEntityType: vi.fn(() => true),
}));

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
  isSyncableEntityType: meiliMocks.isSyncableEntityType,
}));

import { ResearchEntity } from '../../models/researchEntity';
import { applyResearchEntityDedupeMergeGroup } from '../dedupeResearchEntitiesByPi';

const SURVIVOR_SLUG = 'ysm-faculty-first-researcher';
const TWIN_SLUG = 'dept-numbers-first-researcher';
const SHARED_URL = 'https://numbers.example.edu/profile/first-researcher';
const TWIN_METHODS = ['synthetic method one', 'synthetic method two'];
const TWIN_EVIDENCE_QUOTE = 'Undergraduates join the group for a term of independent study.';

type PersistedEntity = {
  archived?: boolean;
  methods?: string[];
  undergradEvidenceQuote?: string;
};

const entityDoc = (
  id: mongoose.Types.ObjectId,
  slug: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  _id: id,
  slug,
  name: 'First Researcher Faculty Research',
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  archived: false,
  studentVisibilityTier: 'student_ready',
  shortDescription: 'Studies counting.',
  fullDescription: 'A'.repeat(400),
  sourceUrls: [SHARED_URL],
  ...extra,
});

const observationDoc = (
  entityId: mongoose.Types.ObjectId,
  entityKey: string,
  field: string,
  value: unknown,
): Record<string, unknown> => ({
  entityType: 'researchEntity',
  entityId,
  entityKey,
  field,
  value,
  sourceId: new mongoose.Types.ObjectId(),
  sourceName: 'synthetic-department-roster',
  sourceUrl: SHARED_URL,
  confidence: 0.9,
  observedAt: new Date('2026-09-01T00:00:00.000Z'),
  superseded: false,
});

describe('dedupe merge canonical rematerialization', () => {
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
      'observations',
      'sources',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedGroup = async () => {
    const survivorId = new mongoose.Types.ObjectId();
    const twinId = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db
      .collection('research_entities')
      .insertMany([
        entityDoc(survivorId, SURVIVOR_SLUG),
        entityDoc(twinId, TWIN_SLUG, {
          methods: TWIN_METHODS,
          undergradEvidenceQuote: TWIN_EVIDENCE_QUOTE,
        }),
      ]);
    // The twin's evidence, which the merge relinks onto the survivor. `methods` is
    // observation-backed and outside the merge carry list, so it is exactly what a
    // re-projection recovers and a carry-only merge drops.
    await db
      .collection('observations')
      .insertMany([
        observationDoc(twinId, TWIN_SLUG, 'methods', TWIN_METHODS),
        observationDoc(twinId, TWIN_SLUG, 'shortDescription', 'Studies counting.'),
      ]);
    return { survivorId, twinId };
  };

  const mergeGroup = (survivorId: mongoose.Types.ObjectId, twinId: mongoose.Types.ObjectId) => ({
    canonicalEntityId: survivorId.toHexString(),
    duplicateEntityIds: [twinId.toHexString()],
    mergedDepartments: [],
    mergedResearchAreas: [],
    mergedSourceUrls: [SHARED_URL],
  });

  it('leaves a field outside the carry list on the archived twin by default', async () => {
    const { survivorId, twinId } = await seedGroup();

    const result = await applyResearchEntityDedupeMergeGroup(mergeGroup(survivorId, twinId), {
      deleteDuplicates: false,
      relinkReferences: true,
    });

    const survivor = await ResearchEntity.findById(survivorId).lean<PersistedEntity>();
    expect(result.canonicalRematerialization.attempted).toBe(false);
    expect(survivor?.methods ?? []).toEqual([]);
  });

  it('recovers that field from the relinked evidence when asked to rematerialize', async () => {
    const { survivorId, twinId } = await seedGroup();

    const result = await applyResearchEntityDedupeMergeGroup(mergeGroup(survivorId, twinId), {
      deleteDuplicates: false,
      relinkReferences: true,
      rematerializeCanonical: true,
    });

    const survivor = await ResearchEntity.findById(survivorId).lean<PersistedEntity>();
    expect(result.canonicalRematerialization.attempted).toBe(true);
    expect(survivor?.methods).toEqual(TWIN_METHODS);
    expect(result.canonicalRematerialization.changedFields).toContain('methods');
  });

  it('does not rematerialize when references were not relinked', async () => {
    const { survivorId, twinId } = await seedGroup();

    const result = await applyResearchEntityDedupeMergeGroup(mergeGroup(survivorId, twinId), {
      deleteDuplicates: false,
      relinkReferences: false,
      rematerializeCanonical: true,
    });

    expect(result.canonicalRematerialization.attempted).toBe(false);
  });

  it('never trades a description the survivor already holds for a thinner projection', async () => {
    const survivorId = new mongoose.Types.ObjectId();
    const twinId = new mongoose.Types.ObjectId();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const richFull = 'B'.repeat(1200);
    await db
      .collection('research_entities')
      .insertMany([
        entityDoc(survivorId, SURVIVOR_SLUG, { fullDescription: richFull }),
        entityDoc(twinId, TWIN_SLUG, { methods: TWIN_METHODS }),
      ]);
    await db
      .collection('observations')
      .insertMany([
        observationDoc(twinId, TWIN_SLUG, 'methods', TWIN_METHODS),
        observationDoc(twinId, TWIN_SLUG, 'fullDescription', 'a much thinner paragraph'),
      ]);

    const result = await applyResearchEntityDedupeMergeGroup(mergeGroup(survivorId, twinId), {
      deleteDuplicates: false,
      relinkReferences: true,
      rematerializeCanonical: true,
    });

    const survivor = await ResearchEntity.findById(survivorId).lean<
      PersistedEntity & { fullDescription?: string }
    >();
    expect(survivor?.fullDescription).toBe(richFull);
    expect(result.canonicalRematerialization.filledFields).not.toContain('fullDescription');
    expect(survivor?.methods).toEqual(TWIN_METHODS);
  });
});
