import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntities: vi.fn(async () => {}),
    syncEntity: vi.fn(async () => true),
    deleteFromIndex: vi.fn(async () => {}),
  };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ResearchEntityRelationship } from '../../models/researchEntityRelationship';
import { materializeEntity } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import type { ObservationInput } from '../types';
import { clearC4Flags } from './c4FlagTestEnv';

const SOURCE_NAME = 'centers-institutes-index';
const SOURCE_ID = new mongoose.Types.ObjectId();
const CENTER_SLUG = 'center-synthetic-citation';
const LAB_SLUG = 'synthetic-cited-lab';
const ENTITY_KEY = `${CENTER_SLUG}:${LAB_SLUG}:MEMBER_RESEARCH_AREA`;
const ROSTER_URL = 'https://fixture-center.example.edu/people';

const relationshipObservations = (sourceUrl: string): ObservationInput[] => {
  const base = {
    entityType: 'researchEntityRelationship' as const,
    entityKey: ENTITY_KEY,
    sourceUrl,
  };
  return [
    { ...base, field: 'sourceEntityKey', value: CENTER_SLUG },
    { ...base, field: 'targetEntityKey', value: LAB_SLUG },
    { ...base, field: 'relationshipType', value: 'MEMBER_RESEARCH_AREA' },
    { ...base, field: 'evidenceStrength', value: 'MODERATE' },
    { ...base, field: 'confidence', value: 0.72 },
  ];
};

const observeAndMaterialize = async (observations: ObservationInput[]) => {
  await appendObservations(observations, {
    scrapeRunId: String(new mongoose.Types.ObjectId()),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
  return materializeEntity('researchEntityRelationship', { entityKey: ENTITY_KEY });
};

const storedEdge = async () =>
  (await ResearchEntityRelationship.findOne({ archived: { $ne: true } }).lean()) as {
    sourceUrl?: string;
    evidenceQuote?: string;
  } | null;

describe('a relationship cites the page its observation read (#4024)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    const db = mongoose.connection.db!;
    for (const name of ['observations', 'research_entities', 'research_entity_relationships']) {
      await db.collection(name).deleteMany({});
    }
    await ResearchEntity.create([
      {
        slug: CENTER_SLUG,
        name: 'Synthetic Citation Center',
        kind: 'center',
        entityType: 'CENTER',
        archived: false,
      },
      {
        slug: LAB_SLUG,
        name: 'Synthetic Cited Lab',
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
      },
    ]);
  });

  it('stores the top-level sourceUrl of the observations when no lane emits a sourceUrl field', async () => {
    const result = await observeAndMaterialize(relationshipObservations(ROSTER_URL));

    expect(result.skipped).toBeUndefined();
    expect((await storedEdge())?.sourceUrl).toBe(ROSTER_URL);
  });

  it('keeps a stored citation when a later observation carries no page', async () => {
    await observeAndMaterialize(relationshipObservations(ROSTER_URL));
    await Observation.updateMany({}, { $set: { superseded: true } });

    const result = await observeAndMaterialize(relationshipObservations(''));

    expect(result.skipped).toBeUndefined();
    expect(result.entityId).toBeDefined();
    expect(await Observation.countDocuments({ superseded: { $ne: true } })).toBeGreaterThan(0);
    expect((await storedEdge())?.sourceUrl).toBe(ROSTER_URL);
  });
});
