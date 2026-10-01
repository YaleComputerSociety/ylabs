import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Observation } from '../../models/observation';
import { resetDescriptionOwnershipCitersCache } from '../descriptionOwnershipResolverScreen';
import { appendObservations } from '../observationStore';

const OWN_PAGE = 'https://example.org/';
const OWN_ID = new mongoose.Types.ObjectId();
const OWN_SLUG = 'dept-example-own-row';

let memoryReplSet: MongoMemoryReplSet | undefined;

const ctx = () => ({
  scrapeRunId: String(new mongoose.Types.ObjectId()),
  sourceId: String(new mongoose.Types.ObjectId()),
  sourceName: 'synthetic-description-source',
  sourceWeight: 0.8,
  dryRun: false,
});

const description = (
  field: 'fullDescription' | 'shortDescription',
  identity: { entityId?: string; entityKey?: string },
  value: string,
) => ({
  entityType: 'researchEntity' as const,
  ...identity,
  field,
  value,
  sourceUrl: OWN_PAGE,
  observedAt: new Date('2026-09-01T00:00:00Z'),
});

const liveValues = async (field: string) =>
  (await Observation.find({ field, superseded: { $ne: true }, sourceUrl: OWN_PAGE }).lean()).map(
    (row: any) => row.value,
  );

describe('a row re-reading its own page is not a foreign citer of it', () => {
  beforeAll(async () => {
    memoryReplSet = await MongoMemoryReplSet.create({
      binary: { version: '8.0.12' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(memoryReplSet.getUri('description_ownership_own_citations_test'));
  });

  beforeEach(async () => {
    await Observation.deleteMany({});
    await mongoose.connection.db!.collection('research_entities').deleteMany({});
    resetDescriptionOwnershipCitersCache();
    await mongoose.connection
      .db!.collection('research_entities')
      .insertOne({ _id: OWN_ID, slug: OWN_SLUG, name: 'Example Research Group' });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('stores a refresh when its earlier observations carry both identity forms', async () => {
    await appendObservations(
      [description('fullDescription', { entityKey: OWN_SLUG }, 'Studies coral reef ecology.')],
      ctx(),
    );
    await appendObservations(
      [
        description(
          'fullDescription',
          { entityId: String(OWN_ID), entityKey: OWN_SLUG },
          'The group studies how coral reefs recover after bleaching events across decades.',
        ),
        description(
          'shortDescription',
          { entityId: String(OWN_ID), entityKey: OWN_SLUG },
          'Studies how coral reefs recover after bleaching.',
        ),
      ],
      ctx(),
    );

    const refresh =
      'The group studies how coral reefs recover after bleaching events across several decades.';
    await appendObservations(
      [description('fullDescription', { entityId: String(OWN_ID), entityKey: OWN_SLUG }, refresh)],
      ctx(),
    );

    expect(await liveValues('fullDescription')).toContain(refresh);
  });

  it('still refuses a page two differently named rows already cite', async () => {
    const db = mongoose.connection.db!;
    await db.collection('research_entities').insertMany([
      { slug: 'dept-example-other-a', name: 'Glacier Dynamics Group' },
      { slug: 'dept-example-other-b', name: 'Urban Housing Policy Lab' },
    ]);
    for (const entityKey of ['dept-example-other-a', 'dept-example-other-b']) {
      await appendObservations(
        [
          description(
            'fullDescription',
            { entityKey },
            `Synthetic description for ${entityKey} about field research methods.`,
          ),
        ],
        ctx(),
      );
    }

    const incoming = 'The group studies coral reef recovery, combining field surveys with models.';
    await appendObservations(
      [description('fullDescription', { entityId: String(OWN_ID), entityKey: OWN_SLUG }, incoming)],
      ctx(),
    );

    expect(await liveValues('fullDescription')).not.toContain(incoming);
  });
});
