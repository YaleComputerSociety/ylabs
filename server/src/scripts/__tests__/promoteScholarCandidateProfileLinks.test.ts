import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertPromoteScholarCandidateProfileLinksApplyAllowed,
  parsePromoteScholarCandidateProfileLinksArgs,
  promoteScholarCandidateProfileLinks,
} from '../promoteScholarCandidateProfileLinks';
import {
  assertBackfillPushIsScholarProfileLinkOnly,
  canonicalScholarCitationUrl,
  composeScholarProfileLink,
  scholarProfileLinkFillUpdate,
  selectScholarCitationUrl,
} from '../promoteScholarCandidateProfileLinksCore';

const VERIFIED_AT = new Date('2026-01-01T00:00:00.000Z');

describe('promoteScholarCandidateProfileLinks CLI helpers', () => {
  it('defaults to a dry-run and parses apply safety flags', () => {
    expect(parsePromoteScholarCandidateProfileLinksArgs([])).toEqual({
      apply: false,
      confirmPromoteScholarCandidateProfileLinks: false,
    });
    expect(
      parsePromoteScholarCandidateProfileLinksArgs([
        '--apply',
        '--confirm-promote-scholar-candidate-profile-links',
      ]),
    ).toEqual({
      apply: true,
      confirmPromoteScholarCandidateProfileLinks: true,
    });
  });

  it('rejects malformed CLI arguments', () => {
    expect(() => parsePromoteScholarCandidateProfileLinksArgs(['prod'])).toThrow(
      /Unknown backfill:scholar-candidate-profile-links argument: prod/,
    );
    expect(() =>
      parsePromoteScholarCandidateProfileLinksArgs([
        '--confirm-promote-scholar-candidate-profile-links=1',
      ]),
    ).toThrow(/does not accept a value/);
  });

  it('requires confirmation when applying', () => {
    expect(() =>
      assertPromoteScholarCandidateProfileLinksApplyAllowed({
        apply: true,
        confirmPromoteScholarCandidateProfileLinks: false,
      }),
    ).toThrow(/--confirm-promote-scholar-candidate-profile-links is required/);
    expect(() =>
      assertPromoteScholarCandidateProfileLinksApplyAllowed({
        apply: false,
        confirmPromoteScholarCandidateProfileLinks: false,
      }),
    ).not.toThrow();
  });
});

describe('promoteScholarCandidateProfileLinks core', () => {
  it('canonicalizes valid scholar citation urls and strips extra params', () => {
    expect(canonicalScholarCitationUrl('https://scholar.google.com/citations?user=W4EC7g4AAAAJ')).toBe(
      'https://scholar.google.com/citations?user=W4EC7g4AAAAJ',
    );
    expect(
      canonicalScholarCitationUrl('https://scholar.google.com/citations?user=CPye2b4AAAAJ&hl=en'),
    ).toBe('https://scholar.google.com/citations?user=CPye2b4AAAAJ');
    expect(
      canonicalScholarCitationUrl(
        'https://scholar.google.com/citations?hl=en&user=Q55S8mcAAAAJ&view_op=list_works',
      ),
    ).toBe('https://scholar.google.com/citations?user=Q55S8mcAAAAJ');
    expect(canonicalScholarCitationUrl('http://scholar.google.com/citations?user=mNT0MKIAAAAJ')).toBe(
      'https://scholar.google.com/citations?user=mNT0MKIAAAAJ',
    );
  });

  it('rejects non-scholar, malformed, and credentialed urls', () => {
    expect(canonicalScholarCitationUrl('https://scholar.google.com/citations')).toBeUndefined();
    expect(canonicalScholarCitationUrl('https://scholar.google.com/scholar?user=abc')).toBeUndefined();
    expect(
      canonicalScholarCitationUrl('https://scholar.google.com.attacker.test/citations?user=abc'),
    ).toBeUndefined();
    expect(canonicalScholarCitationUrl('https://example.test/citations?user=abc')).toBeUndefined();
    expect(
      canonicalScholarCitationUrl('https://user:pass@scholar.google.com/citations?user=abc'),
    ).toBeUndefined();
    expect(canonicalScholarCitationUrl('not a url')).toBeUndefined();
    expect(canonicalScholarCitationUrl('')).toBeUndefined();
    expect(canonicalScholarCitationUrl(42)).toBeUndefined();
  });

  it('selects the first canonicalizable candidate', () => {
    expect(
      selectScholarCitationUrl([
        'https://example.test/x',
        'https://scholar.google.com/citations?user=abc123&hl=fr',
      ]),
    ).toBe('https://scholar.google.com/citations?user=abc123');
    expect(selectScholarCitationUrl(['https://example.test/x'])).toBeUndefined();
    expect(selectScholarCitationUrl(undefined)).toBeUndefined();
  });

  it('composes a verified GOOGLE_SCHOLAR scholarly link', () => {
    expect(
      composeScholarProfileLink(
        { scholarCandidateProfileUrls: ['https://scholar.google.com/citations?user=abc123&hl=en'] },
        VERIFIED_AT,
      ),
    ).toEqual({
      kind: 'GOOGLE_SCHOLAR',
      purpose: 'SCHOLARLY',
      url: 'https://scholar.google.com/citations?user=abc123',
      verifiedAt: VERIFIED_AT,
      healthStatus: 'UNKNOWN',
    });
    expect(
      composeScholarProfileLink({ scholarCandidateProfileUrls: ['https://example.test/x'] }, VERIFIED_AT),
    ).toBeUndefined();
  });

  it('only fills when no GOOGLE_SCHOLAR link already exists', () => {
    const composed = composeScholarProfileLink(
      { scholarCandidateProfileUrls: ['https://scholar.google.com/citations?user=abc123'] },
      VERIFIED_AT,
    );
    expect(scholarProfileLinkFillUpdate([], composed)?.kind).toBe('GOOGLE_SCHOLAR');
    expect(
      scholarProfileLinkFillUpdate(
        [
          {
            kind: 'GOOGLE_SCHOLAR',
            purpose: 'SCHOLARLY',
            url: 'https://scholar.google.com/citations?user=existing',
            verifiedAt: VERIFIED_AT,
            healthStatus: 'HEALTHY',
          },
        ],
        composed,
      ),
    ).toBeUndefined();
    expect(scholarProfileLinkFillUpdate([], undefined)).toBeUndefined();
  });

  it('rejects push documents that are not a single GOOGLE_SCHOLAR link', () => {
    expect(() =>
      assertBackfillPushIsScholarProfileLinkOnly({ profileLinks: { kind: 'YALE_OFFICIAL' } }),
    ).toThrow(/not GOOGLE_SCHOLAR/);
    expect(() => assertBackfillPushIsScholarProfileLinkOnly({ displayName: 'no' })).toThrow(
      /instead of only "profileLinks"/,
    );
  });
});

describe('promoteScholarCandidateProfileLinks apply', () => {
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

  it('pushes a canonical GOOGLE_SCHOLAR link from the linked user without duplicating', async () => {
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
      scholarCandidateProfileUrls: [
        'https://scholar.google.com/citations?user=CPye2b4AAAAJ&hl=en',
      ],
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

    const linkedAccountId = new mongoose.Types.ObjectId();
    const linkedResearcherId = new mongoose.Types.ObjectId();
    await db.collection('accounts').insertOne({
      _id: linkedAccountId,
      netid: 'cd456',
      email: 'cd456@example.test',
      status: 'ACTIVE',
      archived: false,
    });
    await db.collection('users').insertOne({
      netid: 'cd456',
      scholarCandidateProfileUrls: ['https://scholar.google.com/citations?user=Zzz9AAAAJ'],
    });
    await db.collection('researchers').insertOne({
      _id: linkedResearcherId,
      schemaVersion: 1,
      displayName: 'Already Linked',
      accountId: linkedAccountId,
      profileLinks: [
        {
          kind: 'GOOGLE_SCHOLAR',
          purpose: 'SCHOLARLY',
          url: 'https://scholar.google.com/citations?user=existing',
          verifiedAt: VERIFIED_AT,
          healthStatus: 'HEALTHY',
        },
      ],
      status: 'ACTIVE',
      archived: false,
    });

    const dryRun = await promoteScholarCandidateProfileLinks({ apply: false });
    expect(dryRun).toEqual({
      mode: 'dry-run',
      researchersScanned: 2,
      researchersWithCandidateMatch: 2,
      researchersUpdated: 1,
    });

    const afterDry = await db.collection('researchers').findOne({ _id: researcherId });
    expect(afterDry?.profileLinks).toEqual([]);

    const applied = await promoteScholarCandidateProfileLinks({ apply: true, verifiedAt: VERIFIED_AT });
    expect(applied.researchersUpdated).toBe(1);

    const updated = await db.collection('researchers').findOne({ _id: researcherId });
    expect(updated?.profileLinks).toEqual([
      {
        kind: 'GOOGLE_SCHOLAR',
        purpose: 'SCHOLARLY',
        url: 'https://scholar.google.com/citations?user=CPye2b4AAAAJ',
        verifiedAt: VERIFIED_AT,
        healthStatus: 'UNKNOWN',
      },
    ]);

    const untouched = await db.collection('researchers').findOne({ _id: linkedResearcherId });
    expect(untouched?.profileLinks).toHaveLength(1);
  });
});
