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

import { SUPERSEDED_RELATIONSHIP_TYPE_ARCHIVE_REASON } from '../../models/entityArchival';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ResearchEntityRelationship } from '../../models/researchEntityRelationship';
import { materializeEntity } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import type { ObservationInput } from '../types';
import { clearC4Flags } from './c4FlagTestEnv';

const SOURCE_NAME = 'centers-institutes-index';
const SOURCE_ID = new mongoose.Types.ObjectId();
const CENTER_SLUG = 'center-synthetic-archive-attribution';
const LAB_SLUG = 'synthetic-attribution-lab';

const relationshipObservations = (): ObservationInput[] => {
  const base = {
    entityType: 'researchEntityRelationship' as const,
    entityKey: `${CENTER_SLUG}:${LAB_SLUG}:MEMBER_RESEARCH_AREA`,
    sourceUrl: 'https://fixture-center.example.edu/people',
  };
  return [
    { ...base, field: 'sourceEntityKey', value: CENTER_SLUG },
    { ...base, field: 'targetEntityKey', value: LAB_SLUG },
    { ...base, field: 'relationshipType', value: 'MEMBER_RESEARCH_AREA' },
    { ...base, field: 'evidenceStrength', value: 'MODERATE' },
    { ...base, field: 'confidence', value: 0.72 },
  ];
};

describe('the materializer attributes the edge it archives when a relationship changes type (#3935)', () => {
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
  });

  it('records why and when the superseded sibling edge was archived', async () => {
    const [center, lab] = await ResearchEntity.create([
      {
        slug: CENTER_SLUG,
        name: 'Synthetic Attribution Center',
        kind: 'center',
        entityType: 'CENTER',
        archived: false,
      },
      {
        slug: LAB_SLUG,
        name: 'Synthetic Attribution Lab',
        kind: 'lab',
        entityType: 'LAB',
        archived: false,
      },
    ]);
    const stale = await ResearchEntityRelationship.create({
      sourceResearchEntityId: center!._id,
      targetResearchEntityId: lab!._id,
      relationshipType: 'MEMBER_RESEARCH_AREA',
    });

    const observations = relationshipObservations();
    await appendObservations(observations, {
      scrapeRunId: String(new mongoose.Types.ObjectId()),
      sourceId: String(SOURCE_ID),
      sourceName: SOURCE_NAME,
      sourceWeight: 0.8,
      dryRun: false,
    });
    await materializeEntity('researchEntityRelationship', {
      entityKey: observations[0]!.entityKey,
    });

    const edges = (await ResearchEntityRelationship.find({}).lean()) as unknown as Array<{
      _id: mongoose.Types.ObjectId;
      relationshipType: string;
      archived?: boolean;
      archivedReason?: string;
      archivedAt?: Date;
    }>;
    const live = edges.filter((edge) => edge.archived !== true);
    expect(live.map((edge) => edge.relationshipType)).toEqual(['AFFILIATED_LAB']);
    const archived = edges.find((edge) => String(edge._id) === String(stale._id));
    expect(archived?.archived).toBe(true);
    expect(archived?.archivedReason).toBe(SUPERSEDED_RELATIONSHIP_TYPE_ARCHIVE_REASON);
    expect(archived?.archivedAt).toBeInstanceOf(Date);
  });
});
