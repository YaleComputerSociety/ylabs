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
  OVER_SHARED_PERSON_IMAGE_MIN_SUBJECTS,
  resetOverSharedPersonImageKeysCache,
} from '../overSharedPersonImage';
import { resetOverSharedPersonWebsiteKeysCache } from '../overSharedPersonWebsite';
import { extractOfficialProfileIdentity } from '../sources/officialProfilePiBackfillScraper';

const SOURCE = 'official-profile-pi-backfill';
const SITE_DEFAULT =
  'https://fixture-dept.yale.edu/sites/default/files/styles/social_media/public/campus-default.jpg';
const OWN_PICTURE =
  'https://fixture-dept.yale.edu/sites/default/files/styles/headshot/public/owner-fixture.jpg';

const people = Array.from({ length: OVER_SHARED_PERSON_IMAGE_MIN_SUBJECTS }, (_, index) => ({
  fname: 'Fixture',
  lname: `Person${String.fromCharCode(97 + index)}`,
  netid: `fx${index}`,
}));

const profilePage = (person: (typeof people)[number]) =>
  `https://fixture-dept.yale.edu/people/fixture-person${person.lname.slice(-1)}`;

const laneImageFor = (person: (typeof people)[number], ogImage: string): string | undefined => {
  const page = profilePage(person);
  const html = `<html><head><link rel="canonical" href="${page}" />
    <meta property="og:image" content="${ogImage}" /></head>
    <body><main><h1>${person.fname} ${person.lname}</h1>
    <div class="title">Professor of Fixture Studies</div>
    <div class="department">Fixture Studies</div></main></body></html>`;
  return extractOfficialProfileIdentity(
    html,
    page,
    { name: `${person.lname} Lab`, slug: `${person.lname}-lab`, leadUsers: [person] },
    { requireEmail: false, expectedPeople: [person] },
  )?.imageUrl;
};

describe('a site default image read for different people is not written (#6043)', () => {
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
    resetOverSharedPersonImageKeysCache();
    resetOverSharedPersonWebsiteKeysCache();
  });

  const observation = (
    person: (typeof people)[number],
    field: string,
    value: unknown,
    sourceName = SOURCE,
  ) => ({
    entityType: 'user',
    entityKey: `netid:${person.netid}`,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl: profilePage(person),
    confidence: 0.9,
    observedAt: new Date('2026-03-01T00:00:00Z'),
    superseded: false,
    field,
    value,
  });

  const seedPerson = async (
    person: (typeof people)[number],
    images: Array<{ value: string | undefined; sourceName?: string }>,
  ) => {
    await Observation.insertMany([
      observation(person, 'netid', person.netid),
      observation(person, 'fname', person.fname),
      observation(person, 'lname', person.lname),
      ...images
        .filter(({ value }) => Boolean(value))
        .map(({ value, sourceName }) => observation(person, 'imageUrl', value, sourceName)),
    ]);
  };

  const researcherFor = (person: (typeof people)[number], imageUrl?: string) =>
    Researcher.create({
      displayName: `${person.fname} ${person.lname}`,
      identifiers: { netid: person.netid },
      profile: { title: 'Professor of Fixture Studies', ...(imageUrl ? { imageUrl } : {}) },
      status: 'UNKNOWN',
      archived: false,
    });

  const storedImage = async (id: unknown) =>
    (await Researcher.findById(id).lean<{ profile?: { imageUrl?: string } }>())?.profile?.imageUrl;

  const materialize = (person: (typeof people)[number]) =>
    materializeEntity('user', { entityKey: `netid:${person.netid}` }, {});

  it('writes no image when the lane read the same og:image for each different person', async () => {
    const [owner, ...others] = people;
    for (const person of people) {
      expect(laneImageFor(person, SITE_DEFAULT)).toBe(SITE_DEFAULT);
      await seedPerson(person, [{ value: laneImageFor(person, SITE_DEFAULT) }]);
    }
    const ownerRow = await researcherFor(owner);
    await Promise.all(others.map((person) => researcherFor(person)));

    await materialize(owner);

    expect(await storedImage(ownerRow._id)).toBeUndefined();
  });

  it('clears a stored site default and re-derives the image from the remaining evidence', async () => {
    const [owner, ...others] = people;
    for (const person of others) {
      await seedPerson(person, [{ value: laneImageFor(person, SITE_DEFAULT) }]);
    }
    await seedPerson(owner, [
      { value: laneImageFor(owner, SITE_DEFAULT) },
      { value: OWN_PICTURE, sourceName: 'dept-faculty-roster' },
    ]);
    const ownerRow = await researcherFor(owner, SITE_DEFAULT);

    await materialize(owner);

    expect(await storedImage(ownerRow._id)).toBe(OWN_PICTURE);
  });

  it('clears a stored site default the person has no other image for, and stays cleared', async () => {
    const [owner, ...others] = people;
    for (const person of others) {
      await seedPerson(person, [{ value: laneImageFor(person, SITE_DEFAULT) }]);
    }
    await seedPerson(owner, [{ value: laneImageFor(owner, SITE_DEFAULT) }]);
    const ownerRow = await researcherFor(owner, SITE_DEFAULT);

    await materialize(owner);
    expect(await storedImage(ownerRow._id)).toBeUndefined();

    resetOverSharedPersonImageKeysCache();
    const second = await materialize(owner);
    expect(second.fieldsWritten).toBe(0);
    expect(await storedImage(ownerRow._id)).toBeUndefined();
  });

  it('keeps an image only one person carries', async () => {
    const [owner] = people;
    await seedPerson(owner, [{ value: laneImageFor(owner, OWN_PICTURE) }]);
    const ownerRow = await researcherFor(owner);

    await materialize(owner);

    expect(await storedImage(ownerRow._id)).toBe(OWN_PICTURE);
  });
});
