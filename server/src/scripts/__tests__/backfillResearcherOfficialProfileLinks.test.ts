import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertBackfillResearcherOfficialProfileLinksApplyAllowed,
  backfillResearcherOfficialProfileLinks,
  parseBackfillResearcherOfficialProfileLinksArgs,
} from '../backfillResearcherOfficialProfileLinks';
import {
  assertBackfillPushIsOfficialProfileLinkOnly,
  composeOfficialProfileLink,
  isYaleOfficialProfileUrl,
  officialProfileLinkFillUpdate,
  selectOfficialYaleProfileUrl,
} from '../backfillResearcherOfficialProfileLinksCore';

const VERIFIED_AT = new Date('2026-01-01T00:00:00.000Z');

describe('backfillResearcherOfficialProfileLinks CLI helpers', () => {
  it('defaults to a dry-run and parses apply safety flags', () => {
    expect(parseBackfillResearcherOfficialProfileLinksArgs([])).toEqual({
      apply: false,
      confirmBackfillResearcherOfficialProfileLinks: false,
    });
    expect(
      parseBackfillResearcherOfficialProfileLinksArgs([
        '--apply',
        '--confirm-backfill-researcher-official-profile-links',
      ]),
    ).toEqual({
      apply: true,
      confirmBackfillResearcherOfficialProfileLinks: true,
    });
  });

  it('rejects malformed CLI arguments', () => {
    expect(() => parseBackfillResearcherOfficialProfileLinksArgs(['prod'])).toThrow(
      /Unknown backfill:researcher-official-profile-links argument: prod/,
    );
    expect(() =>
      parseBackfillResearcherOfficialProfileLinksArgs([
        '--confirm-backfill-researcher-official-profile-links=1',
      ]),
    ).toThrow(/does not accept a value/);
  });

  it('requires confirmation when applying', () => {
    expect(() =>
      assertBackfillResearcherOfficialProfileLinksApplyAllowed({
        apply: true,
        confirmBackfillResearcherOfficialProfileLinks: false,
      }),
    ).toThrow(/--confirm-backfill-researcher-official-profile-links is required/);
    expect(() =>
      assertBackfillResearcherOfficialProfileLinksApplyAllowed({
        apply: false,
        confirmBackfillResearcherOfficialProfileLinks: false,
      }),
    ).not.toThrow();
  });
});

describe('backfillResearcherOfficialProfileLinks core', () => {
  it('accepts only https yale.edu profile urls', () => {
    expect(isYaleOfficialProfileUrl('https://medicine.yale.edu/profile/person/')).toBe(true);
    expect(isYaleOfficialProfileUrl('https://yale.edu/faculty')).toBe(true);
    expect(isYaleOfficialProfileUrl('http://medicine.yale.edu/profile/person/')).toBe(false);
    expect(isYaleOfficialProfileUrl('https://notyale.edu/profile')).toBe(false);
    expect(isYaleOfficialProfileUrl('https://evilyale.edu.attacker.test/x')).toBe(false);
    expect(isYaleOfficialProfileUrl('https://user:pass@medicine.yale.edu/x')).toBe(false);
    expect(isYaleOfficialProfileUrl('')).toBe(false);
  });

  it('selects the official yale url by key preference then any yale value', () => {
    expect(
      selectOfficialYaleProfileUrl({
        directory: 'https://directory.yale.edu/d',
        official: 'https://medicine.yale.edu/profile/person/',
      }),
    ).toBe('https://medicine.yale.edu/profile/person/');
    expect(selectOfficialYaleProfileUrl({ personal: 'https://som.yale.edu/people/person/' })).toBe(
      'https://som.yale.edu/people/person/',
    );
    expect(
      selectOfficialYaleProfileUrl({ official: 'https://example.test/not-yale' }),
    ).toBeUndefined();
    expect(selectOfficialYaleProfileUrl(undefined)).toBeUndefined();
  });

  it('composes a verified YALE_OFFICIAL primary-identity link', () => {
    expect(
      composeOfficialProfileLink(
        { profileUrls: { official: 'https://medicine.yale.edu/profile/person/' } },
        VERIFIED_AT,
      ),
    ).toEqual({
      kind: 'YALE_OFFICIAL',
      purpose: 'PRIMARY_IDENTITY',
      url: 'https://medicine.yale.edu/profile/person/',
      verifiedAt: VERIFIED_AT,
      healthStatus: 'UNKNOWN',
    });
    expect(
      composeOfficialProfileLink(
        { profileUrls: { official: 'https://example.test/x' } },
        VERIFIED_AT,
      ),
    ).toBeUndefined();
  });

  it('only fills when no YALE_OFFICIAL link already exists', () => {
    const composed = composeOfficialProfileLink(
      { profileUrls: { official: 'https://medicine.yale.edu/profile/person/' } },
      VERIFIED_AT,
    );
    expect(officialProfileLinkFillUpdate([], composed)?.kind).toBe('YALE_OFFICIAL');
    expect(
      officialProfileLinkFillUpdate(
        [
          {
            kind: 'YALE_OFFICIAL',
            purpose: 'PRIMARY_IDENTITY',
            url: 'https://yale.edu/existing',
            verifiedAt: VERIFIED_AT,
            healthStatus: 'HEALTHY',
          },
        ],
        composed,
      ),
    ).toBeUndefined();
    expect(officialProfileLinkFillUpdate([], undefined)).toBeUndefined();
  });

  it('rejects push documents that are not a single YALE_OFFICIAL link', () => {
    expect(() =>
      assertBackfillPushIsOfficialProfileLinkOnly({
        profileLinks: { kind: 'GOOGLE_SCHOLAR' },
      }),
    ).toThrow(/not YALE_OFFICIAL/);
    expect(() => assertBackfillPushIsOfficialProfileLinkOnly({ displayName: 'no' })).toThrow(
      /instead of only "profileLinks"/,
    );
  });
});

describe('backfillResearcherOfficialProfileLinks apply', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['accounts', 'users', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('pushes a YALE_OFFICIAL link from the linked user without touching identity or duplicating', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');

    const accountId = new mongoose.Types.ObjectId();
    const researcherId = new mongoose.Types.ObjectId();
    await db.collection('accounts').insertOne({
      _id: accountId,
      netid: 'ab123',
      email: 'ab123@example.test',
      status: 'ACTIVE',
      archived: false,
    });
    await db.collection('users').insertOne({
      netid: 'ab123',
      profileUrls: {
        official: 'https://medicine.yale.edu/profile/ab123/',
        medicine: 'https://medicine.yale.edu/profile/ab123/',
      },
    });
    await db.collection('researchers').insertOne({
      _id: researcherId,
      schemaVersion: 1,
      displayName: 'Synthetic Researcher',
      accountId,
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });

    const alreadyLinkedAccountId = new mongoose.Types.ObjectId();
    const alreadyLinkedResearcherId = new mongoose.Types.ObjectId();
    await db.collection('accounts').insertOne({
      _id: alreadyLinkedAccountId,
      netid: 'cd456',
      email: 'cd456@example.test',
      status: 'ACTIVE',
      archived: false,
    });
    await db.collection('users').insertOne({
      netid: 'cd456',
      profileUrls: { official: 'https://medicine.yale.edu/profile/cd456/' },
    });
    await db.collection('researchers').insertOne({
      _id: alreadyLinkedResearcherId,
      schemaVersion: 1,
      displayName: 'Already Linked',
      accountId: alreadyLinkedAccountId,
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: 'https://yale.edu/existing-cd456',
          verifiedAt: VERIFIED_AT,
          healthStatus: 'HEALTHY',
        },
      ],
      status: 'ACTIVE',
      archived: false,
    });

    const dryRun = await backfillResearcherOfficialProfileLinks({
      apply: false,
      verifiedAt: VERIFIED_AT,
    });
    expect(dryRun.mode).toBe('dry-run');
    expect(dryRun.researchersUpdated).toBe(1);
    const untouched = await db.collection('researchers').findOne({ _id: researcherId });
    expect(untouched?.profileLinks).toHaveLength(0);

    const result = await backfillResearcherOfficialProfileLinks({
      apply: true,
      verifiedAt: VERIFIED_AT,
    });
    expect(result.mode).toBe('apply');
    expect(result.researchersScanned).toBe(2);
    expect(result.researchersWithLegacyMatch).toBe(2);
    expect(result.researchersUpdated).toBe(1);

    const updated = await db.collection('researchers').findOne({ _id: researcherId });
    expect(updated?.profileLinks).toHaveLength(1);
    expect(updated?.profileLinks?.[0]).toMatchObject({
      kind: 'YALE_OFFICIAL',
      purpose: 'PRIMARY_IDENTITY',
      url: 'https://medicine.yale.edu/profile/ab123/',
      healthStatus: 'UNKNOWN',
    });
    expect(updated?.displayName).toBe('Synthetic Researcher');
    expect(updated?.accountId?.toString()).toBe(accountId.toString());

    const alreadyLinked = await db
      .collection('researchers')
      .findOne({ _id: alreadyLinkedResearcherId });
    expect(alreadyLinked?.profileLinks).toHaveLength(1);
    expect(alreadyLinked?.profileLinks?.[0]?.url).toBe('https://yale.edu/existing-cd456');
  });
});
