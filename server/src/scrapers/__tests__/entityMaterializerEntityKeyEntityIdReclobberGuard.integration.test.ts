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
import {
  entityIdAnchoredObservationsExcludedByEntityKeyScope,
  entityKeyAnchoredObservationsExcludedByEntityIdScope,
  materializeEntity,
} from '../entityMaterializer';

type PersistedEntity = { fullDescription?: string };

const SLUG = 'materializer-reclobber-fixture';
const LOW_CONFIDENCE_WRONG_DESCRIPTION =
  'This lab studies unrelated coastal ecosystem restoration and marine biodiversity.';
const HIGH_CONFIDENCE_CORRECT_DESCRIPTION =
  'This lab studies enzyme kinetics and structural biology using cryo-EM.';

describe('materializeEntity entityKey/entityId re-clobber guard', () => {
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
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedEntity = async (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: SLUG,
      name: 'Reclobber Fixture Lab',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      archived: false,
      ...overrides,
    });

  const seedObservation = async (input: {
    entityKey?: string;
    entityId?: mongoose.Types.ObjectId;
    field: string;
    value: unknown;
    confidence: number;
    sourceName: string;
    observedAt: Date;
  }) =>
    Observation.create({
      entityType: 'researchEntity',
      ...(input.entityKey ? { entityKey: input.entityKey } : {}),
      ...(input.entityId ? { entityId: input.entityId } : {}),
      field: input.field,
      value: input.value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: input.sourceName,
      sourceUrl: 'https://example.edu/source/',
      confidence: input.confidence,
      observedAt: input.observedAt,
      superseded: false,
    });

  it('resolves entityKey-only observations by confidence (baseline)', async () => {
    const entity = await seedEntity();
    await seedObservation({
      entityKey: SLUG,
      field: 'fullDescription',
      value: LOW_CONFIDENCE_WRONG_DESCRIPTION,
      confidence: 0.4,
      sourceName: 'low-confidence-source',
      observedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await seedObservation({
      entityKey: SLUG,
      field: 'fullDescription',
      value: HIGH_CONFIDENCE_CORRECT_DESCRIPTION,
      confidence: 0.9,
      sourceName: 'high-confidence-source',
      observedAt: new Date('2026-01-02T00:00:00Z'),
    });

    await materializeEntity('researchEntity', { entityKey: SLUG }, {});

    const persisted = await ResearchEntity.findById(entity._id).lean<PersistedEntity>();
    expect(persisted?.fullDescription).toBe(HIGH_CONFIDENCE_CORRECT_DESCRIPTION);
  });

  it('resolves entityId-only observations when materializing by entityId (baseline)', async () => {
    const entity = await seedEntity();
    await seedObservation({
      entityId: entity._id,
      field: 'fullDescription',
      value: HIGH_CONFIDENCE_CORRECT_DESCRIPTION,
      confidence: 0.9,
      sourceName: 'high-confidence-source',
      observedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await materializeEntity('researchEntity', { entityId: String(entity._id) }, {});

    const persisted = await ResearchEntity.findById(entity._id).lean<PersistedEntity>();
    expect(persisted?.fullDescription).toBe(HIGH_CONFIDENCE_CORRECT_DESCRIPTION);
  });

  it('never lets an entityKey-scoped materialize silently prefer a lower-confidence value over an entityId-anchored correction (#1131)', async () => {
    const entity = await seedEntity();
    await seedObservation({
      entityKey: SLUG,
      field: 'fullDescription',
      value: LOW_CONFIDENCE_WRONG_DESCRIPTION,
      confidence: 0.4,
      sourceName: 'low-confidence-source',
      observedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await seedObservation({
      entityId: entity._id,
      field: 'fullDescription',
      value: HIGH_CONFIDENCE_CORRECT_DESCRIPTION,
      confidence: 0.9,
      sourceName: 'high-confidence-correction',
      observedAt: new Date('2026-01-05T00:00:00Z'),
    });

    await materializeEntity('researchEntity', { entityKey: SLUG }, {});

    const persisted = await ResearchEntity.findById(entity._id).lean<PersistedEntity>();
    expect(persisted?.fullDescription).toBe(HIGH_CONFIDENCE_CORRECT_DESCRIPTION);
  });

  it('still resolves by confidence, not by which key matched, when the entityKey-scoped value is the stronger one', async () => {
    const entity = await seedEntity();
    await seedObservation({
      entityKey: SLUG,
      field: 'fullDescription',
      value: HIGH_CONFIDENCE_CORRECT_DESCRIPTION,
      confidence: 0.9,
      sourceName: 'high-confidence-source',
      observedAt: new Date('2026-01-05T00:00:00Z'),
    });
    await seedObservation({
      entityId: entity._id,
      field: 'fullDescription',
      value: LOW_CONFIDENCE_WRONG_DESCRIPTION,
      confidence: 0.4,
      sourceName: 'low-confidence-source',
      observedAt: new Date('2026-01-01T00:00:00Z'),
    });

    await materializeEntity('researchEntity', { entityKey: SLUG }, {});

    const persisted = await ResearchEntity.findById(entity._id).lean<PersistedEntity>();
    expect(persisted?.fullDescription).toBe(HIGH_CONFIDENCE_CORRECT_DESCRIPTION);
  });

  it('merges both-keyed and entityId-only observations for the same entity without duplicating rows already in scope', async () => {
    const entity = await seedEntity();
    const bothKeyed = await seedObservation({
      entityKey: SLUG,
      entityId: entity._id,
      field: 'researchAreas',
      value: ['structural biology'],
      confidence: 0.7,
      sourceName: 'both-keyed-source',
      observedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await seedObservation({
      entityId: entity._id,
      field: 'fullDescription',
      value: HIGH_CONFIDENCE_CORRECT_DESCRIPTION,
      confidence: 0.9,
      sourceName: 'entity-id-only-source',
      observedAt: new Date('2026-01-02T00:00:00Z'),
    });

    const entityKeyScoped = await Observation.find({
      entityType: 'researchEntity',
      superseded: false,
      entityKey: SLUG,
    }).lean();
    expect(entityKeyScoped.map((o: any) => String(o._id))).toContain(String(bothKeyed._id));

    const excluded = await entityIdAnchoredObservationsExcludedByEntityKeyScope(
      'researchEntity',
      String(entity._id),
      entityKeyScoped,
    );

    expect(excluded).toHaveLength(1);
    expect(excluded[0].field).toBe('fullDescription');
    expect(excluded.some((o: any) => String(o._id) === String(bothKeyed._id))).toBe(false);
  });

  it('leaves materialization by entityId untouched when no entityKey-only siblings exist', async () => {
    const entity = await seedEntity();
    const excluded = await entityIdAnchoredObservationsExcludedByEntityKeyScope(
      'researchEntity',
      String(entity._id),
      [],
    );
    expect(excluded).toEqual([]);
  });

  it('materializes an entityKey-only description that an entityId-scoped run would otherwise strand (#1485)', async () => {
    const entity = await seedEntity();
    await seedObservation({
      entityKey: SLUG,
      field: 'fullDescription',
      value: HIGH_CONFIDENCE_CORRECT_DESCRIPTION,
      confidence: 0.85,
      sourceName: 'lab-microsite-description-llm',
      observedAt: new Date('2026-01-03T00:00:00Z'),
    });
    await seedObservation({
      entityId: entity._id,
      field: 'researchAreas',
      value: ['structural biology'],
      confidence: 0.7,
      sourceName: 'entity-id-only-source',
      observedAt: new Date('2026-01-04T00:00:00Z'),
    });

    await materializeEntity('researchEntity', { entityId: String(entity._id) }, {});

    const persisted = await ResearchEntity.findById(entity._id).lean<PersistedEntity>();
    expect(persisted?.fullDescription).toBe(HIGH_CONFIDENCE_CORRECT_DESCRIPTION);
  });

  it('pulls entityKey-only siblings missed by an entityId scope without duplicating rows already in scope', async () => {
    const entity = await seedEntity();
    const entityKeyOnly = await seedObservation({
      entityKey: SLUG,
      field: 'fullDescription',
      value: HIGH_CONFIDENCE_CORRECT_DESCRIPTION,
      confidence: 0.85,
      sourceName: 'lab-microsite-description-llm',
      observedAt: new Date('2026-01-03T00:00:00Z'),
    });
    const entityIdScoped = await Observation.find({
      entityType: 'researchEntity',
      superseded: false,
      entityId: entity._id,
    }).lean();

    const excluded = await entityKeyAnchoredObservationsExcludedByEntityIdScope(
      'researchEntity',
      String(entity._id),
      SLUG,
      entityIdScoped,
    );

    expect(excluded).toHaveLength(1);
    expect(String(excluded[0]._id)).toBe(String(entityKeyOnly._id));
  });

  it('never grafts an observation anchored to a different entity id under a shared key (#1131 inverse)', async () => {
    const entity = await seedEntity();
    const otherEntityId = new mongoose.Types.ObjectId();
    await seedObservation({
      entityKey: SLUG,
      entityId: otherEntityId,
      field: 'fullDescription',
      value: LOW_CONFIDENCE_WRONG_DESCRIPTION,
      confidence: 0.95,
      sourceName: 'reassigned-homonym-source',
      observedAt: new Date('2026-01-06T00:00:00Z'),
    });

    const excluded = await entityKeyAnchoredObservationsExcludedByEntityIdScope(
      'researchEntity',
      String(entity._id),
      SLUG,
      [],
    );

    expect(excluded).toEqual([]);
  });

  it('returns nothing when the entity has no resolvable entityKey', async () => {
    const entity = await seedEntity();
    const excluded = await entityKeyAnchoredObservationsExcludedByEntityIdScope(
      'researchEntity',
      String(entity._id),
      undefined,
      [],
    );
    expect(excluded).toEqual([]);
  });
});
