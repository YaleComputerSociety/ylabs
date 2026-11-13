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
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import {
  resetKnownPersonSurnameRosterCache,
  resetLabRowRosterCache,
} from '../../utils/researchHomeNameIdentityRoster';
import { fieldValueRefusalKey } from '../../utils/researchEntityFieldValueRefusals';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'dept-faculty-rowan-fixture';
const COLLEAGUE_SITE = 'https://colleague-host.example.edu/';
const COLLEAGUE_LAB_NAME = 'Kettle Host Lab';
const LEAD_DISPLAY_NAME = 'Rowan Fixture';
const LEADS_NAME = 'Rowan Fixture Faculty Research';

type PersistedEntity = {
  name?: string;
  displayName?: string;
  entityType?: string;
  kind?: string;
  updatedAt?: Date;
};

const persisted = () =>
  ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<PersistedEntity>() as Promise<PersistedEntity>;

const wrongOwnerRefusal = (field: string, value: string) => ({
  valueKey: fieldValueRefusalKey(field, value),
  rule: 'wrong_owner',
  refusedBy: 'research-entity:refuse-field-value',
  refusedAt: new Date('2026-11-01T00:00:00Z'),
  note: 'synthetic fixture',
});

describe("materializeEntity names a person's row after its lead once every grafted name and type is refused (#5979 C3)", () => {
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
    await RoleAssignment.deleteMany({});
    await Researcher.deleteMany({});
    resetKnownPersonSurnameRosterCache();
    resetLabRowRosterCache();
  });

  const seedObservation = async (overrides: Record<string, unknown>) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: COLLEAGUE_SITE,
      confidence: 0.95,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
      ...overrides,
    });

  const seedLead = async (entityId: unknown, displayName = LEAD_DISPLAY_NAME) => {
    const lead = await Researcher.create({ displayName, archived: false });
    await RoleAssignment.create({
      personId: lead._id,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      evidenceClaimIds: [],
      confidence: 0.9,
      reviewStatus: 'UNREVIEWED',
      archived: false,
      state: 'CURRENT',
    });
    return lead;
  };

  const seedFullyRefusedRow = async (overrides: Record<string, unknown> = {}) => {
    const _id = new mongoose.Types.ObjectId();
    await ResearchEntity.collection.insertOne({
      _id,
      slug: ENTITY_KEY,
      kind: 'lab',
      sourceUrls: [COLLEAGUE_SITE],
      studentVisibilityTier: 'student_ready',
      archived: false,
      fieldValueRefusals: {
        name: [wrongOwnerRefusal('name', COLLEAGUE_LAB_NAME)],
        displayName: [wrongOwnerRefusal('displayName', COLLEAGUE_LAB_NAME)],
        entityType: [wrongOwnerRefusal('entityType', 'LAB')],
      },
      ...overrides,
    });
    await seedObservation({ field: 'name', value: COLLEAGUE_LAB_NAME });
    await seedObservation({ field: 'displayName', value: COLLEAGUE_LAB_NAME });
    await seedObservation({ field: 'entityType', value: 'LAB' });
    return { _id };
  };

  it("composes the lead's faculty research name and type", async () => {
    const entity = await seedFullyRefusedRow();
    await seedLead(entity._id);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const stored = await persisted();
    expect(stored.name).toBe(LEADS_NAME);
    expect(stored.displayName).toBeUndefined();
    expect(stored.entityType).toBe('FACULTY_RESEARCH_AREA');
  });

  it('keeps a surviving name that is not refused', async () => {
    const entity = await seedFullyRefusedRow();
    await seedLead(entity._id);
    await seedObservation({
      field: 'name',
      value: 'Fixture Lab',
      sourceName: 'dept-faculty-roster',
      sourceUrl: 'https://department.example.edu/people/faculty',
      confidence: 0.7,
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe('Fixture Lab');
  });

  it('leaves a row with two leads untouched', async () => {
    const entity = await seedFullyRefusedRow();
    await seedLead(entity._id);
    await seedLead(entity._id, 'Tamsin Ledger');

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const stored = await persisted();
    expect(stored.name).toBeUndefined();
    expect(stored.entityType).toBeUndefined();
  });

  it('leaves a locked name untouched', async () => {
    const entity = await seedFullyRefusedRow({ manuallyLockedFields: ['name'] });
    await seedLead(entity._id);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const stored = await persisted();
    expect(stored.name).toBeUndefined();
    expect(stored.entityType).toBeUndefined();
  });

  it('leaves the type alone when the faculty research type is refused too', async () => {
    const entity = await seedFullyRefusedRow({
      fieldValueRefusals: {
        name: [wrongOwnerRefusal('name', COLLEAGUE_LAB_NAME)],
        displayName: [wrongOwnerRefusal('displayName', COLLEAGUE_LAB_NAME)],
        entityType: [
          wrongOwnerRefusal('entityType', 'LAB'),
          wrongOwnerRefusal('entityType', 'FACULTY_RESEARCH_AREA'),
        ],
      },
    });
    await seedLead(entity._id);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const stored = await persisted();
    expect(stored.name).toBeUndefined();
    expect(stored.entityType).toBeUndefined();
  });

  it('writes nothing on a second resolve', async () => {
    const entity = await seedFullyRefusedRow();
    await seedLead(entity._id);
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    const first = await persisted();

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const second = await persisted();
    expect(second.name).toBe(LEADS_NAME);
    expect(second.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(second.updatedAt?.getTime()).toBe(first.updatedAt?.getTime());
  });
});
