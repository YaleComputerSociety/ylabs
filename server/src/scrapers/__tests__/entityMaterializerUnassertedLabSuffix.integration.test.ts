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
import { resetKnownPersonSurnameRosterCache } from '../../utils/researchHomeNameIdentityRoster';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'faculty-research-area-rafferty-duchamp';
const LAB_NAME = 'Rafferty Duchamp Lab';
const FACULTY_RESEARCH_NAME = 'Rafferty Duchamp Faculty Research';

type PersistedEntity = {
  name?: string;
  fieldProvenance?: Record<string, unknown>;
};

const persisted = () =>
  ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<PersistedEntity>() as Promise<PersistedEntity>;

describe('materializeEntity derives the faculty research name when nothing asserts a lab suffix (#4638)', () => {
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
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
    resetKnownPersonSurnameRosterCache();
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

  const seedEntity = async (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: ENTITY_KEY,
      name: LAB_NAME,
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'student_ready',
      archived: false,
      fieldProvenance: {
        name: {
          sourceName: 'nsf-award-search',
          observationId: new mongoose.Types.ObjectId(),
          sourceUrl: 'https://api.example.org/awards.json',
        },
      },
      ...overrides,
    });

  it('renames an unbacked lab suffix and drops the provenance of a value nothing observes', async () => {
    await seedEntity();
    await seedObservation({ field: 'departments', value: ['Mathematics'] });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const entity = await persisted();
    expect(entity.name).toBe(FACULTY_RESEARCH_NAME);
    expect((entity.fieldProvenance || {}).name).toBeUndefined();
  });

  it('re-derives the same name on a second pass', async () => {
    await seedEntity();
    await seedObservation({ field: 'departments', value: ['Mathematics'] });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe(FACULTY_RESEARCH_NAME);
  });

  it('applies once the writer has superseded its own lab-suffixed name with a bare person name', async () => {
    await seedEntity();
    await seedObservation({ field: 'name', value: LAB_NAME, superseded: true });
    await seedObservation({
      field: 'name',
      value: 'Rafferty Duchamp',
      observedAt: new Date('2026-02-01T00:00:00Z'),
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe(FACULTY_RESEARCH_NAME);
  });

  it('keeps a lab suffix a live observation asserts, because that name is evidence the type is in doubt', async () => {
    await seedEntity();
    await seedObservation({ field: 'name', value: LAB_NAME });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe(LAB_NAME);
  });

  it('keeps the suffix when a live display name asserts a lab', async () => {
    await seedEntity();
    await seedObservation({ field: 'displayName', value: 'Duchamp Research Group' });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe(LAB_NAME);
  });

  it('leaves a row typed LAB alone', async () => {
    await seedEntity({ kind: 'lab', entityType: 'LAB' });
    await seedObservation({ field: 'departments', value: ['Mathematics'] });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe(LAB_NAME);
  });

  it('leaves a locked name alone', async () => {
    await seedEntity({ manuallyLockedFields: ['name'] });
    await seedObservation({ field: 'departments', value: ['Mathematics'] });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe(LAB_NAME);
  });
});
