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
import { resetKnownPersonSurnameRosterCache } from '../../utils/researchHomeNameIdentityRoster';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'dept-fixture-engineering-rafferty-duchamp';
const OWN_NAME = 'Rafferty Duchamp Faculty Research';
const OWN_LAB_PAGE = 'https://engineering.yale.edu/research/fixture-imaging/';
const PROFILE_PAGE = 'https://engineering.yale.edu/faculty/load_faculty/0000';
const POSTING_PAGE = 'https://medicine.yale.edu/lab/quill/jobs/quillfellowship/';
const POSTING_NAME = 'The Quill Postdoctoral Fellowship in Widget Research';

type PersistedEntity = {
  name?: string;
  displayName?: string;
  websiteUrl?: string;
  manuallyLockedFields?: string[];
};

const provenance = (sourceName: string, sourceUrl: string) => ({
  sourceName,
  sourceUrl,
  observationId: new mongoose.Types.ObjectId(),
});

const persisted = () =>
  ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<PersistedEntity>() as Promise<PersistedEntity>;

describe('materializeEntity never lets a job or fellowship posting name a row or be its website', () => {
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
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
    resetKnownPersonSurnameRosterCache();
  });

  const seedObservation = (overrides: Record<string, unknown>) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'dept-faculty-roster',
      sourceUrl: OWN_LAB_PAGE,
      confidence: 0.7,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
      ...overrides,
    });

  const seedLead = async () => {
    const entity = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{ _id: unknown }>();
    if (!entity) throw new Error('seed the row before its lead');
    const researcher = await Researcher.create({
      displayName: 'Rafferty Duchamp',
      archived: false,
    });
    await RoleAssignment.create({
      personId: researcher._id,
      target: { kind: 'RESEARCH_ENTITY', id: entity._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      archived: false,
    });
  };

  const seedPersonScopedRow = (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: ENTITY_KEY,
      name: OWN_NAME,
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'operator_review',
      archived: false,
      ...overrides,
    });

  const seedRosterEvidence = async () => {
    await seedObservation({ field: 'slug', value: ENTITY_KEY });
    await seedObservation({ field: 'name', value: OWN_NAME });
    await seedObservation({ field: 'entityType', value: 'FACULTY_RESEARCH_AREA' });
    await seedObservation({ field: 'kind', value: 'individual' });
    await seedObservation({ field: 'sourceUrls', value: [OWN_LAB_PAGE] });
    await seedObservation({
      field: 'websiteUrl',
      value: POSTING_PAGE,
      sourceUrl: PROFILE_PAGE,
      observedAt: new Date('2025-12-01T00:00:00Z'),
    });
  };

  const seedPostingPageName = async () => {
    for (const field of ['name', 'displayName']) {
      await seedObservation({
        field,
        value: POSTING_NAME,
        sourceName: 'lab-microsite-description-llm',
        sourceUrl: POSTING_PAGE,
        confidence: 0.95,
        observedAt: new Date('2026-02-01T00:00:00Z'),
      });
    }
  };

  it('repairs a stored row a fellowship posting named, back to the evidence its own lane states', async () => {
    await seedPersonScopedRow({
      name: POSTING_NAME,
      displayName: POSTING_NAME,
      websiteUrl: POSTING_PAGE,
      fieldProvenance: {
        name: provenance('lab-microsite-description-llm', POSTING_PAGE),
        displayName: provenance('lab-microsite-description-llm', POSTING_PAGE),
        websiteUrl: provenance('dept-faculty-roster', PROFILE_PAGE),
      },
    });
    await seedLead();
    await seedRosterEvidence();
    await seedPostingPageName();

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const entity = await persisted();
    expect(entity.name).toBe(OWN_NAME);
    expect(entity.displayName ?? '').toBe('');
    expect(entity.websiteUrl).not.toBe(POSTING_PAGE);
    expect(entity.manuallyLockedFields ?? []).toEqual([]);
  });

  it('resolves fresh evidence without ever taking the posting', async () => {
    await seedPersonScopedRow();
    await seedLead();
    await seedRosterEvidence();
    await seedPostingPageName();

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const entity = await persisted();
    expect(entity.name).toBe(OWN_NAME);
    expect(entity.displayName ?? '').not.toBe(POSTING_NAME);
    expect(entity.websiteUrl ?? '').not.toBe(POSTING_PAGE);
  });

  it('refuses a fellowship-shaped name even when it cites an ordinary page', async () => {
    await seedPersonScopedRow();
    await seedLead();
    await seedRosterEvidence();
    await seedObservation({
      field: 'name',
      value: POSTING_NAME,
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://medicine.yale.edu/lab/quill/',
      confidence: 0.95,
      observedAt: new Date('2026-02-01T00:00:00Z'),
    });

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe(OWN_NAME);
  });
});
