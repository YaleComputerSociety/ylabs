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
const CENTER_SLUG = 'center-synthetic-self-edge';
const LAB_SLUG = 'synthetic-member-lab';

const relationshipObservations = (targetEntityKey: string): ObservationInput[] => {
  const base = {
    entityType: 'researchEntityRelationship' as const,
    entityKey: `${CENTER_SLUG}:${targetEntityKey}:MEMBER_RESEARCH_AREA`,
    sourceUrl: 'https://fixture-center.example.edu/people',
  };
  return [
    { ...base, field: 'sourceEntityKey', value: CENTER_SLUG },
    { ...base, field: 'targetEntityKey', value: targetEntityKey },
    { ...base, field: 'relationshipType', value: 'MEMBER_RESEARCH_AREA' },
    { ...base, field: 'evidenceStrength', value: 'MODERATE' },
    { ...base, field: 'confidence', value: 0.72 },
  ];
};

const materializeRelationshipTo = async (targetEntityKey: string) => {
  const observations = relationshipObservations(targetEntityKey);
  await appendObservations(observations, {
    scrapeRunId: String(new mongoose.Types.ObjectId()),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
  return materializeEntity('researchEntityRelationship', {
    entityKey: observations[0]!.entityKey,
  });
};

describe('relationship materialization refuses an edge from a row to itself (#4043)', () => {
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
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'research_entity_relationships']) {
      await db.collection(name).deleteMany({});
    }
    await ResearchEntity.create([
      {
        slug: CENTER_SLUG,
        name: 'Synthetic Self Edge Center',
        kind: 'center',
        entityType: 'CENTER',
        archived: false,
      },
      {
        slug: LAB_SLUG,
        name: 'Synthetic Member Lab',
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
      },
    ]);
  });

  it('skips a member key that resolves to the source row and writes no edge', async () => {
    const result = await materializeRelationshipTo(CENTER_SLUG);

    expect(result.skipped).toBe('self-relationship');
    expect(await ResearchEntityRelationship.countDocuments({})).toBe(0);
  });

  it('still writes the edge when the member key resolves to another row', async () => {
    const result = await materializeRelationshipTo(LAB_SLUG);

    expect(result.skipped).toBeUndefined();
    const edges = (await ResearchEntityRelationship.find({}).lean()) as any[];
    expect(edges).toHaveLength(1);
    expect(String(edges[0].sourceResearchEntityId)).not.toBe(
      String(edges[0].targetResearchEntityId),
    );
  });
});
