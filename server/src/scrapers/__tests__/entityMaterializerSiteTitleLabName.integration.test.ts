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
import { planFieldValueRefusal } from '../../utils/researchEntityFieldValueRefusals';
import {
  resetKnownPersonSurnameRosterCache,
  resetLabRowRosterCache,
} from '../../utils/researchHomeNameIdentityRoster';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'faculty-research-area-rafferty-duchamp';
const PROFILE_URL = 'https://www.example.edu/profile/rafferty-duchamp/';
const SITE_URL = 'https://tidefixture.example.org/';
const OLD_SITE_URL = 'https://old-tidefixture.example.org/';

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

describe('materializeEntity keeps a site-title lab name its own current website states', () => {
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

  const seedEntity = () =>
    ResearchEntity.create({
      slug: ENTITY_KEY,
      name: 'Rafferty Duchamp Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      websiteUrl: SITE_URL,
      sourceUrls: [PROFILE_URL, SITE_URL],
      archived: false,
    });

  const seedObservation = (overrides: Record<string, unknown>) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      sourceId: new mongoose.Types.ObjectId(),
      sourceUrl: PROFILE_URL,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
      ...overrides,
    });

  /** Two rosters each assert the default type and the placeholder name. */
  const seedRosterDefaults = async () => {
    for (const [sourceName, confidence] of [
      ['ysm-faculty-directory', 0.8],
      ['bbs-research-track', 0.7],
    ] as const) {
      await seedObservation({
        sourceName,
        confidence,
        field: 'entityType',
        value: 'FACULTY_RESEARCH_AREA',
      });
      await seedObservation({
        sourceName,
        confidence,
        field: 'name',
        value: 'Rafferty Duchamp Faculty Research',
      });
      await seedObservation({ sourceName, confidence, field: 'websiteUrl', value: SITE_URL });
    }
  };

  const seedSiteTitle = (name: string, sourceUrl = SITE_URL) =>
    Promise.all([
      seedObservation({
        sourceName: 'lab-site-type-probe',
        sourceUrl,
        confidence: 0.97,
        field: 'name',
        value: name,
        observedAt: new Date('2026-02-01T00:00:00Z'),
      }),
      seedObservation({
        sourceName: 'lab-site-type-probe',
        sourceUrl,
        confidence: 0.85,
        field: 'entityType',
        value: 'LAB',
        observedAt: new Date('2026-02-01T00:00:00Z'),
      }),
    ]);

  const persisted = () => ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<Record<string, any>>();

  const refuse = (field: string, value: string) =>
    ResearchEntity.updateOne(
      { slug: ENTITY_KEY },
      {
        $set: planFieldValueRefusal(undefined, {
          field,
          value,
          rule: 'operator_judgement',
          refusedBy: 'test',
          note: 'the site title does not name this row',
        }),
      },
    );

  const materializeTwice = async () => {
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});
  };

  it('serves the site-title lab name over two agreeing roster defaults, on every resolve', async () => {
    const entity = await seedEntity();
    await lead(entity._id, 'Rafferty Duchamp');
    await seedRosterDefaults();
    await seedSiteTitle('Tidal Fixture Lab');

    await materializeTwice();

    expect(await persisted()).toMatchObject({ name: 'Tidal Fixture Lab', entityType: 'LAB' });
  });

  it('keeps a full-name lab its own site title states rather than reading it as composed', async () => {
    const entity = await seedEntity();
    await lead(entity._id, 'Rafferty Duchamp');
    await seedRosterDefaults();
    await seedSiteTitle('Rafferty Duchamp Lab');

    await materializeTwice();

    const row = await persisted();
    expect(row).toMatchObject({ name: 'Rafferty Duchamp Lab', entityType: 'LAB' });
    expect(isUnbackedLabNameShell(row!, 'Rafferty Duchamp')).toBe(false);
  });

  it('does not re-adopt a site-title lab name an operator refused', async () => {
    const entity = await seedEntity();
    await lead(entity._id, 'Rafferty Duchamp');
    await seedRosterDefaults();
    await seedSiteTitle('Tidal Fixture Lab');
    await refuse('name', 'Tidal Fixture Lab');

    await materializeTwice();

    const row = await persisted();
    expect(row?.name).not.toBe('Tidal Fixture Lab');
    expect(row?.entityType).toBe('FACULTY_RESEARCH_AREA');
  });

  it('does not retype a row whose LAB type an operator refused', async () => {
    const entity = await seedEntity();
    await lead(entity._id, 'Rafferty Duchamp');
    await seedRosterDefaults();
    await seedSiteTitle('Tidal Fixture Lab');
    await refuse('entityType', 'LAB');

    await materializeTwice();

    expect(await persisted()).toMatchObject({ entityType: 'FACULTY_RESEARCH_AREA' });
  });

  it('ignores a site-title name read from a website the row no longer serves', async () => {
    const entity = await seedEntity();
    await lead(entity._id, 'Rafferty Duchamp');
    await seedRosterDefaults();
    await seedSiteTitle('Tidal Fixture Lab', OLD_SITE_URL);

    await materializeTwice();

    expect(await persisted()).toMatchObject({ entityType: 'FACULTY_RESEARCH_AREA' });
  });
});
