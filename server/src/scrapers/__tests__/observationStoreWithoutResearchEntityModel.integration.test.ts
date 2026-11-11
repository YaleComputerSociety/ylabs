import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Observation } from '../../models/observation';
import { appendObservations } from '../observationStore';

const OLD_KEY = 'synthetic-old-lane-key';
const RENAMED_SLUG = 'synthetic-renamed-row';
const ctx = {
  scrapeRunId: String(new mongoose.Types.ObjectId()),
  sourceId: String(new mongoose.Types.ObjectId()),
  sourceName: 'synthetic-lane',
  sourceWeight: 0.8,
  dryRun: false,
};

describe('ingest reads research rows without the ResearchEntity model', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  it('stamps a renamed row id at ingest, leaving the model unregistered and the collection unindexed', async () => {
    expect(mongoose.modelNames()).not.toContain('ResearchEntity');
    const rowId = new mongoose.Types.ObjectId();
    await mongoose.connection
      .db!.collection('research_entities')
      .insertOne({ _id: rowId, slug: RENAMED_SLUG, archived: false });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: OLD_KEY,
      entityId: rowId,
      field: 'name',
      value: 'Synthetic Renamed Row',
      sourceId: ctx.sourceId,
      sourceName: ctx.sourceName,
      confidence: 0.8,
    });

    await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityKey: OLD_KEY,
          field: 'name',
          value: 'Synthetic Renamed Row Again',
        },
      ],
      ctx,
    );

    const fresh = await Observation.findOne({ entityKey: OLD_KEY, scrapeRunId: ctx.scrapeRunId })
      .select('entityId')
      .lean<{ entityId?: unknown }>();
    expect(String(fresh?.entityId)).toBe(String(rowId));
    expect(mongoose.modelNames()).not.toContain('ResearchEntity');
    const indexNames = (
      await mongoose.connection.db!.collection('research_entities').indexes()
    ).map((index) => index.name);
    expect(indexNames).toEqual(['_id_']);
  });
});
