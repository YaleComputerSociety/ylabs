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

type PersistedEntity = { departments?: string[]; researchAreas?: string[] };

describe('materializeEntity derives funding-program topic metadata (#1700)', () => {
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

  const seedEntity = async (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: 'funding-topic-fixture',
      name: 'Funding Topic Fixture',
      kind: 'program',
      entityType: 'FELLOWSHIP_PROGRAM',
      studentVisibilityTier: 'student_ready',
      archived: false,
      ...overrides,
    });

  const seedField = async (field: string, value: unknown, sourceName = 'yale-college-fellowships-office') => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'funding-topic-fixture',
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: 'https://example.edu/fellowships/fixture/',
      confidence: 0.95,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  };

  it('derives a research area for a named area-studies council fund with no departments/researchAreas observations', async () => {
    await seedEntity();
    await seedField('name', 'CMES Libby Rouse Fund for Peace Fellowships');
    await seedField(
      'fullDescription',
      'The Council on Middle East Studies invites applications to the Libby Rouse Fund for Peace Fellowship competition.',
    );

    await materializeEntity('researchEntity', { entityKey: 'funding-topic-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'funding-topic-fixture',
    }).lean<PersistedEntity>();

    expect(persisted?.researchAreas).toEqual(['Middle Eastern Studies']);
  });

  it('derives a department for a named academic-department fund', async () => {
    await seedEntity();
    await seedField('name', 'Department of Classics Undergraduate Summer Research Awards');
    await seedField(
      'fullDescription',
      'The Department of Classics will make available a limited number of summer research awards.',
    );

    await materializeEntity('researchEntity', { entityKey: 'funding-topic-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'funding-topic-fixture',
    }).lean<PersistedEntity>();

    expect(persisted?.departments).toEqual(['Classics']);
  });

  it('leaves a genuinely cross-disciplinary residential-college fund area-less and department-less', async () => {
    await seedEntity();
    await seedField('name', 'Branford College Richter Summer Fellowship');
    await seedField(
      'fullDescription',
      'Funds a Richter Summer Fellowship for independent study and research by Branford College students.',
    );

    await materializeEntity('researchEntity', { entityKey: 'funding-topic-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'funding-topic-fixture',
    }).lean<PersistedEntity>();

    expect(persisted?.departments ?? []).toEqual([]);
    expect(persisted?.researchAreas ?? []).toEqual([]);
  });

  it('never overwrites an existing non-empty departments/researchAreas value', async () => {
    await seedEntity({ departments: ['Economics'], researchAreas: ['Economics'] });
    await seedField('name', 'CMES Libby Rouse Fund for Peace Fellowships');
    await seedField(
      'fullDescription',
      'The Council on Middle East Studies invites applications to the Libby Rouse Fund for Peace Fellowship competition.',
    );

    await materializeEntity('researchEntity', { entityKey: 'funding-topic-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'funding-topic-fixture',
    }).lean<PersistedEntity>();

    expect(persisted?.departments).toEqual(['Economics']);
    expect(persisted?.researchAreas).toEqual(['Economics']);
  });
});
