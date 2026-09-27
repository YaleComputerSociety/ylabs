import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Observation } from '../../models/observation';
import {
  loadDescriptionSourceCiters,
  resetDescriptionOwnershipCitersCache,
} from '../descriptionOwnershipResolverScreen';
import { appendObservations, retireObservations } from '../observationStore';

const SHARED_PAGE = 'https://example.edu/department/research';
const OTHER_PAGE = 'https://example.org/unrelated/overview';

let memoryReplSet: MongoMemoryReplSet | undefined;

const appendDescription = (entityKey: string, sourceUrl: string) =>
  appendObservations(
    [
      {
        entityType: 'researchEntity',
        entityKey,
        field: 'fullDescription',
        value: `Synthetic description written for ${entityKey} about protein folding assays.`,
        sourceUrl,
        observedAt: new Date('2026-09-01T00:00:00Z'),
      },
    ],
    {
      scrapeRunId: String(new mongoose.Types.ObjectId()),
      sourceId: String(new mongoose.Types.ObjectId()),
      sourceName: 'synthetic-description-source',
      sourceWeight: 0.8,
      dryRun: false,
    },
  );

const citersOf = async (url: string) =>
  [...((await loadDescriptionSourceCiters([url])).values().next().value ?? [])].sort();

describe('description citer snapshot against in-process observation writes (#3568)', () => {
  beforeAll(async () => {
    memoryReplSet = await MongoMemoryReplSet.create({
      binary: { version: '8.0.12' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(memoryReplSet.getUri('description_citers_write_through_test'));
  }, 120_000);

  beforeEach(async () => {
    await Observation.deleteMany({});
    resetDescriptionOwnershipCitersCache();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('sees a description appended after the snapshot was taken for an unrelated page', async () => {
    await appendDescription('row-x', SHARED_PAGE);
    await appendDescription('row-a', OTHER_PAGE);
    expect(await citersOf(OTHER_PAGE)).toEqual(['row-a']);

    await appendDescription('row-b', SHARED_PAGE);

    expect(await citersOf(SHARED_PAGE)).toEqual(['row-b', 'row-x']);
  });

  it('stops counting a description retired after the snapshot was taken', async () => {
    await appendDescription('row-x', SHARED_PAGE);
    await appendDescription('row-b', SHARED_PAGE);
    expect(await citersOf(SHARED_PAGE)).toEqual(['row-b', 'row-x']);

    await retireObservations(
      { entityType: 'researchEntity', entityKey: 'row-b' },
      'synthetic-retirement',
    );

    expect(await citersOf(SHARED_PAGE)).toEqual(['row-x']);
  });
});
