import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeEntity } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import { reconcileFieldRetractions } from '../fieldRetraction';

const SOURCE_NAME = 'ysm-faculty-directory';
const SOURCE_ID = new mongoose.Types.ObjectId();
const SURVIVOR = 'example-survivor-lab';
const LOSER = 'ysm-faculty-example-loser';
const SECOND_LOSER = 'nih-pi-example-loser';
const THIRD_LOSER = 'ysm-faculty-example-third-loser';
const LAB = 'https://examplelab.example.org/';
const PROFILE = 'https://medicine.example.edu/profile/example-loser/';
const positivelyDead = async () => ({ positivelyDead: true });

async function directoryRead(entityKey: string, labWebsite?: string): Promise<void> {
  const run = await ScrapeRun.create({
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    status: 'success',
    startedAt: new Date(),
  });
  const base = {
    entityType: 'researchEntity' as const,
    entityKey,
    sourceUrl: PROFILE,
    confidence: 0.9,
  };
  await appendObservations(
    [
      { ...base, field: 'slug', value: entityKey },
      {
        ...base,
        field: 'sourceUrls',
        value: [PROFILE],
        ...(labWebsite ? {} : { assertsNoValueFor: ['websiteUrl'] }),
      },
      ...(labWebsite ? [{ ...base, field: 'websiteUrl', value: labWebsite }] : []),
    ],
    {
      scrapeRunId: String(run._id),
      sourceId: String(SOURCE_ID),
      sourceName: SOURCE_NAME,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );
  await materializeEntity('researchEntity', { entityKey }, {});
}

const survivorWebsite = async () =>
  (await ResearchEntity.findOne({ slug: SURVIVOR }).lean<{ websiteUrl?: unknown }>())?.websiteUrl;

describe('field retraction on a merged-in loser key clears the survivor it backs (#3609)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    await ScrapeRun.deleteMany({});
    const survivor = await ResearchEntity.create({
      slug: SURVIVOR,
      name: 'Example Survivor Lab',
      kind: 'lab',
      archived: false,
    });
    await ResearchEntity.create({
      slug: LOSER,
      name: 'Example Loser',
      kind: 'individual',
      archived: true,
      canonicalGroupId: survivor._id,
    });
  });

  it('clears the survivor, not the archived loser, and a rematerialize keeps it clear', async () => {
    await directoryRead(LOSER, LAB);
    expect(await survivorWebsite()).toBe(LAB);
    await directoryRead(LOSER);
    await directoryRead(LOSER);
    expect(await survivorWebsite()).toBe(LAB);

    const result = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      probeValue: positivelyDead,
    });

    expect(result.counts.retractedObservations).toBe(1);
    expect(result.counts.storedValuesCleared).toBe(1);
    expect(await survivorWebsite()).toBeFalsy();

    await materializeEntity('researchEntity', { entityKey: SURVIVOR }, {});
    await materializeEntity('researchEntity', { entityKey: LOSER }, {});
    expect(await survivorWebsite()).toBeFalsy();

    const survivorId = (await ResearchEntity.findOne({ slug: SURVIVOR }).lean<{ _id: unknown }>())
      ?._id;
    const second = await materializeEntity(
      'researchEntity',
      { entityId: String(survivorId) },
      { dryRun: true },
    );
    expect(Object.keys(second.plannedSet ?? {})).not.toContain('websiteUrl');
    expect(Object.keys(second.plannedUnset ?? {})).not.toContain('websiteUrl');

    const retired = await Observation.find({ entityKey: LOSER, field: 'websiteUrl' }).lean();
    expect(retired).toHaveLength(1);
    expect(retired[0].superseded).toBe(true);
  }, 120000);

  it('defers to the resolver while another merged-in row still states a website', async () => {
    const survivorId = (await ResearchEntity.findOne({ slug: SURVIVOR }).lean<{ _id: unknown }>())
      ?._id;
    await ResearchEntity.create({
      slug: SECOND_LOSER,
      name: 'Example Second Loser',
      kind: 'individual',
      archived: true,
      canonicalGroupId: survivorId,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SECOND_LOSER,
      field: 'websiteUrl',
      value: LAB,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: LAB,
      confidence: 0.5,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
    await directoryRead(LOSER, LAB);
    await directoryRead(LOSER);
    await directoryRead(LOSER);

    const result = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      probeValue: positivelyDead,
    });

    expect(result.counts.retractedObservations).toBe(1);
    expect(result.counts.storedValuesCleared).toBe(0);
    expect(result.counts.deferredToResolver).toBe(1);
    expect(await survivorWebsite()).toBe(LAB);
  }, 120000);

  it('clears once when two merged-in keys retract the same website in one pass', async () => {
    const survivorId = (await ResearchEntity.findOne({ slug: SURVIVOR }).lean<{ _id: unknown }>())
      ?._id;
    await ResearchEntity.create({
      slug: THIRD_LOSER,
      name: 'Example Third Loser',
      kind: 'individual',
      archived: true,
      canonicalGroupId: survivorId,
    });
    for (const key of [LOSER, THIRD_LOSER]) await directoryRead(key, LAB);
    for (const key of [LOSER, THIRD_LOSER]) await directoryRead(key);
    for (const key of [LOSER, THIRD_LOSER]) await directoryRead(key);

    const result = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      probeValue: positivelyDead,
    });

    expect(result.counts.retractedObservations).toBe(2);
    expect(result.counts.storedValuesCleared).toBe(1);
    expect(result.counts.deferredToResolver).toBe(0);
    expect(await survivorWebsite()).toBeFalsy();
  }, 120000);

  it("leaves a survivor's locked website alone", async () => {
    await directoryRead(LOSER, LAB);
    await ResearchEntity.updateOne(
      { slug: SURVIVOR },
      { $set: { manuallyLockedFields: ['websiteUrl'] } },
    );
    await directoryRead(LOSER);
    await directoryRead(LOSER);

    const result = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      probeValue: positivelyDead,
    });

    expect(result.counts.lockedSkipped).toBe(1);
    expect(result.counts.retractedObservations).toBe(0);
    expect(await survivorWebsite()).toBe(LAB);
  }, 120000);
});
