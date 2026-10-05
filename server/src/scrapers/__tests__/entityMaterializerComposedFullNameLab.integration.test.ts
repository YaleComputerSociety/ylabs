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
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'ysm-faculty-rafferty-duchamp';
const PROFILE_URL = 'https://www.example.edu/profile/rafferty-duchamp/';
const PERSONAL_SITE = 'https://www.raffertyd.example.com/';

type PersistedEntity = { name?: string; entityType?: string };

const persisted = () =>
  ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<PersistedEntity>() as Promise<PersistedEntity>;

describe('materializeEntity reads a composed "<full name> Lab" heading as no lab', () => {
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

  const seedLabRow = async (name: string, websiteUrl: string) => {
    const entity = await ResearchEntity.create({
      slug: ENTITY_KEY,
      name,
      kind: 'lab',
      entityType: 'LAB',
      websiteUrl,
      sourceUrls: [PROFILE_URL, websiteUrl],
      archived: false,
    });
    const person = await Researcher.create({ displayName: 'Rafferty Duchamp', archived: false });
    await RoleAssignment.create({
      personId: person._id,
      target: { kind: 'RESEARCH_ENTITY', id: entity._id },
      role: 'PI',
      evidenceClaimIds: [],
      confidence: 0.9,
      reviewStatus: 'UNREVIEWED',
      archived: false,
      state: 'CURRENT',
    });
    for (const [sourceName, sourceUrl] of [
      ['ysm-faculty-directory', PROFILE_URL],
      ['lab-microsite-description-llm', websiteUrl],
    ]) {
      for (const [field, value] of [
        ['name', name],
        ['entityType', 'LAB'],
        ['websiteUrl', websiteUrl],
      ]) {
        await Observation.create({
          entityType: 'researchEntity',
          entityKey: ENTITY_KEY,
          sourceId: new mongoose.Types.ObjectId(),
          sourceName,
          sourceUrl,
          field,
          value,
          confidence: 0.9,
          observedAt: new Date('2026-01-01T00:00:00Z'),
          superseded: false,
        });
      }
    }
  };

  it('retypes a full-name lab heading whose only site names no lab', async () => {
    await seedLabRow('Rafferty Duchamp Lab', PERSONAL_SITE);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    const entity = await persisted();
    expect(entity.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(entity.name).toBe('Rafferty Duchamp Faculty Research');
  });

  it('re-derives the same heading on a second pass', async () => {
    await seedLabRow('Rafferty Duchamp Lab', PERSONAL_SITE);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect((await persisted()).name).toBe('Rafferty Duchamp Faculty Research');
  });

  it('keeps a full-name heading when the site it cites is lab-named', async () => {
    await seedLabRow('Rafferty Duchamp Lab', 'https://www.duchamplab.example.org/');

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect(await persisted()).toMatchObject({ name: 'Rafferty Duchamp Lab', entityType: 'LAB' });
  });

  it('keeps a surname lab heading a live observation asserts', async () => {
    await seedLabRow('Duchamp Lab', PERSONAL_SITE);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY });

    expect(await persisted()).toMatchObject({ name: 'Duchamp Lab', entityType: 'LAB' });
  });
});
