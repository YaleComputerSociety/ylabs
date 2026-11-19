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
import { materializeEntity, materializeFromRun } from '../entityMaterializer';
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

  const read = (
    fields: Record<string, unknown>,
    observedAt: string,
    scrapeRunId?: mongoose.Types.ObjectId,
  ) =>
    Observation.insertMany(
      Object.entries(fields).map(([field, value]) => ({
        ...(scrapeRunId ? { scrapeRunId } : {}),
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

  const seedThenReread = async (scrapeRunId?: mongoose.Types.ObjectId) => {
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
      scrapeRunId,
    );
  };

  it('writes only the named field when the new read also changes another', async () => {
    await seedThenReread();

    await materializeEntity(
      'fellowship',
      { entityKey: KEY },
      { writeOnlyFields: ['contactOffice'] },
    );

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

  describe('through a run scoped with programWriteOnlyFields', () => {
    const runWithAUserRow = async () => {
      const scrapeRunId = new mongoose.Types.ObjectId();
      await seedThenReread(scrapeRunId);
      await Observation.create({
        scrapeRunId,
        entityType: 'user',
        entityKey: 'netid:fixture-scoped-user',
        field: 'fname',
        value: 'Fixture',
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: LANE,
        sourceUrl: PAGE,
        confidence: 0.95,
        observedAt: new Date('2026-04-01T00:00:00.000Z'),
        superseded: false,
      });
      return String(scrapeRunId);
    };

    it('plans only the named field without writing when it is not applied', async () => {
      const runId = await runWithAUserRow();

      const result = await materializeFromRun(runId, {
        dryRun: true,
        programWriteOnlyFields: ['contactOffice'],
      });

      const row: any = await Fellowship.findOne({ sourceKey: KEY }).lean();
      expect(result.changedPathsByEntityType).toEqual({ fellowship: ['contactOffice'] });
      expect(result.programFieldScope).toEqual({
        onlyFields: ['contactOffice'],
        rowsOutsideProgramSkipped: { user: 1 },
        runReconciliationsSkipped: true,
        writtenRecordIds: [],
        rows: [
          {
            entityKey: KEY,
            recordId: String(row._id),
            sourceName: LANE,
            written: false,
            changes: [
              {
                path: 'contactOffice',
                stored: 'Fixture Office of Fellowships',
                planned: 'Fixture Office of Undergraduate Research',
              },
            ],
          },
        ],
      });
      expect(row?.contactOffice).toBe('Fixture Office of Fellowships');
    });

    it('writes only the named field when applied and leaves the user row alone', async () => {
      const runId = await runWithAUserRow();

      const result = await materializeFromRun(runId, { programWriteOnlyFields: ['contactOffice'] });

      expect(result.updated).toBe(1);
      const row: any = await Fellowship.findOne({ sourceKey: KEY }).lean();
      expect(result.programFieldScope?.writtenRecordIds).toEqual([String(row._id)]);
      expect(result.programFieldScope?.rows.map((entry) => entry.written)).toEqual([true]);
      expect(row?.contactOffice).toBe('Fixture Office of Undergraduate Research');
      expect(row?.title).toBe('Fixture Scoped Award');
      expect(await mongoose.connection.db!.collection('researchers').countDocuments()).toBe(0);
    });
  });
});
