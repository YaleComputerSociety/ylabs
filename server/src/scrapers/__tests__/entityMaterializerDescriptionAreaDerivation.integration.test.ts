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
import {
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
  resetResearchAreaCanonicalizerCache,
  setResearchAreaCanonicalizerForTesting,
} from '../researchAreaCanonicalization';

type PersistedEntity = { departments?: string[]; researchAreas?: string[] };

describe('materializeEntity derives LAB/FACULTY_RESEARCH_AREA research areas from description (#1717)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
    resetResearchAreaCanonicalizerCache();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    setResearchAreaCanonicalizerForTesting(
      createResearchAreaCanonicalizer(
        buildResearchAreaResolverIndex([{ name: 'Neuroscience' }, { name: 'Immunology' }]),
      ),
    );
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedEntity = async (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: 'area-derivation-fixture',
      name: 'Area Derivation Fixture',
      kind: 'lab',
      entityType: 'LAB',
      studentVisibilityTier: 'operator_review',
      archived: false,
      ...overrides,
    });

  const seedField = async (field: string, value: unknown, sourceName = 'nih-reporter') => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'area-derivation-fixture',
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: 'https://reporter.nih.gov/project-details/00000000',
      confidence: 0.95,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  };

  it('derives areas from an empty-area LAB whose description names canonical topics', async () => {
    await seedEntity();
    await seedField(
      'fullDescription',
      'The lab focuses on the intersection of neuroscience and immunology.',
    );

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'area-derivation-fixture',
    }).lean<PersistedEntity>();

    expect(new Set(persisted?.researchAreas ?? [])).toEqual(
      new Set(['Neuroscience', 'Immunology']),
    );
  });

  it('never overwrites an existing non-empty researchAreas value', async () => {
    await seedEntity({ researchAreas: ['Immunology'] });
    await seedField(
      'fullDescription',
      'The lab focuses on the intersection of neuroscience and immunology.',
    );

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'area-derivation-fixture',
    }).lean<PersistedEntity>();

    expect(persisted?.researchAreas).toEqual(['Immunology']);
  });

  it('leaves an empty-area LAB whose description names no canonical topic area-less', async () => {
    await seedEntity();
    await seedField('fullDescription', 'The lab welcomes motivated students to apply each term.');

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'area-derivation-fixture',
    }).lean<PersistedEntity>();

    expect(persisted?.researchAreas ?? []).toEqual([]);
  });

  it('does not derive areas for a non-LAB/FACULTY_RESEARCH_AREA entity type', async () => {
    await seedEntity({ entityType: 'CENTER', kind: 'center' });
    await seedField(
      'fullDescription',
      'The center focuses on the intersection of neuroscience and immunology.',
    );

    await materializeEntity('researchEntity', { entityKey: 'area-derivation-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'area-derivation-fixture',
    }).lean<PersistedEntity>();

    expect(persisted?.researchAreas ?? []).toEqual([]);
  });
});
