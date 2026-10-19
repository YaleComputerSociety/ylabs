import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
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
import { materializeEntity } from '../entityMaterializer';

const LANE = 'official-profile-pi-backfill';
const LEAD_NAME = 'Synthetic Member';
const ORGANIZATION = 'Fixture Coastal Studies Collaborative';
const PROFILE_URL = 'https://synthetic.yale.edu/profile/synthetic-member/';
const earlierRun = new mongoose.Types.ObjectId();
const laterRun = new mongoose.Types.ObjectId();

type Stored = { name?: string; displayName?: string; entityType?: string; kind?: string };

describe("a profile lane's organization claim on a person's row (#5283)", () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => vi.clearAllMocks());

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'researchers', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seed = (
    slug: string,
    field: string,
    value: unknown,
    options: { sourceName?: string; confidence?: number; run?: mongoose.Types.ObjectId } = {},
  ) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: slug,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: options.sourceName ?? LANE,
      ...(options.run ? { scrapeRunId: options.run } : {}),
      sourceUrl: PROFILE_URL,
      confidence: options.confidence ?? 0.96,
      observedAt: new Date(
        options.run === laterRun ? '2026-10-16T00:00:00Z' : '2026-07-25T00:00:00Z',
      ),
      superseded: false,
    });

  const seedRetypedRow = async (slug: string, withLead: boolean) => {
    const row = await ResearchEntity.create({
      slug,
      name: ORGANIZATION,
      displayName: ORGANIZATION,
      kind: 'initiative',
      entityType: 'INITIATIVE',
      archived: false,
      sourceUrls: [PROFILE_URL],
      fieldProvenance: {
        name: {
          sourceName: LANE,
          sourceUrl: PROFILE_URL,
          observationId: new mongoose.Types.ObjectId(),
        },
        displayName: {
          sourceName: LANE,
          sourceUrl: PROFILE_URL,
          observationId: new mongoose.Types.ObjectId(),
        },
        entityType: {
          sourceName: LANE,
          sourceUrl: PROFILE_URL,
          observationId: new mongoose.Types.ObjectId(),
        },
        kind: {
          sourceName: LANE,
          sourceUrl: PROFILE_URL,
          observationId: new mongoose.Types.ObjectId(),
        },
      },
    });
    if (withLead) {
      const lead = await Researcher.create({ displayName: LEAD_NAME });
      await RoleAssignment.create({
        personId: lead._id,
        target: { kind: 'RESEARCH_ENTITY', id: row._id },
        role: 'PI',
        state: 'UNKNOWN',
        confidence: 0.9,
      });
    }
  };

  const stored = (slug: string) => ResearchEntity.findOne({ slug }).lean<Stored>();

  it('withdraws a live organization claim the lane never refused', async () => {
    const slug = 'ysm-faculty-synthetic-member';
    await seedRetypedRow(slug, true);
    for (const [field, value] of [
      ['name', ORGANIZATION],
      ['displayName', ORGANIZATION],
      ['entityType', 'INITIATIVE'],
      ['kind', 'initiative'],
    ]) {
      await seed(slug, field, value, { run: laterRun });
    }
    await seed(slug, 'name', `${LEAD_NAME} Faculty Research`, {
      sourceName: 'ysm-faculty-directory',
      confidence: 0.8,
    });
    await seed(slug, 'entityType', 'FACULTY_RESEARCH_AREA', {
      sourceName: 'ysm-faculty-directory',
      confidence: 0.8,
    });

    await materializeEntity('researchEntity', { entityKey: slug });

    expect(await stored(slug)).toMatchObject({
      name: `${LEAD_NAME} Faculty Research`,
      entityType: 'FACULTY_RESEARCH_AREA',
    });
  });

  it('re-derives the person row when every source has withdrawn its name and type', async () => {
    const slug = 'faculty-research-area-synthetic-member';
    await seedRetypedRow(slug, true);
    for (const [field, value] of [
      ['name', ORGANIZATION],
      ['entityType', 'INITIATIVE'],
    ]) {
      await seed(slug, field, value, { run: laterRun });
    }

    await materializeEntity('researchEntity', { entityKey: slug });

    const row = await stored(slug);
    expect(row).toMatchObject({
      name: `${LEAD_NAME} Faculty Research`,
      entityType: 'FACULTY_RESEARCH_AREA',
    });
    expect(row?.displayName).not.toBe(ORGANIZATION);
  });

  it('re-derives the row as a lab when another source still names it as its own lab', async () => {
    const slug = 'nih-pi-synthetic-member';
    await seedRetypedRow(slug, true);
    await ResearchEntity.updateOne(
      { slug },
      {
        $set: {
          name: 'Fixture Coastal Health Lab',
          'fieldProvenance.name': {
            sourceName: 'lab-microsite-description-llm',
            sourceUrl: PROFILE_URL,
            observationId: new mongoose.Types.ObjectId(),
          },
        },
      },
    );
    for (const [field, value] of [
      ['name', ORGANIZATION],
      ['entityType', 'INITIATIVE'],
    ]) {
      await seed(slug, field, value, { run: laterRun });
    }
    await seed(slug, 'name', 'Fixture Coastal Health Lab', {
      sourceName: 'lab-microsite-description-llm',
      confidence: 0.95,
    });

    await materializeEntity('researchEntity', { entityKey: slug });

    expect(await stored(slug)).toMatchObject({
      name: 'Fixture Coastal Health Lab',
      entityType: 'LAB',
    });
  });

  it("clears an organization's display name when the person row returns to faculty research", async () => {
    const slug = 'ysm-faculty-synthetic-member';
    const row = await ResearchEntity.create({
      slug,
      name: 'Fixture Imaging Core Lab',
      displayName: 'Fixture Imaging Core Lab',
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      sourceUrls: [PROFILE_URL],
    });
    const lead = await Researcher.create({ displayName: LEAD_NAME });
    await RoleAssignment.create({
      personId: lead._id,
      target: { kind: 'RESEARCH_ENTITY', id: row._id },
      role: 'PI',
      state: 'UNKNOWN',
      confidence: 0.9,
    });
    await seed(slug, 'name', `${LEAD_NAME} Faculty Research`, {
      sourceName: 'ysm-faculty-directory',
      confidence: 0.8,
    });
    await seed(slug, 'entityType', 'FACULTY_RESEARCH_AREA', {
      sourceName: 'ysm-faculty-directory',
      confidence: 0.8,
    });

    await materializeEntity('researchEntity', { entityKey: slug });

    const stored_ = await stored(slug);
    expect(stored_).toMatchObject({
      name: `${LEAD_NAME} Faculty Research`,
      entityType: 'FACULTY_RESEARCH_AREA',
    });
    expect(stored_?.displayName).toBeUndefined();
  });

  it("keeps an organization's own row named and typed as the organization", async () => {
    const slug = 'fixture-coastal-studies-collaborative';
    await seedRetypedRow(slug, true);
    for (const [field, value] of [
      ['name', ORGANIZATION],
      ['entityType', 'INITIATIVE'],
      ['kind', 'initiative'],
    ]) {
      await seed(slug, field, value, { run: laterRun });
    }

    await materializeEntity('researchEntity', { entityKey: slug });

    expect(await stored(slug)).toMatchObject({ name: ORGANIZATION, entityType: 'INITIATIVE' });
  });
});

describe('a profile lane read whose name was refused at ingest (#5283)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  it("does not borrow an older read's name to keep its type live", async () => {
    const slug = 'synthetic-coastal-studies-center';
    await ResearchEntity.create({
      slug,
      name: 'Synthetic Coastal Studies Center',
      kind: 'center',
      entityType: 'CENTER',
      archived: false,
      sourceUrls: [PROFILE_URL],
    });
    const seed = (field: string, value: string, run: mongoose.Types.ObjectId, at: string) =>
      Observation.create({
        entityType: 'researchEntity',
        entityKey: slug,
        field,
        value,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: LANE,
        scrapeRunId: run,
        sourceUrl: PROFILE_URL,
        confidence: 0.96,
        observedAt: new Date(at),
        superseded: false,
      });
    await seed('name', 'Synthetic Coastal Studies Center', earlierRun, '2026-07-25T00:00:00Z');
    await seed('entityType', 'CENTER', earlierRun, '2026-07-25T00:00:00Z');
    await seed('entityType', 'INITIATIVE', laterRun, '2026-10-16T00:00:00Z');

    await materializeEntity('researchEntity', { entityKey: slug });

    expect((await ResearchEntity.findOne({ slug }).lean<Stored>())?.entityType).toBe('CENTER');
  });
});
