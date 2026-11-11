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
import {
  OVER_SHARED_PERSON_WEBSITE_MIN_SUBJECTS,
  resetOverSharedPersonWebsiteKeysCache,
} from '../overSharedPersonWebsite';

const OWNER_PAGE = 'https://medicine.yale.edu/profile/fixture-quillsby-person/';
const CHROME_PAGE = 'https://school.example.edu/about/fixture-stories/fixture-fund-story/';
const LAB_SITE = 'https://school.example.edu/lab/fixture-lab/';
const PERSONAL_SITE = 'https://fixtureperson.example.org/';
const OWNER_KEY = 'dept:fixture:fixture-person';

describe('a website asserted for many different people is cleared on resolve (#5645)', () => {
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
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
    resetOverSharedPersonWebsiteKeysCache();
  });

  const observation = (entityKey: string, field: string, value: unknown, sourceName: string) => ({
    entityType: 'user',
    entityKey,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl: `https://school.example.edu/profile/${entityKey.split(':').pop()}/`,
    confidence: 0.7,
    observedAt: new Date('2026-03-01T00:00:00Z'),
    superseded: false,
    field,
    value,
  });

  const seedOthersAsserting = async (website: string, count: number) => {
    await Observation.insertMany(
      Array.from({ length: count }, (_, index) =>
        observation(`dept:fixture:other-${index}`, 'website', website, 'dept-faculty-roster'),
      ),
    );
  };

  const seedOwner = async (websites: Array<{ value: string; sourceName: string }>) => {
    await Observation.insertMany([
      observation(OWNER_KEY, 'fname', 'Fixture', 'dept-faculty-roster'),
      observation(OWNER_KEY, 'lname', 'Quillsby', 'dept-faculty-roster'),
      observation(OWNER_KEY, 'profileUrls', { departmental: OWNER_PAGE }, 'dept-faculty-roster'),
      ...websites.map(({ value, sourceName }) =>
        observation(OWNER_KEY, 'website', value, sourceName),
      ),
    ]);
  };

  const person = (websiteUrl: string) =>
    Researcher.create({
      displayName: 'Fixture Quillsby',
      profile: { title: 'Professor of Fixtures', websiteUrl },
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: OWNER_PAGE,
          verifiedAt: new Date('2026-01-01T00:00:00Z'),
          healthStatus: 'UNKNOWN',
        },
      ],
      status: 'UNKNOWN',
      archived: false,
    });

  const storedWebsite = async (id: unknown) =>
    (await Researcher.findById(id).lean<{ profile?: { websiteUrl?: string } }>())?.profile
      ?.websiteUrl;

  const materializeOwner = () => materializeEntity('user', { entityKey: OWNER_KEY }, {});

  it('clears a stored over-shared website and a second resolve writes nothing', async () => {
    await seedOthersAsserting(CHROME_PAGE, OVER_SHARED_PERSON_WEBSITE_MIN_SUBJECTS);
    await seedOwner([{ value: CHROME_PAGE, sourceName: 'dept-faculty-roster' }]);
    const owner = await person(CHROME_PAGE);

    const first = await materializeOwner();
    expect(String(first.entityId)).toBe(String(owner._id));
    expect(await storedWebsite(owner._id)).toBeUndefined();

    resetOverSharedPersonWebsiteKeysCache();
    const second = await materializeOwner();
    expect(second.fieldsWritten).toBe(0);
    expect(await storedWebsite(owner._id)).toBeUndefined();
  });

  it('re-derives the website from the remaining evidence', async () => {
    await seedOthersAsserting(CHROME_PAGE, OVER_SHARED_PERSON_WEBSITE_MIN_SUBJECTS);
    await seedOwner([
      { value: CHROME_PAGE, sourceName: 'dept-faculty-roster' },
      { value: PERSONAL_SITE, sourceName: 'ysm-faculty-directory' },
    ]);
    const owner = await person(CHROME_PAGE);

    await materializeOwner();

    expect(await storedWebsite(owner._id)).toBe(PERSONAL_SITE);
  });

  it('keeps a value shared by one fewer person than the threshold', async () => {
    await seedOthersAsserting(CHROME_PAGE, OVER_SHARED_PERSON_WEBSITE_MIN_SUBJECTS - 2);
    await seedOwner([{ value: CHROME_PAGE, sourceName: 'dept-faculty-roster' }]);
    const owner = await person(CHROME_PAGE);

    await materializeOwner();

    expect(await storedWebsite(owner._id)).toBe(CHROME_PAGE);
  });

  it('keeps a lab site its members list', async () => {
    await seedOthersAsserting(LAB_SITE, 20);
    await seedOthersAsserting(CHROME_PAGE, OVER_SHARED_PERSON_WEBSITE_MIN_SUBJECTS);
    await seedOwner([{ value: LAB_SITE, sourceName: 'dept-faculty-roster' }]);
    const owner = await person(LAB_SITE);

    await materializeOwner();

    expect(await storedWebsite(owner._id)).toBe(LAB_SITE);
  });
});
