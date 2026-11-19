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
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { materializeEntity } from '../entityMaterializer';
import { resetCoreFacilityWebsiteKeysCache } from '../coreFacilityWebsites';

const FACILITY_PAGE = 'https://medicine.example.edu/fixture-core/fixture-imaging-facility/';
const PROFILE_PAGE = 'https://medicine.yale.edu/profile/fixture-quillsby-person/';
const PERSONAL_SITE = 'https://fixtureperson.example.org/';
const FACILITY_KEY = 'fixture-imaging-facility';
const PERSON_KEY = 'fixture-quillsby-research';
const USER_KEY = 'dept:fixture:fixture-person';

const researchEntityObservation = (
  entityKey: string,
  field: string,
  value: unknown,
  sourceName: string,
) => ({
  entityType: 'researchEntity' as const,
  entityKey,
  sourceId: new mongoose.Types.ObjectId(),
  sourceName,
  sourceUrl: entityKey === FACILITY_KEY ? FACILITY_PAGE : PROFILE_PAGE,
  confidence: 0.8,
  observedAt: new Date('2026-08-01T00:00:00Z'),
  superseded: false,
  field,
  value,
});

const seedFacility = async () => {
  await ResearchEntity.create({
    slug: FACILITY_KEY,
    name: 'Fixture Imaging Facility',
    displayName: 'Fixture Imaging Facility',
    entityType: 'CORE_FACILITY',
    kind: 'core_facility',
    websiteUrl: FACILITY_PAGE,
    sourceUrls: [FACILITY_PAGE],
  });
  await Observation.insertMany([
    researchEntityObservation(FACILITY_KEY, 'name', 'Fixture Imaging Facility', 'fixture-lane'),
    researchEntityObservation(FACILITY_KEY, 'websiteUrl', FACILITY_PAGE, 'fixture-lane'),
    researchEntityObservation(FACILITY_KEY, 'sourceUrls', [FACILITY_PAGE], 'fixture-lane'),
  ]);
};

const seedPersonRow = async (websiteUrl: string) => {
  await ResearchEntity.create({
    slug: PERSON_KEY,
    name: 'Fixture Quillsby Research',
    displayName: 'Fixture Quillsby Research',
    entityType: 'FACULTY_RESEARCH_AREA',
    kind: 'individual',
    websiteUrl,
    sourceUrls: [PROFILE_PAGE, FACILITY_PAGE],
  });
  await Observation.insertMany([
    researchEntityObservation(PERSON_KEY, 'name', 'Fixture Quillsby Research', 'fixture-lane'),
    researchEntityObservation(
      PERSON_KEY,
      'websiteUrl',
      FACILITY_PAGE,
      'official-profile-pi-backfill',
    ),
    researchEntityObservation(
      PERSON_KEY,
      'sourceUrls',
      [PROFILE_PAGE, FACILITY_PAGE],
      'ysm-faculty-directory',
    ),
  ]);
};

const stored = async (slug: string) =>
  (await ResearchEntity.findOne({ slug }).lean()) as {
    websiteUrl?: string;
    sourceUrls?: string[];
  } | null;

const resolveRow = (slug: string) => materializeEntity('researchEntity', { entityKey: slug }, {});

const seedUser = async (website: string) => {
  const researcher = await Researcher.create({
    displayName: 'Fixture Quillsby',
    profile: { title: 'Professor of Fixtures', websiteUrl: website },
    profileLinks: [
      {
        kind: 'YALE_OFFICIAL',
        purpose: 'PRIMARY_IDENTITY',
        url: PROFILE_PAGE,
        verifiedAt: new Date('2026-01-01T00:00:00Z'),
        healthStatus: 'UNKNOWN',
      },
    ],
    status: 'UNKNOWN',
    archived: false,
  });
  const userObservation = (field: string, value: unknown) => ({
    entityType: 'user',
    entityKey: USER_KEY,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'dept-faculty-roster',
    sourceUrl: 'https://medicine.example.edu/fixturedept/people/',
    confidence: 0.7,
    observedAt: new Date('2026-03-01T00:00:00Z'),
    superseded: false,
    field,
    value,
  });
  await Observation.insertMany([
    userObservation('fname', 'Fixture'),
    userObservation('lname', 'Quillsby'),
    userObservation('website', website),
    userObservation('profileUrls', { departmental: PROFILE_PAGE }),
  ]);
  return researcher;
};

const storedPersonWebsite = async (id: unknown) =>
  (await Researcher.findById(id).lean<{ profile?: { websiteUrl?: string } }>())?.profile
    ?.websiteUrl;

describe('a core facility page is never a person website or person-row source (#5788)', () => {
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
    for (const name of ['observations', 'research_entities', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
    resetCoreFacilityWebsiteKeysCache();
  });

  it('clears the facility page from a person row on resolve, and a second resolve keeps it out', async () => {
    await seedFacility();
    await seedPersonRow(FACILITY_PAGE);

    await resolveRow(PERSON_KEY);
    const once = await stored(PERSON_KEY);
    expect(once?.websiteUrl ?? '').not.toBe(FACILITY_PAGE);
    expect(once?.sourceUrls).toContain(PROFILE_PAGE);
    expect(once?.sourceUrls).not.toContain(FACILITY_PAGE);

    await resolveRow(PERSON_KEY);
    const twice = await stored(PERSON_KEY);
    expect(twice?.websiteUrl ?? '').toBe(once?.websiteUrl ?? '');
    expect(twice?.sourceUrls).toEqual(once?.sourceUrls);
  });

  it('lets a rival website win once the facility page is set aside', async () => {
    await seedFacility();
    await seedPersonRow(FACILITY_PAGE);
    await Observation.create({
      ...researchEntityObservation(PERSON_KEY, 'websiteUrl', PERSONAL_SITE, 'fixture-lane'),
      confidence: 0.5,
    });

    await resolveRow(PERSON_KEY);

    expect((await stored(PERSON_KEY))?.websiteUrl).toBe(PERSONAL_SITE);
  });

  it('leaves the facility row its own website and citation', async () => {
    await seedFacility();
    await seedPersonRow(FACILITY_PAGE);

    await resolveRow(FACILITY_KEY);

    const facility = await stored(FACILITY_KEY);
    expect(facility?.websiteUrl).toBe(FACILITY_PAGE);
    expect(facility?.sourceUrls).toContain(FACILITY_PAGE);
  });

  it('keeps the page on the person row while no live facility row holds it', async () => {
    await seedPersonRow(FACILITY_PAGE);

    await resolveRow(PERSON_KEY);

    expect((await stored(PERSON_KEY))?.sourceUrls).toContain(FACILITY_PAGE);
  });

  it('clears a person website naming the facility page, and a second resolve writes nothing', async () => {
    await seedFacility();
    const person = await seedUser(FACILITY_PAGE);

    await materializeEntity('user', { entityKey: USER_KEY }, {});
    expect(await storedPersonWebsite(person._id)).toBeUndefined();

    const second = await materializeEntity('user', { entityKey: USER_KEY }, {});
    expect(String(second.entityId)).toBe(String(person._id));
    expect(second.fieldsWritten).toBe(0);
    expect(await storedPersonWebsite(person._id)).toBeUndefined();
  });

  it('keeps an admissible person website', async () => {
    await seedFacility();
    const person = await seedUser(PERSONAL_SITE);

    await materializeEntity('user', { entityKey: USER_KEY }, {});

    expect(await storedPersonWebsite(person._id)).toBe(PERSONAL_SITE);
  });
});
