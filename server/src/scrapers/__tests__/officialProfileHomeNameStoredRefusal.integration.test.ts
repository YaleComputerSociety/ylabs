import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'fixture-profile-home-stored-refusal';
const PROFILE_URL = 'https://medicine.yale.edu/profile/fixture-quillfixture/';
const LANE = 'official-profile-pi-backfill';
const GLUED = 'Fictional Decisions Studio We build rigorous methods for fictional decisions';

const seedRowServingTheLaneName = async (sourceName: string): Promise<void> => {
  const fieldProvenance: Record<string, unknown> = {};
  for (const field of ['name', 'displayName']) {
    const sourceId = new mongoose.Types.ObjectId();
    const observedAt = new Date('2026-08-01T00:00:00Z');
    const observation = await Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field,
      value: GLUED,
      sourceId,
      sourceName,
      sourceUrl: PROFILE_URL,
      confidence: 0.96,
      observedAt,
      superseded: false,
    });
    fieldProvenance[field] = {
      sourceId,
      sourceName,
      sourceUrl: PROFILE_URL,
      observationId: observation._id,
      observedAt,
      confidence: 0.96,
    };
  }
  await ResearchEntity.create({
    slug: ENTITY_KEY,
    name: GLUED,
    displayName: GLUED,
    entityType: 'LAB',
    kind: 'lab',
    sourceUrls: [PROFILE_URL],
    fieldProvenance,
  });
};

const storedDisplayName = async (): Promise<unknown> =>
  ((await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean()) as { displayName?: unknown } | null)
    ?.displayName;

describe('a stored profile-linked home name the lane now refuses, with no rival name', () => {
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
    for (const name of ['observations', 'research_entities', 'researchers', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('stops serving it as the display name', async () => {
    await seedRowServingTheLaneName(LANE);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

    expect(await storedDisplayName()).not.toBe(GLUED);
  });

  it('keeps the same value when another lane asserted it', async () => {
    await seedRowServingTheLaneName('dept-faculty-roster');

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

    expect(await storedDisplayName()).toBe(GLUED);
  });
});
