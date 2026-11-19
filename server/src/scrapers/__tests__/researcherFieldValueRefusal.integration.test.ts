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
import {
  refuseResearcherFieldValue,
  type RefuseResearcherFieldValueArgs,
} from '../../scripts/refuseResearcherFieldValue';
import { planFieldValueRefusal } from '../../utils/researchEntityFieldValueRefusals';
import { materializeEntity } from '../entityMaterializer';
import { resetOverSharedPersonWebsiteKeysCache } from '../overSharedPersonWebsite';
import { syntheticPersonOrcid } from '../../test/syntheticOrcid';

const SYNTHETIC_ORCID_1 = syntheticPersonOrcid(500);
const SYNTHETIC_ORCID_2 = syntheticPersonOrcid(501);

const OWNER_PAGE = 'https://medicine.yale.edu/profile/fixture-quillsby-person/';
const REFUSED_SITE = 'https://school.example.edu/about/fixture-stories/fixture-fund-story/';
const RIVAL_SITE = 'https://fixtureperson.example.org/';
const OWNER_KEY = 'dept:fixture:fixture-person';
const REFUSED_EMAIL = 'fixture.someone-else@yale.edu';

const refusalArgs = (
  researcherId: unknown,
  overrides: Partial<RefuseResearcherFieldValueArgs> = {},
): RefuseResearcherFieldValueArgs => ({
  researcherId: String(researcherId),
  field: 'websiteUrl',
  value: REFUSED_SITE,
  rule: 'over_shared_value',
  note: 'synthetic fixture',
  withdraw: false,
  apply: true,
  confirm: true,
  ...overrides,
});

describe('a person-record refusal holds on every resolve (#5641)', () => {
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

  const observation = (
    field: string,
    value: unknown,
    sourceName: string,
    entityKey = OWNER_KEY,
  ) => ({
    entityType: 'user',
    entityKey,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl: `https://school.example.edu/profile/${entityKey.split(':').pop()}/`,
    confidence: sourceName === 'dept-faculty-roster' ? 0.8 : 0.6,
    observedAt: new Date('2026-03-01T00:00:00Z'),
    superseded: false,
    field,
    value,
  });

  const seedOwner = (extra: ReturnType<typeof observation>[]) =>
    Observation.insertMany([
      observation('fname', 'Fixture', 'dept-faculty-roster'),
      observation('lname', 'Quillsby', 'dept-faculty-roster'),
      observation('profileUrls', { departmental: OWNER_PAGE }, 'dept-faculty-roster'),
      ...extra,
    ]);

  const person = (websiteUrl?: string, identifiers?: Record<string, string>) =>
    Researcher.create({
      displayName: 'Fixture Quillsby',
      profile: { title: 'Professor of Fixtures', ...(websiteUrl ? { websiteUrl } : {}) },
      ...(identifiers ? { identifiers } : {}),
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

  const resolveOwner = () => materializeEntity('user', { entityKey: OWNER_KEY }, {});

  it('clears the stored value when recorded, on a person no identity resolves to', async () => {
    const unreachable = await person(REFUSED_SITE);

    const dryRun = await refuseResearcherFieldValue(
      refusalArgs(unreachable._id, { apply: false, confirm: false }),
    );
    expect(dryRun).toMatchObject({ applied: false, clearedPaths: ['profile.websiteUrl'] });
    expect(await storedWebsite(unreachable._id)).toBe(REFUSED_SITE);

    const applied = await refuseResearcherFieldValue(refusalArgs(unreachable._id));
    expect(applied).toMatchObject({ applied: true, liveRefusalsAfter: 1 });
    expect(await storedWebsite(unreachable._id)).toBeUndefined();
  });

  it('lets a rival win where the refused value is still asserted, and re-derives it with no lock', async () => {
    await seedOwner([
      observation('website', REFUSED_SITE, 'dept-faculty-roster'),
      observation('website', RIVAL_SITE, 'official-profile-pi-backfill'),
    ]);
    const owner = await person(REFUSED_SITE);
    await refuseResearcherFieldValue(refusalArgs(owner._id));

    const first = await resolveOwner();
    expect(String(first.entityId)).toBe(String(owner._id));
    expect(await storedWebsite(owner._id)).toBe(RIVAL_SITE);

    const second = await resolveOwner();
    expect(second.fieldsWritten).toBe(0);
    expect(await storedWebsite(owner._id)).toBe(RIVAL_SITE);
    const stored = await Researcher.findById(owner._id).lean<any>();
    expect(stored.manuallyLockedFields).toBeUndefined();
  });

  it('never re-derives a refused value that is the only one asserted', async () => {
    await seedOwner([observation('website', REFUSED_SITE, 'dept-faculty-roster')]);
    const owner = await person(REFUSED_SITE);
    await refuseResearcherFieldValue(refusalArgs(owner._id));

    await resolveOwner();
    expect(await storedWebsite(owner._id)).toBeUndefined();
    const second = await resolveOwner();
    expect(second.fieldsWritten).toBe(0);
    expect(await storedWebsite(owner._id)).toBeUndefined();
  });

  it('does not join a person on an email that person refuses', async () => {
    const holder = await person(undefined, { email: REFUSED_EMAIL });
    await Researcher.updateOne(
      { _id: holder._id },
      {
        $set: planFieldValueRefusal(undefined, {
          field: 'email',
          value: REFUSED_EMAIL,
          rule: 'other_persons_page',
          refusedBy: 'synthetic fixture',
        }),
      },
    );
    const key = 'dept:fixture:email-only';
    await Observation.insertMany([
      observation('fname', 'Fixture', 'dept-faculty-roster', key),
      observation('lname', 'Quillsby', 'dept-faculty-roster', key),
      observation('email', REFUSED_EMAIL, 'dept-faculty-roster', key),
    ]);
    await Researcher.create({
      displayName: 'Fixture Quillsby',
      status: 'UNKNOWN',
      archived: false,
      profileLinks: [],
    });

    const result = await materializeEntity('user', { entityKey: key }, {});
    expect(String(result.entityId ?? '')).not.toBe(String(holder._id));
  });

  const storedLinkUrls = async (id: unknown) =>
    ((await Researcher.findById(id).lean<any>())?.profileLinks ?? []).map(
      (link: { url: string }) => link.url,
    );

  it('refuses one Google Scholar profile without refusing another person-identified by its query', async () => {
    const scholarLink = (user: string) => ({
      kind: 'GOOGLE_SCHOLAR',
      purpose: 'SCHOLARLY',
      url: `https://scholar.google.com/citations?user=${user}`,
      verifiedAt: new Date('2026-01-01T00:00:00Z'),
      healthStatus: 'UNKNOWN',
    });
    const owner = await person();
    await Researcher.updateOne(
      { _id: owner._id },
      { $push: { profileLinks: scholarLink('FixtureOwn01') } },
    );

    const otherPersons = await refuseResearcherFieldValue(
      refusalArgs(owner._id, {
        field: 'profileLink',
        value: scholarLink('FixtureElse9').url,
        rule: 'other_persons_page',
      }),
    );
    expect(otherPersons).toMatchObject({
      storedValueIsTheRefusedValue: false,
      pulledProfileLinks: 0,
    });
    expect(await storedLinkUrls(owner._id)).toContain(scholarLink('FixtureOwn01').url);

    const own = await refuseResearcherFieldValue(
      refusalArgs(owner._id, {
        field: 'profileLink',
        value: scholarLink('FixtureOwn01').url,
        rule: 'other_persons_page',
      }),
    );
    expect(own).toMatchObject({ storedValueIsTheRefusedValue: true, pulledProfileLinks: 1 });
    expect(await storedLinkUrls(owner._id)).not.toContain(scholarLink('FixtureOwn01').url);
  });

  it('never re-adds a refused ORCID link the orcid evidence composes', async () => {
    const orcid = SYNTHETIC_ORCID_1;
    const orcidUrl = `https://orcid.org/${orcid}`;
    await seedOwner([observation('orcid', orcid, 'dept-faculty-roster')]);
    const owner = await person();
    await resolveOwner();
    expect(await storedLinkUrls(owner._id)).toContain(orcidUrl);

    await refuseResearcherFieldValue(
      refusalArgs(owner._id, { field: 'profileLink', value: orcidUrl, rule: 'other_persons_page' }),
    );
    await resolveOwner();
    expect(await storedLinkUrls(owner._id)).not.toContain(orcidUrl);
    const second = await resolveOwner();
    expect(second.fieldsWritten).toBe(0);
    expect(await storedLinkUrls(owner._id)).not.toContain(orcidUrl);
  });

  it('keeps a refused ORCID out of the identifiers and the links on every resolve', async () => {
    const orcid = SYNTHETIC_ORCID_2;
    const orcidUrl = `https://orcid.org/${orcid}`;
    await seedOwner([observation('orcid', orcid, 'dept-faculty-roster')]);
    const owner = await person();
    await resolveOwner();
    const before = await Researcher.findById(owner._id).lean<any>();
    expect(before.identifiers?.orcid).toBe(orcid);

    const refused = await refuseResearcherFieldValue(
      refusalArgs(owner._id, { field: 'orcid', value: orcidUrl, rule: 'other_persons_page' }),
    );
    expect(refused.clearedPaths).toEqual(['identifiers.orcid']);
    expect(refused.pulledProfileLinks).toBe(1);

    await resolveOwner();
    const after = await Researcher.findById(owner._id).lean<any>();
    expect(after.identifiers?.orcid).toBeUndefined();
    expect(await storedLinkUrls(owner._id)).not.toContain(orcidUrl);
    const second = await resolveOwner();
    expect(second.fieldsWritten).toBe(0);
  });
});
