import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    syncEntities: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { ResearchEntity } from '../../models/researchEntity';
import { ScrapeRun } from '../../models/scrapeRun';
import { fieldValueRefusalKey } from '../../utils/researchEntityFieldValueRefusals';
import { materializeEntity } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import type { ObservationInput } from '../types';

const SOURCE_NAME = 'synthetic-citation-lane';
const ENTITY_KEY = 'synthetic-list-entry-refusal-row';
const OWN_PAGE = 'https://medicine.yale.edu/lab/synthetic-list-entry-lab/';
const SECOND_PAGE = 'https://medicine.yale.edu/lab/synthetic-list-entry-lab/research/';
const REFUSED_PAGE = 'https://www.elsewhere.example.edu/research/synthetic-list-entry';

async function appendCitations(sourceUrls: string[]) {
  const run = await ScrapeRun.create({
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: SOURCE_NAME,
    status: 'success',
    startedAt: new Date('2026-11-01T00:00:00Z'),
  });
  const observations: ObservationInput[] = [
    { entityType: 'researchEntity', entityKey: ENTITY_KEY, field: 'slug', value: ENTITY_KEY },
    {
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field: 'name',
      value: 'Synthetic List Entry Lab',
    },
    { entityType: 'researchEntity', entityKey: ENTITY_KEY, field: 'sourceUrls', value: sourceUrls },
  ];
  await appendObservations(observations, {
    scrapeRunId: String(run._id),
    sourceId: String(new mongoose.Types.ObjectId()),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
}

const refuse = (value: unknown) =>
  ResearchEntity.updateOne(
    { slug: ENTITY_KEY },
    {
      $set: {
        'fieldValueRefusals.sourceUrls': [
          {
            valueKey: fieldValueRefusalKey('sourceUrls', value),
            rule: 'operator_judgement',
            refusedBy: 'test',
            refusedAt: new Date('2026-11-13T00:00:00Z'),
            note: 'synthetic',
          },
        ],
      },
    },
  );

const storedSourceUrls = async () =>
  ((await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{ sourceUrls?: string[] }>())
    ?.sourceUrls ?? []) as string[];

const materialize = () => materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

describe('a refused sourceUrls entry leaves the stored citations (#6012)', () => {
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
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'scrape_runs']) {
      await db.collection(name).deleteMany({});
    }
    await appendCitations([OWN_PAGE, SECOND_PAGE, REFUSED_PAGE]);
    await materialize();
  });

  it('drops only the refused entry, keeps the rest, and stays dropped on the next pass', async () => {
    expect(await storedSourceUrls()).toContain(REFUSED_PAGE);

    await refuse(REFUSED_PAGE);
    await materialize();
    const afterOne = await storedSourceUrls();
    expect(afterOne).not.toContain(REFUSED_PAGE);
    expect(afterOne).toEqual(expect.arrayContaining([OWN_PAGE, SECOND_PAGE]));

    await materialize();
    expect(await storedSourceUrls()).toEqual(afterOne);
  });

  it('a whole-list refusal of a different list removes no entry', async () => {
    const before = await storedSourceUrls();
    await refuse([OWN_PAGE, REFUSED_PAGE]);
    await materialize();
    expect(await storedSourceUrls()).toEqual(before);
  });
});
