import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(true),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue({ updated: 0 }) };
});

import { Observation } from '../../models/observation';
import { materializeEntity } from '../entityMaterializer';

const SLUG = 'synthetic-grant-shell';
const ROSTER_URL = 'https://example.edu/people/synthetic-member';
const RETIRED_REPAIR = 'synthetic-retired-repair';

const legacyEntry = (sourceName: string, extra: Record<string, unknown> = {}) => ({
  sourceName,
  sourceUrl: 'https://reporter.nih.gov/',
  observedAt: new Date('2026-08-24T00:00:00Z'),
  confidence: 0.9,
  ...extra,
});

describe('a fieldProvenance entry naming a lane that never observed the field retires on resolve (#3769)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const collection = () => mongoose.connection.db!.collection('research_entities');

  const seedObservation = async (
    field: string,
    value: unknown,
    sourceName: string,
    superseded = false,
  ) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: ROSTER_URL,
      confidence: 0.8,
      observedAt: new Date('2026-09-20T00:00:00Z'),
      superseded,
    });

  const seedRow = async (fields: Record<string, unknown>) => {
    await collection().insertOne({
      slug: SLUG,
      name: 'Synthetic Member Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
      sourceUrls: [ROSTER_URL],
      manuallyLockedFields: [],
      ...fields,
    });
    await seedObservation('name', 'Synthetic Member Faculty Research', 'dept-faculty-roster');
  };

  const stored = async () => (await collection().findOne({ slug: SLUG })) as Record<string, any>;

  it('retires the attribution and leaves the value it was attached to', async () => {
    await seedRow({ fieldProvenance: { entityType: legacyEntry(RETIRED_REPAIR) } });

    await materializeEntity('researchEntity', { entityKey: SLUG });

    const after = await stored();
    expect(after.fieldProvenance?.entityType).toBeUndefined();
    expect(after.entityType).toBe('FACULTY_RESEARCH_AREA');
  });

  it('plans nothing on a second pass, so the retirement is a derivation rather than a repair', async () => {
    await seedRow({ fieldProvenance: { entityType: legacyEntry(RETIRED_REPAIR) } });
    await materializeEntity('researchEntity', { entityKey: SLUG });

    const second = await materializeEntity('researchEntity', { entityKey: SLUG }, { dryRun: true });

    expect(Object.keys(second.plannedUnset ?? {})).not.toContain('fieldProvenance.entityType');
  });

  it('keeps an attribution whose lane has a superseded observation of the field, because a retracted claim is history', async () => {
    await seedRow({ fieldProvenance: { entityType: legacyEntry('synthetic-grant-lane') } });
    await seedObservation('entityType', 'LAB', 'synthetic-grant-lane', true);

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect((await stored()).fieldProvenance?.entityType?.sourceName).toBe('synthetic-grant-lane');
  });

  it('keeps an entry whose observation was pruned, and the mis-keyed sourceId residue', async () => {
    await seedRow({
      fieldProvenance: {
        entityType: legacyEntry(RETIRED_REPAIR, { observationId: new mongoose.Types.ObjectId() }),
        fullDescription: legacyEntry(RETIRED_REPAIR, { sourceId: new mongoose.Types.ObjectId() }),
      },
      fullDescription: 'A synthetic body about measuring things carefully in a laboratory.',
    });

    await materializeEntity('researchEntity', { entityKey: SLUG });

    const after = await stored();
    expect(after.fieldProvenance?.entityType?.sourceName).toBe(RETIRED_REPAIR);
    expect(after.fieldProvenance?.fullDescription?.sourceName).toBe(RETIRED_REPAIR);
  });

  it('leaves a locked field to the lock release path', async () => {
    await seedRow({
      fieldProvenance: { entityType: legacyEntry(RETIRED_REPAIR) },
      manuallyLockedFields: ['entityType'],
    });

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect((await stored()).fieldProvenance?.entityType?.sourceName).toBe(RETIRED_REPAIR);
  });

  it('can run as a provenance-only pass that rewrites no field the projection would otherwise change', async () => {
    await seedRow({
      name: 'Stale Stored Name',
      fieldProvenance: { entityType: legacyEntry(RETIRED_REPAIR) },
    });

    const plan = await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { dryRun: true, onlyReconcileFieldProvenance: true },
    );
    expect(plan.plannedSet).toEqual({});
    expect(plan.plannedUnset).toEqual({ 'fieldProvenance.entityType': '' });

    await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { onlyReconcileFieldProvenance: true },
    );

    const after = await stored();
    expect(after.fieldProvenance?.entityType).toBeUndefined();
    expect(after.name).toBe('Stale Stored Name');
  });
});
