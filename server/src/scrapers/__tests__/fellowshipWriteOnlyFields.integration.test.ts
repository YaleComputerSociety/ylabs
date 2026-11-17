import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { materializeEntity } from '../entityMaterializer';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';

const LANE = 'yale-college-fellowships-office';
const KEY = `${LANE}:fixture-scoped-award`;
const PAGE = 'https://fellowships.example.edu/fixture-scoped-award/';

describe('a fellowship materialize scoped to named fields (#6473)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    resetInvalidatedScrapeRunCache();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'fellowships', 'scraperuns']) {
      await db.collection(name).deleteMany({});
    }
  });

  const read = (fields: Record<string, unknown>, observedAt: string) =>
    Observation.insertMany(
      Object.entries(fields).map(([field, value]) => ({
        entityType: 'fellowship',
        entityKey: KEY,
        field,
        value,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: LANE,
        sourceUrl: PAGE,
        confidence: 0.95,
        observedAt: new Date(observedAt),
        superseded: false,
      })),
    );

  const seedThenReread = async () => {
    await read(
      {
        title: 'Fixture Scoped Award',
        sourceName: LANE,
        sourceUrl: PAGE,
        summary: 'The award supports a summer of scholarly inquiry with guidance from an adviser.',
        contactOffice: 'Fixture Office of Fellowships',
      },
      '2026-03-01T00:00:00.000Z',
    );
    await materializeEntity('fellowship', { entityKey: KEY }, {});
    await Observation.updateMany({ entityKey: KEY }, { $set: { superseded: true } });
    await read(
      {
        title: 'Fixture Scoped Award, Renamed',
        sourceName: LANE,
        sourceUrl: PAGE,
        summary: 'The award supports a summer of scholarly inquiry with guidance from an adviser.',
        contactOffice: 'Fixture Office of Undergraduate Research',
      },
      '2026-04-01T00:00:00.000Z',
    );
  };

  it('writes only the named field when the new read also changes another', async () => {
    await seedThenReread();

    await materializeEntity('fellowship', { entityKey: KEY }, { writeOnlyFields: ['contactOffice'] });

    const row: any = await Fellowship.findOne({ sourceKey: KEY }).lean();
    expect(row?.contactOffice).toBe('Fixture Office of Undergraduate Research');
    expect(row?.title).toBe('Fixture Scoped Award');
  });

  it('writes every changed field without a scope', async () => {
    await seedThenReread();

    await materializeEntity('fellowship', { entityKey: KEY }, {});

    const row: any = await Fellowship.findOne({ sourceKey: KEY }).lean();
    expect(row?.contactOffice).toBe('Fixture Office of Undergraduate Research');
    expect(row?.title).toBe('Fixture Scoped Award, Renamed');
  });
});
