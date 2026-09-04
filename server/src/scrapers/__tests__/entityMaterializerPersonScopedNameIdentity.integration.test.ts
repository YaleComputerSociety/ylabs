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

const ENTITY_KEY = 'dept-econ-rafferty-duchamp';
const AFFILIATION_GRAFT = 'Yale School of Management';
const OWN_NAME = 'Rafferty Duchamp Faculty Research';

type PersistedEntity = {
  name?: string;
  displayName?: string;
  confidenceByField?: Record<string, number>;
  fieldProvenance?: Record<string, unknown>;
};

const persisted = () =>
  ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<PersistedEntity>() as Promise<PersistedEntity>;

describe('materializeEntity refuses a name that names something other than the record (#2351)', () => {
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

  const seedObservation = async (overrides: Record<string, unknown>) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://www.example.com/rafferty-duchamp/',
      confidence: 0.95,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
      ...overrides,
    });

  const seedPersonScopedEntity = async (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: ENTITY_KEY,
      name: OWN_NAME,
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'student_ready',
      archived: false,
      ...overrides,
    });

  it('clears an already-stored affiliation graft even though no observation resolves the field', async () => {
    await seedPersonScopedEntity({
      displayName: AFFILIATION_GRAFT,
      confidenceByField: { displayName: 0.95 },
      fieldProvenance: {
        displayName: {
          sourceName: 'lab-microsite-description-llm',
          sourceUrl: 'https://www.example.com/rafferty-duchamp/',
        },
      },
    });
    await seedObservation({ field: 'departments', value: ['Economics'] });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const entity = await persisted();
    expect(entity.displayName ?? '').toBe('');
    expect(entity.name).toBe(OWN_NAME);
    expect(entity.confidenceByField?.displayName).toBeUndefined();
    expect((entity.fieldProvenance || {}).displayName).toBeUndefined();
  });

  it('prefers a surviving observation over clearing the field', async () => {
    await seedPersonScopedEntity({ displayName: AFFILIATION_GRAFT });
    await seedObservation({ field: 'displayName', value: 'Duchamp Reporting Lab' });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).displayName).toBe('Duchamp Reporting Lab');
  });

  it('refuses a freshly observed graft from any source, not only the microsite extractor', async () => {
    await seedPersonScopedEntity();
    await seedObservation({
      field: 'displayName',
      value: 'Liver Center',
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: 'https://medicine.example.edu/profile/rafferty-duchamp/',
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).displayName ?? '').toBe('');
  });

  it('never leaves a record nameless: a grafted name with no surviving candidate is kept', async () => {
    await seedPersonScopedEntity({ name: AFFILIATION_GRAFT });
    await seedObservation({ field: 'departments', value: ['Economics'] });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe(AFFILIATION_GRAFT);
  });

  it('moves a grafted name to the ranked candidate that passes', async () => {
    await seedPersonScopedEntity({ name: AFFILIATION_GRAFT });
    await seedObservation({
      field: 'name',
      value: OWN_NAME,
      sourceName: 'dept-faculty-roster',
      sourceUrl: 'https://economics.example.edu/people',
      confidence: 0.7,
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe(OWN_NAME);
  });

  it('judges a replacement candidate against its own provenance, not the refused value provenance', async () => {
    await seedPersonScopedEntity({
      displayName: 'Liver Center',
      fieldProvenance: {
        displayName: {
          sourceName: 'official-profile-pi-backfill',
          sourceUrl: 'https://medicine.example.edu/liver-center/',
        },
      },
    });
    await seedObservation({
      field: 'displayName',
      value: 'The Liu Lab',
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: 'https://medicine.example.edu/lab/liu/',
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).displayName ?? '').toBe('');
  });

  it('leaves an organization-shaped record own organization name alone', async () => {
    await ResearchEntity.create({
      slug: ENTITY_KEY,
      name: 'Yale Center for Customer Insights',
      displayName: 'Yale Center for Customer Insights',
      kind: 'center',
      entityType: 'CENTER',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await seedObservation({ field: 'departments', value: ['Economics'] });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const entity = await persisted();
    expect(entity.name).toBe('Yale Center for Customer Insights');
    expect(entity.displayName).toBe('Yale Center for Customer Insights');
  });

  it('leaves a manually locked displayName alone', async () => {
    await seedPersonScopedEntity({
      displayName: AFFILIATION_GRAFT,
      manuallyLockedFields: ['displayName'],
    });
    await seedObservation({ field: 'departments', value: ['Economics'] });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).displayName).toBe(AFFILIATION_GRAFT);
  });
});
