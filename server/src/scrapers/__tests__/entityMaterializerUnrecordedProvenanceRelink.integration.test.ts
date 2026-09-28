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
import {
  materializeEntity,
  NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
  projectFromLog,
} from '../entityMaterializer';

const SLUG = 'synthetic-inherited-row';
const ROSTER_URL = 'https://example.edu/people/synthetic-member';
const INHERITING_LANE = 'synthetic-inheriting-lane';
const WINNING_LANE = 'synthetic-winning-lane';
const INHERITED_TYPE = 'FACULTY_RESEARCH_AREA';

const unrecordedEntry = (sourceName: string) => ({
  sourceName,
  sourceUrl: '',
  observedAt: new Date('2026-09-01T00:00:00Z'),
  confidence: 0.5,
});

describe('an entry naming a real observation it never recorded is relinked on resolve (#3788)', () => {
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
    overrides: Record<string, unknown> = {},
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
      superseded: false,
      ...overrides,
    });

  const seedRow = async (fields: Record<string, unknown> = {}) => {
    await collection().insertOne({
      slug: SLUG,
      name: 'Synthetic Member Faculty Research',
      kind: 'individual',
      entityType: INHERITED_TYPE,
      archived: false,
      sourceUrls: [ROSTER_URL],
      manuallyLockedFields: [],
      fieldProvenance: { entityType: unrecordedEntry(INHERITING_LANE) },
      ...fields,
    });
    await seedObservation('name', 'Synthetic Member Faculty Research', 'dept-faculty-roster');
  };

  const stored = async () => (await collection().findOne({ slug: SLUG })) as Record<string, any>;

  it('records the one live observation whose value the row stores, and keeps the rest of the entry', async () => {
    await seedRow();
    const observation = await seedObservation('entityType', INHERITED_TYPE, INHERITING_LANE);

    await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { onlyReconcileFieldProvenance: true },
    );

    const entry = (await stored()).fieldProvenance?.entityType;
    expect(String(entry?.observationId)).toBe(String(observation._id));
    expect(String(entry?.sourceId)).toBe(String(observation.sourceId));
    expect(entry).toMatchObject({ sourceName: INHERITING_LANE, sourceUrl: '', confidence: 0.5 });
    expect(Object.keys(entry ?? {})).toEqual([
      'sourceId',
      'sourceName',
      'sourceUrl',
      'observationId',
      'observedAt',
      'confidence',
    ]);
  });

  it('relinks during an ordinary resolve that leaves the stored value standing', async () => {
    await seedRow();
    const observation = await seedObservation('entityType', INHERITED_TYPE, INHERITING_LANE);

    const projection = await projectFromLog('researchEntity', {
      resolved: {},
      nameIdentityAuthority: NO_RESEARCH_ENTITY_NAME_IDENTITY_AUTHORITY,
      manuallyLockedFields: [],
      manualValues: {},
      entityDoc: await stored(),
      materializationObs: [],
      resolverObs: [],
      fullDescriptionShellGated: false,
      now: new Date('2026-09-28T00:00:00Z'),
      synthesizeCardDescription: async () => '',
    });

    expect(Object.keys(projection.relinkedProvenance)).toEqual(['entityType']);
    const relinked = projection.set['fieldProvenance.entityType'] as { observationId?: unknown };
    expect(String(relinked?.observationId)).toBe(String(observation._id));
    expect(projection.set.entityType).toBeUndefined();
  });

  it('plans nothing on a second pass, so the relink is a derivation rather than a repair', async () => {
    await seedRow();
    await seedObservation('entityType', INHERITED_TYPE, INHERITING_LANE);
    await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { onlyReconcileFieldProvenance: true },
    );
    expect((await stored()).fieldProvenance?.entityType?.observationId).toBeDefined();

    const second = await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { dryRun: true, onlyReconcileFieldProvenance: true },
    );

    expect(second.plannedSet).toEqual({});
    expect(second.plannedUnset).toEqual({});
  });

  it('leaves the entry alone when two live observations of the lane state the stored value', async () => {
    await seedRow();
    await seedObservation('entityType', INHERITED_TYPE, INHERITING_LANE);
    await seedObservation('entityType', INHERITED_TYPE, INHERITING_LANE, {
      observedAt: new Date('2026-09-21T00:00:00Z'),
    });

    await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { onlyReconcileFieldProvenance: true },
    );

    const entry = (await stored()).fieldProvenance?.entityType;
    expect(entry?.sourceName).toBe(INHERITING_LANE);
    expect(entry?.observationId).toBeUndefined();
  });

  it('never links an observation of a different value, a superseded one, or another lane', async () => {
    await seedRow();
    await seedObservation('entityType', 'LAB', INHERITING_LANE);
    await seedObservation('entityType', INHERITED_TYPE, INHERITING_LANE, { superseded: true });
    await seedObservation('entityType', INHERITED_TYPE, WINNING_LANE);

    await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { onlyReconcileFieldProvenance: true },
    );

    const entry = (await stored()).fieldProvenance?.entityType;
    expect(entry?.sourceName).toBe(INHERITING_LANE);
    expect(entry?.observationId).toBeUndefined();
  });

  it('leaves a locked field to the lock release path', async () => {
    await seedRow({ manuallyLockedFields: ['entityType'] });
    await seedObservation('entityType', INHERITED_TYPE, INHERITING_LANE);

    await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { onlyReconcileFieldProvenance: true },
    );

    expect((await stored()).fieldProvenance?.entityType?.observationId).toBeUndefined();
  });
});
