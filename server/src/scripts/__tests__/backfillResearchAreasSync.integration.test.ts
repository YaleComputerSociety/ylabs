import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const syncEntitiesMock = vi.fn(
  async (_entityType: string, _docs: Array<Record<string, unknown>>) => {},
);

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: (entityType: string, docs: Array<Record<string, unknown>>) =>
    syncEntitiesMock(entityType, docs),
}));

import { ResearchEntity } from '../../models/researchEntity';
import {
  setResearchAreaCanonicalizerForTesting,
  type ResearchAreaCanonicalizer,
} from '../../scrapers/researchAreaCanonicalization';
import { runResearchAreaBackfill } from '../backfillResearchAreas';

const splitCommaListCanonicalizer: ResearchAreaCanonicalizer = {
  canonicalizeResearchAreas(raw: unknown) {
    const list = Array.isArray(raw) ? raw : [];
    const values = list
      .flatMap((value) => String(value).split(','))
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    return { values, unmatched: [], dropped: [] };
  },
  matchCanonicalResearchAreas() {
    return [];
  },
  deriveResearchAreasFromText() {
    return [];
  },
};

describe('runResearchAreaBackfill Meili sync wiring (issue #1002)', () => {
  let replSet: MongoMemoryReplSet;
  const driftedId = new mongoose.Types.ObjectId();
  const cleanId = new mongoose.Types.ObjectId();
  const emptyAreaId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
    setResearchAreaCanonicalizerForTesting(null);
  });

  beforeEach(async () => {
    setResearchAreaCanonicalizerForTesting(splitCommaListCanonicalizer);
    syncEntitiesMock.mockClear();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').deleteMany({});
    await db.collection('research_entities').insertMany([
      {
        _id: driftedId,
        slug: 'synthetic-drifted-lab',
        name: 'Synthetic Drifted Lab',
        kind: 'lab',
        researchAreas: ['Machine Learning, Neuroscience'],
        archived: false,
      },
      {
        _id: cleanId,
        slug: 'synthetic-clean-lab',
        name: 'Synthetic Clean Lab',
        kind: 'lab',
        researchAreas: ['Economics'],
        archived: false,
      },
      {
        _id: emptyAreaId,
        slug: 'synthetic-empty-area-fra',
        name: 'Synthetic Empty Area FRA',
        kind: 'faculty-research-area',
        entityType: 'FACULTY_RESEARCH_AREA',
        departments: ['Sociology'],
        researchAreas: [],
        archived: false,
      },
    ]);
  });

  afterEach(() => {
    setResearchAreaCanonicalizerForTesting(null);
  });

  const options = {
    onlyEmpty: false,
    maxAreas: 6,
    batchSize: 200,
  };

  it('dry-run neither rewrites Mongo nor syncs Meili', async () => {
    const result = await runResearchAreaBackfill({ ...options, dryRun: true });

    expect(result.mode).toBe('dry-run');
    expect(result.summary.changed).toBe(1);
    expect(result.syncedToMeili).toBe(0);
    expect(syncEntitiesMock).not.toHaveBeenCalled();

    const drifted = await mongoose.connection
      .db!.collection('research_entities')
      .findOne({ _id: driftedId });
    expect(drifted?.researchAreas).toEqual(['Machine Learning, Neuroscience']);
  });

  it('apply persists the split areas and syncs exactly the rewritten docs to the researchentities index', async () => {
    const result = await runResearchAreaBackfill({ ...options, dryRun: false });

    expect(result.mode).toBe('apply');
    expect(result.syncedToMeili).toBe(1);

    const drifted = await mongoose.connection
      .db!.collection('research_entities')
      .findOne({ _id: driftedId });
    expect(drifted?.researchAreas).toEqual(['Machine Learning', 'Neuroscience']);

    const clean = await mongoose.connection
      .db!.collection('research_entities')
      .findOne({ _id: cleanId });
    expect(clean?.researchAreas).toEqual(['Economics']);

    expect(syncEntitiesMock).toHaveBeenCalledTimes(1);
    const [entityType, docs] = syncEntitiesMock.mock.calls[0] as [
      string,
      Array<Record<string, unknown>>,
    ];
    expect(entityType).toBe('researchEntity');
    expect(docs).toHaveLength(1);
    expect(String(docs[0]._id)).toBe(driftedId.toString());
    expect(docs[0].researchAreas).toEqual(['Machine Learning', 'Neuroscience']);
  });

  it('syncs the freshly persisted values, never the pre-write chips (write-before-sync)', async () => {
    let observedAreasAtSyncTime: unknown;
    syncEntitiesMock.mockImplementationOnce(
      async (_type: string, docs: Array<Record<string, unknown>>) => {
        observedAreasAtSyncTime = docs[0]?.researchAreas;
      },
    );

    await runResearchAreaBackfill({ ...options, dryRun: false });

    expect(observedAreasAtSyncTime).toEqual(['Machine Learning', 'Neuroscience']);
  });

  it('scopes the run to only the given record ids, leaving other empty-area docs untouched (issue #1717)', async () => {
    const result = await runResearchAreaBackfill({
      ...options,
      dryRun: false,
      recordIds: [emptyAreaId.toString()],
    });

    expect(result.summary.considered).toBe(1);

    const drifted = await mongoose.connection
      .db!.collection('research_entities')
      .findOne({ _id: driftedId });
    expect(drifted?.researchAreas).toEqual(['Machine Learning, Neuroscience']);
  });
});
