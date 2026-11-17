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
import { materializeEntity } from '../entityMaterializer';
import { resetOverSharedPersonWebsiteKeysCache } from '../overSharedPersonWebsite';

const RESEARCHER_NETID = 'fq6447';
const ALIAS = 'fixture.quillmarsh';
const ALIAS_KEY = `netid:${ALIAS}`;
const DIRECTORY_KEY = RESEARCHER_NETID;
const DISPLAY_NAME = 'Fixture Quillmarsh';
const LAB_SITE = 'https://quillmarsh-lab.fixture-research.org/';
const OTHER_SITE = 'https://other-lab.fixture-research.org/';

describe('an unproven netid key never holds a field on a name join (#6447)', () => {
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
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
    resetOverSharedPersonWebsiteKeysCache();
  });

  const observation = (
    entityKey: string,
    sourceName: string,
    sourceUrl: string,
    field: string,
    value: unknown,
  ) => ({
    entityType: 'user',
    entityKey,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl,
    confidence: 1,
    observedAt: new Date('2026-03-01T00:00:00Z'),
    superseded: false,
    field,
    value,
  });

  const seedAliasKey = (website = LAB_SITE) => {
    const at = (field: string, value: unknown) =>
      observation(
        ALIAS_KEY,
        'dept-faculty-roster',
        'https://fixture-studies.example.edu/faculty/',
        field,
        value,
      );
    return Observation.insertMany([
      at('fname', 'Fixture'),
      at('lname', 'Quillmarsh'),
      at('websiteUrl', website),
    ]);
  };

  const seedDirectoryAliasEvidence = () => {
    const at = (field: string, value: unknown) =>
      observation(DIRECTORY_KEY, 'yale-directory', 'https://api.yalies.io/v2/people', field, value);
    return Observation.insertMany([
      at('netid', RESEARCHER_NETID),
      at('email', `${ALIAS}@yale.edu`),
    ]);
  };

  const seedPerson = (profile: Record<string, string> = {}, writers?: Record<string, unknown>) =>
    Researcher.create({
      displayName: DISPLAY_NAME,
      identifiers: { netid: RESEARCHER_NETID },
      profile,
      profileLinks: [],
      ...(writers ? { profileFieldWriters: writers } : {}),
      status: 'UNKNOWN',
      archived: false,
    });

  const resolve = (key: string) => materializeEntity('user', { entityKey: key }, {});
  const readPerson = (id: unknown) => Researcher.findById(id).lean<any>();
  const writerOf = (person: any, field: string) => person?.profileFieldWriters?.[field];

  it('fills an empty field from an unproven key without recording it as the writer', async () => {
    await seedAliasKey();
    const person = await seedPerson();

    const result = await resolve(ALIAS_KEY);
    expect(String(result.entityId)).toBe(String(person._id));
    const after = await readPerson(person._id);
    expect(after.profile.websiteUrl).toBe(LAB_SITE);
    expect(writerOf(after, 'websiteUrl')).toBeUndefined();

    await resolve(ALIAS_KEY);
    const again = await readPerson(person._id);
    expect(again.profile.websiteUrl).toBe(LAB_SITE);
    expect(writerOf(again, 'websiteUrl')).toBeUndefined();
  });

  it('gives back a field an unproven key holds and keeps its value', async () => {
    await seedAliasKey(OTHER_SITE);
    const person = await seedPerson(
      { websiteUrl: LAB_SITE },
      { websiteUrl: { userKey: ALIAS_KEY, joinRank: 1, confidence: 1 } },
    );

    await resolve(ALIAS_KEY);
    const after = await readPerson(person._id);
    expect(after.profile.websiteUrl).toBe(LAB_SITE);
    expect(writerOf(after, 'websiteUrl')).toBeUndefined();
  });

  it('never makes the name match the writer when another researcher holds the payload as a netid', async () => {
    await seedAliasKey();
    const holder = await Researcher.create({
      displayName: 'Fixture Ottoline Brack',
      identifiers: { netid: ALIAS },
      profile: {},
      profileLinks: [],
      status: 'UNKNOWN',
      archived: false,
    });
    const person = await seedPerson();

    const result = await resolve(ALIAS_KEY);
    expect(String(result.entityId)).toBe(String(holder._id));
    const nameMatch = await readPerson(person._id);
    expect(nameMatch.profile?.websiteUrl).toBeUndefined();
    expect(writerOf(nameMatch, 'websiteUrl')).toBeUndefined();
  });

  it('keeps the writer when the directory alias map resolves the key to this researcher', async () => {
    await seedAliasKey();
    await seedDirectoryAliasEvidence();
    const person = await seedPerson();

    await resolve(ALIAS_KEY);
    const after = await readPerson(person._id);
    expect(after.profile.websiteUrl).toBe(LAB_SITE);
    expect(writerOf(after, 'websiteUrl')?.userKey).toBe(ALIAS_KEY);
  });
});
