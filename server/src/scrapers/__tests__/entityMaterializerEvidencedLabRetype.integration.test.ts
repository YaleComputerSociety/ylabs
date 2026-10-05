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
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { isUnbackedLabNameShell } from '../../services/studentVisibilityTier';
import {
  resetKnownPersonSurnameRosterCache,
  resetLabRowRosterCache,
} from '../../utils/researchHomeNameIdentityRoster';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'faculty-research-area-rafferty-duchamp';
const PROFILE_URL = 'https://www.example.edu/profile/rafferty-duchamp/';
const OFFICIAL_BODY =
  'The Duchamp Lab investigates how tidal currents sort estuarine sediment, combining field coring with flume experiments and numerical models.';

type PersistedEntity = { name?: string; kind?: string; entityType?: string };

const persisted = () =>
  ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<PersistedEntity>() as Promise<PersistedEntity>;

const lead = async (entityId: unknown, displayName: string) => {
  const person = await Researcher.create({ displayName, archived: false });
  await RoleAssignment.create({
    personId: person._id,
    target: { kind: 'RESEARCH_ENTITY', id: entityId },
    role: 'PI',
    evidenceClaimIds: [],
    confidence: 0.9,
    reviewStatus: 'UNREVIEWED',
    archived: false,
    state: 'CURRENT',
  });
  return person;
};

const leadAs = async (entityId: unknown, personId: unknown) =>
  RoleAssignment.create({
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: entityId },
    role: 'PI',
    evidenceClaimIds: [],
    confidence: 0.9,
    reviewStatus: 'UNREVIEWED',
    archived: false,
    state: 'CURRENT',
  });

describe('materializeEntity retypes a faculty research row its own evidence names as a lab', () => {
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
    for (const name of ['observations', 'research_entities', 'researchers', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
    resetKnownPersonSurnameRosterCache();
    resetLabRowRosterCache();
  });

  const seedEntity = (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: ENTITY_KEY,
      name: 'Rafferty Duchamp Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      sourceUrls: [PROFILE_URL],
      archived: false,
      ...overrides,
    });

  const seedObservation = (overrides: Record<string, unknown>) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'ysm-faculty-directory',
      sourceUrl: PROFILE_URL,
      confidence: 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
      ...overrides,
    });

  const seedOfficialBody = (sourceName = 'ysm-faculty-directory', value = OFFICIAL_BODY) =>
    seedObservation({ field: 'fullDescription', value, sourceName });

  const materialize = () => materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

  it('retypes a row whose official profile text names its lab', async () => {
    const entity = await seedEntity();
    await lead(entity._id, 'Rafferty Duchamp');
    await seedOfficialBody();

    await materialize();

    const after = await persisted();
    expect(after.entityType).toBe('LAB');
    expect(after.kind).toBe('lab');
    expect(after.name).toBe('Duchamp Lab');
  });

  it('retypes a row that cites a lab site named for its lead', async () => {
    const entity = await seedEntity({ websiteUrl: 'https://duchamplab.example.edu/' });
    await lead(entity._id, 'Rafferty Duchamp');
    await seedObservation({ field: 'departments', value: ['Geology'] });

    await materialize();

    expect((await persisted()).entityType).toBe('LAB');
  });

  it('re-derives the same lab on a second pass, and the gate does not call its name unbacked', async () => {
    const entity = await seedEntity();
    await lead(entity._id, 'Rafferty Duchamp');
    await seedOfficialBody();

    await materialize();
    await materialize();

    const after = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<Record<string, any>>();
    expect(after?.entityType).toBe('LAB');
    expect(after?.name).toBe('Duchamp Lab');
    expect(isUnbackedLabNameShell(after ?? {})).toBe(false);
  });

  it('uses the full name when another person already holds the surname lab name', async () => {
    const other = await ResearchEntity.create({
      slug: 'duchamp-lab-other',
      name: 'Duchamp Lab',
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
    });
    await lead(other._id, 'Ines Duchamp');
    const entity = await seedEntity();
    await lead(entity._id, 'Rafferty Duchamp');
    await seedOfficialBody();

    await materialize();
    await materialize();

    const after = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<Record<string, any>>();
    expect(after?.entityType).toBe('LAB');
    expect(after?.name).toBe('Rafferty Duchamp Lab');
    expect(isUnbackedLabNameShell(after ?? {}, 'Rafferty Duchamp')).toBe(false);
  });

  it('leaves the row for a merge when the lead already has a lab row', async () => {
    const entity = await seedEntity();
    const person = await lead(entity._id, 'Rafferty Duchamp');
    const existingLab = await ResearchEntity.create({
      slug: 'duchamp-lab',
      name: 'Duchamp Lab',
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
    });
    await leadAs(existingLab._id, person._id);
    await seedOfficialBody();

    await materialize();

    expect((await persisted()).entityType).toBe('FACULTY_RESEARCH_AREA');
  });

  it('leaves a row whose cited lab site is also another person lab row', async () => {
    const other = await ResearchEntity.create({
      slug: 'duchamp-lab-other',
      name: 'Ines Duchamp Lab',
      kind: 'lab',
      entityType: 'LAB',
      websiteUrl: 'https://duchamplab.example.edu/',
      archived: false,
    });
    await lead(other._id, 'Ines Duchamp');
    const entity = await seedEntity({ websiteUrl: 'https://duchamplab.example.edu/people/' });
    await lead(entity._id, 'Rafferty Duchamp');
    await seedObservation({ field: 'departments', value: ['Geology'] });

    await materialize();

    expect((await persisted()).entityType).toBe('FACULTY_RESEARCH_AREA');
  });

  it('leaves a row whose cited path-style lab site is another person lab row', async () => {
    const other = await ResearchEntity.create({
      slug: 'duchamp-lab-other',
      name: 'Duchamp Lab',
      kind: 'lab',
      entityType: 'LAB',
      websiteUrl: 'https://medicine.example.edu/lab/duchamp/',
      archived: false,
    });
    await lead(other._id, 'Ines Duchamp');
    const entity = await seedEntity({
      websiteUrl: 'https://medicine.example.edu/lab/duchamp/people/',
    });
    await lead(entity._id, 'Rafferty Duchamp');
    await seedObservation({ field: 'departments', value: ['Geology'] });

    await materialize();

    expect((await persisted()).entityType).toBe('FACULTY_RESEARCH_AREA');
  });

  it('leaves a co-led row', async () => {
    const entity = await seedEntity();
    await lead(entity._id, 'Rafferty Duchamp');
    await lead(entity._id, 'Ines Marlowe');
    await seedOfficialBody();

    await materialize();

    expect((await persisted()).entityType).toBe('FACULTY_RESEARCH_AREA');
  });

  it('leaves a row with no lead', async () => {
    await seedEntity();
    await seedOfficialBody();

    await materialize();

    expect((await persisted()).entityType).toBe('FACULTY_RESEARCH_AREA');
  });

  it('does not count LLM-written text, or the full-name form, as lab evidence', async () => {
    const entity = await seedEntity();
    await lead(entity._id, 'Rafferty Duchamp');
    await seedOfficialBody('lab-microsite-description-llm');
    await materialize();
    expect((await persisted()).entityType).toBe('FACULTY_RESEARCH_AREA');

    await Observation.deleteMany({});
    await seedOfficialBody(
      'official-profile-enrichment',
      'The Rafferty Duchamp Lab investigates how tidal currents sort estuarine sediment, combining field coring with flume experiments.',
    );
    resetLabRowRosterCache();
    await materialize();
    expect((await persisted()).entityType).toBe('FACULTY_RESEARCH_AREA');
  });

  it('leaves a row whose type is locked', async () => {
    const entity = await seedEntity({ manuallyLockedFields: ['entityType'] });
    await lead(entity._id, 'Rafferty Duchamp');
    await seedOfficialBody();

    await materialize();

    expect((await persisted()).entityType).toBe('FACULTY_RESEARCH_AREA');
  });
});
