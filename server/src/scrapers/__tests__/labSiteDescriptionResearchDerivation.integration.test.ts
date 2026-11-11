import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../entityMaterializer';

const SLUG = 'kelp-homepage-derivation-fixture';
const RESEARCH =
  'My research focuses on how coastal kelp forests recover after marine heatwaves, combining long-term field surveys of kelp canopy with models of sea urchin grazing pressure across rocky shores.';
const OFF_TOPIC =
  'She was president-elect of the Example Society in 2018. She received the Example Medal in 2015.';

describe('lab-site descriptions resolve narrowed to research, as a derivation (#5648)', () => {
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
    for (const name of ['observations', 'research_entities'])
      await db.collection(name).deleteMany({});
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Kelp Homepage Fixture',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
  });

  const seed = (value: string) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: 'fullDescription',
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://kelp.example.org/',
      confidence: 0.9,
      observedAt: new Date(),
      superseded: false,
    });

  it('serves the research sentences and writes no observation or lock', async () => {
    await seed(`${OFF_TOPIC} ${RESEARCH}`);
    const before = await Observation.find().lean();
    await materializeEntity('researchEntity', { entityKey: SLUG }, { dryRun: false });
    const row = (await ResearchEntity.findOne({ slug: SLUG }).lean()) as Record<string, any>;
    expect(row.fullDescription).toBe(RESEARCH);
    expect(row.manuallyLockedFields ?? []).not.toContain('fullDescription');
    const after = await Observation.find().lean();
    expect(after.map((obs) => String(obs.value))).toEqual(before.map((obs) => String(obs.value)));
  });

  it('leaves a lab body as it is', async () => {
    await ResearchEntity.updateOne({ slug: SLUG }, { $set: { entityType: 'LAB', kind: 'lab' } });
    const body =
      'The Kelp Lab runs a ten-week summer field program on rocky shores, with housing and a stipend for each student, and maintains long-term kelp canopy surveys.';
    await seed(body);
    const result = await materializeEntity('researchEntity', { entityKey: SLUG }, { dryRun: true });
    expect(result.plannedSet?.fullDescription).toBe(body);
  });

  it('serves nothing from a value that states no research', async () => {
    await seed(OFF_TOPIC);
    const result = await materializeEntity('researchEntity', { entityKey: SLUG }, { dryRun: true });
    expect(String(result.plannedSet?.fullDescription ?? '')).not.toContain('president-elect');
  });
});
