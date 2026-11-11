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
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { materializeEntity, researcherEmailSupport } from '../entityMaterializer';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';
import { researcherEmailSupportVerdict } from '../../services/servedResearcherEmail';

const PAGE = 'https://engineering.yale.edu/faculty-directory/avery-synthetic/';
const OWNER = {
  netid: 'fxavery5627',
  email: 'avery.synthetic5627@yale.edu',
  displayName: 'Avery Synthetic',
};
const NAMESAKE = {
  netid: 'fxjordan5627',
  email: 'jordan.synthetic5627@yale.edu',
  displayName: 'Jordan Synthetic',
};
const SOURCE = 'fixture-official-profile';

describe('the materializer stores whether evidence still states a researcher email (#5627)', () => {
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
    resetDirectoryNetidsByAddressCache();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
    for (const person of [OWNER, NAMESAKE]) {
      await Researcher.collection.insertOne({
        displayName: person.displayName,
        identifiers: { netid: person.netid, email: person.email },
        profileLinks: [],
        status: 'ACTIVE',
        archived: false,
        schemaVersion: 1,
      });
    }
  });

  const observe = (entityKey: string, fields: Record<string, unknown>) =>
    Observation.insertMany(
      Object.entries(fields).map(([field, value]) => ({
        entityType: 'user',
        entityKey,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: SOURCE,
        sourceUrl: PAGE,
        confidence: 0.95,
        observedAt: new Date('2026-06-05T00:00:00Z'),
        superseded: false,
        field,
        value,
      })),
    );

  const storedMarker = async (netid: string) =>
    (await Researcher.findOne({ 'identifiers.netid': netid }).lean())?.identifiers?.emailSupport;

  it('marks an email supported when a key the engine joins to the researcher states it, and is stable on a second run', async () => {
    await observe(`netid:${OWNER.netid}`, {
      displayName: OWNER.displayName,
      email: OWNER.email,
    });

    const first = await materializeEntity('user', { entityKey: `netid:${OWNER.netid}` });
    expect(first.skipped).toBeUndefined();
    expect(await storedMarker(OWNER.netid)).toEqual({
      supported: true,
      sources: [SOURCE],
      computedForEmail: OWNER.email,
    });

    const second = await materializeEntity('user', { entityKey: `netid:${OWNER.netid}` });
    expect(second.fieldsWritten).toBe(0);
    expect(await storedMarker(OWNER.netid)).toEqual({
      supported: true,
      sources: [SOURCE],
      computedForEmail: OWNER.email,
    });
  }, 60000);

  it('marks an email unsupported when only a key the engine joins to another researcher states it', async () => {
    await observe(`netid:${OWNER.netid}`, { displayName: OWNER.displayName });
    await observe(`netid:${NAMESAKE.netid}`, {
      displayName: NAMESAKE.displayName,
      email: OWNER.email,
    });

    await materializeEntity('user', { entityKey: `netid:${OWNER.netid}` });

    expect(await storedMarker(OWNER.netid)).toEqual({
      supported: false,
      sources: [],
      computedForEmail: OWNER.email,
    });
    const owner = await Researcher.findOne({ 'identifiers.netid': OWNER.netid }).lean();
    expect(owner?.identifiers?.email).toBe(OWNER.email);
  }, 60000);

  it('ignores a superseded observation of the email', async () => {
    await observe(`netid:${OWNER.netid}`, { displayName: OWNER.displayName });
    await Observation.create({
      entityType: 'user',
      entityKey: `netid:${OWNER.netid}`,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: SOURCE,
      sourceUrl: PAGE,
      confidence: 0.95,
      observedAt: new Date('2026-06-05T00:00:00Z'),
      superseded: true,
      field: 'email',
      value: OWNER.email,
    });

    const owner = await Researcher.findOne({ 'identifiers.netid': OWNER.netid }).lean();
    expect((await researcherEmailSupport(owner as any))?.supported).toBe(false);
  }, 60000);

  it('reads as stale once the stored email changes, until the next resolve recomputes it', async () => {
    await observe(`netid:${OWNER.netid}`, {
      displayName: OWNER.displayName,
      email: OWNER.email,
    });
    await materializeEntity('user', { entityKey: `netid:${OWNER.netid}` });
    const changedEmail = 'avery.changed5627@yale.edu';
    await Researcher.collection.updateOne(
      { 'identifiers.netid': OWNER.netid },
      { $set: { 'identifiers.email': changedEmail } },
    );

    const stale = await Researcher.findOne({ 'identifiers.netid': OWNER.netid }).lean();
    expect(
      researcherEmailSupportVerdict(stale?.identifiers?.email, stale?.identifiers?.emailSupport),
    ).toBe('unmarked');

    await materializeEntity('user', { entityKey: `netid:${OWNER.netid}` });
    expect(await storedMarker(OWNER.netid)).toEqual({
      supported: false,
      sources: [],
      computedForEmail: changedEmail,
    });
  }, 60000);
});
