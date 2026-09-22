import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
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

const RETIRED_ENTITY_TYPE = 'COLLECTIONS_INITIATIVE';
const SLUG = 'enum-drift-fixture';

describe('materializer writes cannot disagree with the schema enums', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri(), { autoIndex: false });
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
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedObservation = async (field: string, value: unknown) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://example.edu/lab/',
      confidence: 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  };

  const stored = () => ResearchEntity.findOne({ slug: SLUG }).lean<Record<string, any>>();

  it('rematerializes a row holding a retired entityType without re-asserting it', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    // Inserted through the driver on purpose: Model.create runs full document
    // validators, so the only way a retired enum member reaches storage is the
    // unvalidated update path this test exists to close.
    await db.collection('research_entities').insertOne({
      slug: SLUG,
      name: 'Enum Drift Center',
      kind: 'center',
      entityType: RETIRED_ENTITY_TYPE,
      studentVisibilityTier: 'operator_review',
      archived: true,
      manuallyLockedFields: [],
    });
    await seedObservation('name', 'Enum Drift Center Renamed');
    await seedObservation('entityType', RETIRED_ENTITY_TYPE);

    const result = await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(result.skipped).toBeUndefined();
    const doc = await stored();
    expect(doc?.name).toBe('Enum Drift Center Renamed');
    expect(doc?.entityType).toBe(RETIRED_ENTITY_TYPE);
  });

  it('does not plan an entityType the schema rejects', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').insertOne({
      slug: SLUG,
      name: 'Enum Drift Center',
      kind: 'center',
      entityType: RETIRED_ENTITY_TYPE,
      studentVisibilityTier: 'operator_review',
      archived: true,
      manuallyLockedFields: [],
    });
    await seedObservation('name', 'Enum Drift Center Renamed');
    await seedObservation('entityType', RETIRED_ENTITY_TYPE);

    const plan = await materializeEntity('researchEntity', { entityKey: SLUG }, { dryRun: true });

    expect(plan.plannedSet?.entityType).toBeUndefined();
  });

  it('refuses a write whose value the schema enum omits instead of persisting it', async () => {
    const entityTypePath: any = ResearchEntity.schema.path('entityType');
    const declared: string[] = [...entityTypePath.enumValues];
    const narrowed = declared.filter((value) => value !== 'CENTER');
    entityTypePath.enumValues.length = 0;
    entityTypePath.enumValues.push(...narrowed);
    try {
      await ResearchEntity.create({
        slug: SLUG,
        name: 'Enum Drift Center',
        kind: 'center',
        entityType: 'INSTITUTE',
        studentVisibilityTier: 'operator_review',
        archived: false,
      });
      await seedObservation('name', 'Enum Drift Center');
      await seedObservation('entityType', 'CENTER');

      const plan = await materializeEntity('researchEntity', { entityKey: SLUG }, { dryRun: true });
      expect(plan.plannedSet?.entityType).toBe('CENTER');

      await expect(materializeEntity('researchEntity', { entityKey: SLUG })).rejects.toThrow(
        /validation failed|ValidationError/i,
      );
      const doc = await stored();
      expect(doc?.entityType).toBe('INSTITUTE');
    } finally {
      entityTypePath.enumValues.length = 0;
      entityTypePath.enumValues.push(...declared);
    }
  });
});
