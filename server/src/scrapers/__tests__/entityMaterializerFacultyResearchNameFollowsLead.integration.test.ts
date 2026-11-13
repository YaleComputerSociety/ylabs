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

const ENTITY_KEY = 'dept-test-rowan-fixture';
const ROSTER_URL = 'https://department.example.edu/people/faculty';
const PAGE_SPELLING_NAME = 'Rowan Q. Fixture Faculty Research';
const LEAD_DISPLAY_NAME = 'Rowan Fixture';
const LEADS_NAME = 'Rowan Fixture Faculty Research';

type PersistedEntity = {
  name?: string;
  displayName?: string;
  entityType?: string;
  updatedAt?: Date;
  fieldProvenance?: Record<string, unknown>;
};

const persisted = () =>
  ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<PersistedEntity>() as Promise<PersistedEntity>;

describe('materializeEntity names a faculty research row after its lead on every resolve (#5967)', () => {
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
      sourceName: 'dept-faculty-roster',
      sourceUrl: ROSTER_URL,
      confidence: 0.7,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
      ...overrides,
    });

  const seedEntity = async (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: ENTITY_KEY,
      name: PAGE_SPELLING_NAME,
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'student_ready',
      archived: false,
      fieldProvenance: {
        name: {
          sourceName: 'dept-faculty-roster',
          observationId: new mongoose.Types.ObjectId(),
          sourceUrl: ROSTER_URL,
        },
      },
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

  const seedRosterRow = async (overrides: Record<string, unknown> = {}) => {
    const entity = await seedEntity(overrides);
    await seedObservation({ field: 'name', value: PAGE_SPELLING_NAME });
    await seedObservation({ field: 'entityType', value: 'FACULTY_RESEARCH_AREA' });
    return entity;
  };

  it('renames the row after its lead even though the roster lane still states the old spelling', async () => {
    const entity = await seedRosterRow({ displayName: PAGE_SPELLING_NAME });
    await seedLead(entity._id);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const stored = await persisted();
    expect(stored.name).toBe(LEADS_NAME);
    expect(stored.displayName).toBe(LEADS_NAME);
    expect((stored.fieldProvenance || {}).name).toBeUndefined();
  });

  it('follows a later rename of the lead on the next resolve', async () => {
    const entity = await seedRosterRow();
    const lead = await seedLead(entity._id);
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    await Researcher.updateOne({ _id: lead._id }, { $set: { displayName: 'Rowan Quill Fixture' } });
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe('Rowan Quill Fixture Faculty Research');
  });

  it('writes nothing on a second resolve', async () => {
    const entity = await seedRosterRow();
    await seedLead(entity._id);
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    const first = await persisted();

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const second = await persisted();
    expect(second.name).toBe(LEADS_NAME);
    expect(second.updatedAt?.getTime()).toBe(first.updatedAt?.getTime());
  });

  it("keeps a name the row's own site declares for itself", async () => {
    const entity = await seedRosterRow();
    await seedLead(entity._id);
    await seedObservation({
      field: 'name',
      value: PAGE_SPELLING_NAME,
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://rowan-fixture.example.edu/',
      confidence: 0.95,
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe(PAGE_SPELLING_NAME);
  });

  it('leaves a lab row named after its lead untouched', async () => {
    const entity = await seedEntity({
      name: 'Fixture Lab',
      kind: 'lab',
      entityType: 'LAB',
      websiteUrl: 'https://fixturelab.example.edu/',
    });
    await seedLead(entity._id);
    await seedObservation({
      field: 'name',
      value: 'Fixture Lab',
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://fixturelab.example.edu/',
      confidence: 0.95,
    });
    await seedObservation({
      field: 'entityType',
      value: 'LAB',
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://fixturelab.example.edu/',
      confidence: 0.95,
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const stored = await persisted();
    expect(stored.name).toBe('Fixture Lab');
    expect(stored.entityType).toBe('LAB');
  });

  it('keeps the name when the lead record now names a different person', async () => {
    const entity = await seedRosterRow();
    await seedLead(entity._id, 'Marisol Kettle-Fixture');

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe(PAGE_SPELLING_NAME);
  });

  it('keeps the name of a row with two leads, since neither one alone names it', async () => {
    const entity = await seedRosterRow();
    await seedLead(entity._id);
    await seedLead(entity._id, 'Tamsin Ledger');

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe(PAGE_SPELLING_NAME);
  });

  it('keeps a name an operator locked', async () => {
    const entity = await seedRosterRow({ manuallyLockedFields: ['name'] });
    await seedLead(entity._id);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe(PAGE_SPELLING_NAME);
  });

  it('keeps the heading a student sees when an operator locked only the name', async () => {
    const entity = await seedRosterRow({
      displayName: PAGE_SPELLING_NAME,
      manuallyLockedFields: ['name'],
    });
    await seedLead(entity._id);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const stored = await persisted();
    expect(stored.name).toBe(PAGE_SPELLING_NAME);
    expect(stored.displayName).toBe(PAGE_SPELLING_NAME);
  });

  it("keeps the name when an operator refused the lead's name for it", async () => {
    const entity = await seedRosterRow({
      fieldValueRefusals: {
        name: [
          {
            valueKey: fieldValueRefusalKey('name', LEADS_NAME),
            rule: 'wrong_owner',
            refusedBy: 'research-entity:refuse-field-value',
            refusedAt: new Date('2026-11-01T00:00:00Z'),
            note: 'synthetic fixture',
          },
        ],
      },
    });
    await seedLead(entity._id);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe(PAGE_SPELLING_NAME);
  });
});
