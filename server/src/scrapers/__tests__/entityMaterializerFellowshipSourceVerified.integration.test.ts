import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { materializeEntity } from '../entityMaterializer';
import {
  advancedSourceLastVerifiedAt,
  latestFellowshipSourceReadAt,
} from '../fellowshipSourceVerification';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';

const OFFICE = 'yale-college-fellowships-office';
const OTHER_LANE = 'program-official-page';
const KEY = `${OFFICE}:fixture-verified-award`;
const PAGE = 'https://fellowships.example.edu/fixture-verified-award/';
const FIRST_READ = '2026-03-01T00:00:00.000Z';
const SECOND_READ = '2026-04-01T00:00:00.000Z';
const LATER = '2026-05-01T00:00:00.000Z';

describe('a program records when its own source last confirmed it (#6403)', () => {
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
    resetInvalidatedScrapeRunCache();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'fellowships', 'scraperuns']) {
      await db.collection(name).deleteMany({});
    }
  });

  const observe = (sourceName: string, fields: Record<string, unknown>, observedAt: string) =>
    Observation.insertMany(
      Object.entries(fields).map(([field, value]) => ({
        entityType: 'fellowship',
        entityKey: KEY,
        field,
        value,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName,
        sourceUrl: PAGE,
        confidence: 0.95,
        observedAt: new Date(observedAt),
        superseded: false,
      })),
    );

  const ownRead = (observedAt: string) =>
    observe(
      OFFICE,
      {
        title: 'Fixture Verified Award',
        sourceName: OFFICE,
        sourceUrl: PAGE,
        summary: 'The award supports a summer of scholarly inquiry with guidance from an adviser.',
      },
      observedAt,
    );

  const rereadOwnLane = (observedAt: string) =>
    Observation.updateMany(
      { entityKey: KEY, sourceName: OFFICE },
      { $set: { observedAt: new Date(observedAt) } },
    );

  const verifiedAt = async () =>
    (await Fellowship.findOne({ sourceKey: KEY }).lean<Record<string, any>>())
      ?.sourceLastVerifiedAt as Date | undefined;

  it('stamps the time of the read that materialized the row', async () => {
    await ownRead(FIRST_READ);

    await materializeEntity('fellowship', { entityKey: KEY });

    expect((await verifiedAt())?.toISOString()).toBe(FIRST_READ);
  });

  it('advances on a successful re-read of the same page', async () => {
    await ownRead(FIRST_READ);
    await materializeEntity('fellowship', { entityKey: KEY });

    await rereadOwnLane(SECOND_READ);
    await materializeEntity('fellowship', { entityKey: KEY });

    expect((await verifiedAt())?.toISOString()).toBe(SECOND_READ);
  });

  it('does not advance when no new read lands, and a second resolve writes nothing', async () => {
    await ownRead(FIRST_READ);
    await materializeEntity('fellowship', { entityKey: KEY });

    const again = await materializeEntity('fellowship', { entityKey: KEY });

    expect((await verifiedAt())?.toISOString()).toBe(FIRST_READ);
    expect(again.fieldsWritten ?? 0).toBe(0);
  });

  it("does not advance on another lane's later read of the row", async () => {
    await ownRead(FIRST_READ);
    await observe(OTHER_LANE, { applicationDeadline: 'March 1' }, LATER);

    await materializeEntity('fellowship', { entityKey: KEY });

    expect((await verifiedAt())?.toISOString()).toBe(FIRST_READ);
  });

  it('counts only reads that still confirm the row, never a withdrawn citation', () => {
    const observations = [
      {
        sourceName: OFFICE,
        field: 'title',
        value: 'Fixture Verified Award',
        observedAt: FIRST_READ,
      },
      { sourceName: OFFICE, field: 'sourceUrl', value: '', observedAt: LATER },
      { sourceName: OTHER_LANE, field: 'summary', value: 'x', observedAt: LATER },
    ];

    expect(latestFellowshipSourceReadAt(observations, OFFICE)?.toISOString()).toBe(FIRST_READ);
    expect(latestFellowshipSourceReadAt(observations, undefined)).toBeUndefined();
    expect(latestFellowshipSourceReadAt([], OFFICE)).toBeUndefined();
  });

  it('never moves the stamp backwards', () => {
    expect(
      advancedSourceLastVerifiedAt(new Date(SECOND_READ), new Date(FIRST_READ)),
    ).toBeUndefined();
    expect(
      advancedSourceLastVerifiedAt(new Date(SECOND_READ), new Date(SECOND_READ)),
    ).toBeUndefined();
    expect(
      advancedSourceLastVerifiedAt(new Date(FIRST_READ), new Date(SECOND_READ))?.toISOString(),
    ).toBe(SECOND_READ);
    expect(advancedSourceLastVerifiedAt(undefined, undefined)).toBeUndefined();
  });
});
