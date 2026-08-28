import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntity: vi.fn().mockResolvedValue(undefined),
  deleteFromIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: meiliMocks.syncEntity,
    deleteFromIndex: meiliMocks.deleteFromIndex,
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
import {
  isRetiredProgramResearchEntityType,
  materializeEntity,
  observationsAssertRetiredProgramResearchEntityType,
} from '../entityMaterializer';

describe('materializeEntity refuses to mint or resurrect a PROGRAM research entity', () => {
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
    for (const name of ['observations', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedObservation = async (
    entityKey: string,
    field: string,
    value: unknown,
  ): Promise<void> => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'yale-research-official',
      sourceUrl: 'https://research.example.edu/program/example/',
      confidence: 0.9,
      observedAt: new Date('2026-02-01T00:00:00Z'),
      superseded: false,
    });
  };

  it('classifies a PROGRAM entityType observation as retired', () => {
    expect(isRetiredProgramResearchEntityType('PROGRAM')).toBe(true);
    expect(isRetiredProgramResearchEntityType(' program ')).toBe(true);
    expect(isRetiredProgramResearchEntityType('LAB')).toBe(false);
    expect(
      observationsAssertRetiredProgramResearchEntityType([
        { field: 'entityType', value: 'PROGRAM' },
      ]),
    ).toBe(true);
    expect(
      observationsAssertRetiredProgramResearchEntityType([{ field: 'entityType', value: 'LAB' }]),
    ).toBe(false);
  });

  it('skips minting a new research entity when observations assert entityType PROGRAM', async () => {
    await seedObservation('program-example-initiative', 'name', 'Example Program Initiative');
    await seedObservation('program-example-initiative', 'entityType', 'PROGRAM');

    const result = await materializeEntity('researchEntity', {
      entityKey: 'program-example-initiative',
    });

    expect(result.skipped).toBe('program-entity-type-retired');
    expect(result.created).toBe(false);
    expect(result.fieldsWritten).toBe(0);
    expect(meiliMocks.syncEntity).not.toHaveBeenCalled();
    await expect(
      ResearchEntity.countDocuments({ slug: 'program-example-initiative' }),
    ).resolves.toBe(0);
  });

  it('does not resurrect or re-sync an existing PROGRAM research entity', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').insertOne({
      _id: new mongoose.Types.ObjectId(),
      slug: 'program-legacy-residue',
      name: 'Legacy Program Residue',
      kind: 'program',
      entityType: 'PROGRAM',
      archived: true,
    });
    await seedObservation('program-legacy-residue', 'name', 'Legacy Program Residue Renamed');

    const result = await materializeEntity('researchEntity', {
      entityKey: 'program-legacy-residue',
    });

    expect(result.skipped).toBe('program-entity-type-retired');
    expect(result.fieldsWritten).toBe(0);
    expect(meiliMocks.syncEntity).not.toHaveBeenCalled();

    const doc = await ResearchEntity.findOne({ slug: 'program-legacy-residue' }).lean<{
      archived?: boolean;
      name?: string;
    }>();
    expect(doc?.archived).toBe(true);
    expect(doc?.name).toBe('Legacy Program Residue');
  });

  it('still materializes a valid non-PROGRAM research entity', async () => {
    await seedObservation('lab-example-genetics', 'name', 'Example Genetics Lab');
    await seedObservation('lab-example-genetics', 'kind', 'lab');

    const result = await materializeEntity('researchEntity', {
      entityKey: 'lab-example-genetics',
    });

    expect(result.skipped).not.toBe('program-entity-type-retired');
    expect(result.created).toBe(true);
  });
});
