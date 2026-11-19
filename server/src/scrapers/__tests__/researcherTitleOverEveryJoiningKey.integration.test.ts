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
import { Researcher } from '../../models/researcher';
import {
  materializeEntity,
  materializeObservedEntitiesInChunks,
  type ObservedEntityRow,
} from '../entityMaterializer';
import { clearC4Flags } from './c4FlagTestEnv';

const NETID = 'qs5578';
const DIRECTORY_KEY = NETID;
const PROFILE_KEY = `netid:${NETID}`;
const SCHOOL_KEY = 'ysm:quinn-synthetic';
const NAME_ONLY_KEY = 'dept:fixture:quinn-synthetic';
const OFFICIAL_PAGE = 'https://medicine.yale.edu/profile/quinn-synthetic/';
const NOW = new Date('2026-11-10T00:00:00Z');

interface KeyEvidence {
  entityKey: string;
  sourceName: string;
  sourceUrl: string;
  confidence: number;
  observedAt: Date;
  title?: string;
}

const DIRECTORY: KeyEvidence = {
  entityKey: DIRECTORY_KEY,
  sourceName: 'yale-directory',
  sourceUrl: 'https://directory.yale.edu/',
  confidence: 0.9,
  observedAt: new Date('2026-11-09T00:00:00Z'),
};
const PROFILE: KeyEvidence = {
  entityKey: PROFILE_KEY,
  sourceName: 'dept-faculty-roster',
  sourceUrl: OFFICIAL_PAGE,
  confidence: 0.7,
  observedAt: new Date('2026-10-20T00:00:00Z'),
};
const SCHOOL: KeyEvidence = {
  entityKey: SCHOOL_KEY,
  sourceName: 'ysm-faculty-directory',
  sourceUrl: OFFICIAL_PAGE,
  confidence: 0.8,
  observedAt: new Date('2026-10-25T00:00:00Z'),
};
const NAME_ONLY: KeyEvidence = {
  entityKey: NAME_ONLY_KEY,
  sourceName: 'dept-faculty-roster',
  sourceUrl: 'https://fixture-dept.yale.edu/people/',
  confidence: 0.7,
  observedAt: new Date('2026-11-01T00:00:00Z'),
};

async function seedKey(evidence: KeyEvidence): Promise<void> {
  const observation = (field: string, value: unknown) => ({
    entityType: 'user',
    entityKey: evidence.entityKey,
    sourceId: new mongoose.Types.ObjectId(),
    field,
    value,
    sourceName: evidence.sourceName,
    sourceUrl: evidence.sourceUrl,
    confidence: evidence.confidence,
    observedAt: evidence.observedAt,
    superseded: false,
  });
  await Observation.insertMany([
    observation('fname', 'Quinn'),
    observation('lname', 'Synthetic'),
    ...(evidence.title ? [observation('title', evidence.title)] : []),
  ]);
}

async function storedTitle(): Promise<string | undefined> {
  const researcher: any = await Researcher.findOne({ 'identifiers.netid': NETID }).lean();
  return researcher?.profile?.title;
}

async function materializeInOrder(keys: string[]): Promise<string | undefined> {
  await Researcher.updateOne({ 'identifiers.netid': NETID }, { $unset: { 'profile.title': 1 } });
  for (const entityKey of keys) {
    await materializeEntity('user', { entityKey }, { now: NOW });
  }
  return storedTitle();
}

describe("a researcher's title is resolved over every key that joins to it (#5578)", () => {
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
    for (const name of ['accounts', 'researchers', 'observations']) {
      await db.collection(name).deleteMany({});
    }
    await Researcher.create({
      displayName: 'Quinn Synthetic',
      identifiers: { netid: NETID },
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: OFFICIAL_PAGE,
          verifiedAt: new Date('2026-09-01T00:00:00Z'),
          healthStatus: 'UNKNOWN',
        },
      ],
    });
  });

  it('stores the same title whichever of two disagreeing keys materializes last', async () => {
    await seedKey({ ...PROFILE, title: 'Associate Professor of Medicine' });
    await seedKey({ ...SCHOOL, title: 'Professor of Medicine' });

    const profileLast = await materializeInOrder([SCHOOL_KEY, PROFILE_KEY]);
    const schoolLast = await materializeInOrder([PROFILE_KEY, SCHOOL_KEY]);

    expect(profileLast).toBe('Professor of Medicine');
    expect(schoolLast).toBe(profileLast);
  });

  it('keeps a profile-lane title over a newer directory title, from either key', async () => {
    await seedKey({ ...DIRECTORY, title: 'Associate Professor of Medicine' });
    await seedKey({ ...PROFILE, title: 'Professor of Medicine' });

    expect(await materializeInOrder([PROFILE_KEY, DIRECTORY_KEY])).toBe('Professor of Medicine');
    expect(await materializeInOrder([DIRECTORY_KEY, PROFILE_KEY])).toBe('Professor of Medicine');
  });

  it('uses the directory title when no other key states one', async () => {
    await seedKey({ ...DIRECTORY, title: 'Professor of Medicine' });
    await seedKey(PROFILE);

    expect(await materializeInOrder([DIRECTORY_KEY, PROFILE_KEY])).toBe('Professor of Medicine');
    expect(await materializeInOrder([PROFILE_KEY, DIRECTORY_KEY])).toBe('Professor of Medicine');
  });

  it("counts a name-only key's title only when no findable key states one, in either order", async () => {
    await seedKey({ ...NAME_ONLY, title: 'Lecturer in Medicine' });
    await seedKey({ ...PROFILE, title: 'Professor of Medicine' });

    expect(await materializeInOrder([PROFILE_KEY, NAME_ONLY_KEY])).toBe('Professor of Medicine');
    expect(await materializeInOrder([NAME_ONLY_KEY, PROFILE_KEY])).toBe('Professor of Medicine');
  });

  it("serves a name-only key's title when it is the only one, in either order", async () => {
    await seedKey({ ...NAME_ONLY, title: 'Lecturer in Medicine' });
    await seedKey(PROFILE);

    expect(await materializeInOrder([PROFILE_KEY, NAME_ONLY_KEY])).toBe('Lecturer in Medicine');
    expect(await materializeInOrder([NAME_ONLY_KEY, PROFILE_KEY])).toBe('Lecturer in Medicine');
  });

  it('writes nothing on a second pass over every key', async () => {
    await seedKey({ ...DIRECTORY, title: 'Associate Professor of Medicine' });
    await seedKey({ ...PROFILE, title: 'Professor of Medicine' });
    await seedKey({ ...SCHOOL, title: 'Professor of Medicine and Genetics' });
    const keys = [DIRECTORY_KEY, PROFILE_KEY, SCHOOL_KEY];
    for (const entityKey of keys) await materializeEntity('user', { entityKey }, { now: NOW });
    const firstPassTitle = await storedTitle();

    const secondPass = [];
    for (const entityKey of keys) {
      secondPass.push(await materializeEntity('user', { entityKey }, { now: NOW }));
    }

    expect(secondPass.map((result) => result.fieldsWritten)).toEqual([0, 0, 0]);
    expect(await storedTitle()).toBe(firstPassTitle);
  });

  it('resolves the same title through the chunked path in either row order', async () => {
    await seedKey({ ...DIRECTORY, title: 'Associate Professor of Medicine' });
    await seedKey({ ...PROFILE, title: 'Associate Professor of Medicine' });
    await seedKey({ ...SCHOOL, title: 'Professor of Medicine' });
    const row = (entityKey: string): ObservedEntityRow => ({ entityType: 'user', entityKey });
    const chunked = async (keys: string[]) => {
      await Researcher.updateOne(
        { 'identifiers.netid': NETID },
        { $unset: { 'profile.title': 1 } },
      );
      await materializeObservedEntitiesInChunks(keys.map(row), { now: NOW }, () => {});
      return storedTitle();
    };

    const forward = await chunked([DIRECTORY_KEY, PROFILE_KEY, SCHOOL_KEY]);
    const backward = await chunked([SCHOOL_KEY, PROFILE_KEY, DIRECTORY_KEY]);

    expect(forward).toBe(await materializeInOrder([DIRECTORY_KEY, PROFILE_KEY, SCHOOL_KEY]));
    expect(backward).toBe(forward);
  });
});
