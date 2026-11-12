/**
 * A user materialize scoped to `identifiers.orcid` clears a stored ORCID no person can hold
 * together with its `profileLinks` entry, and leaves every other stored path as it was, so
 * slot 12 of #5711 and #5991 can retire implausible ORCIDs without re-deriving the profile.
 */
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

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { materializeEntity } from '../entityMaterializer';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';
import { resetOverSharedPersonWebsiteKeysCache } from '../overSharedPersonWebsite';

const NETID = 'zz6001a';
const KEY = `netid:${NETID}`;
const YEAR_RUN = '2025-2024-2023-2022';
const STORED_EMAIL = 'avery.synthetic6001@yale.edu';
const OFFICIAL_PAGE = 'https://medicine.yale.edu/profile/avery-synthetic6001/';
const SCHOLAR_PAGE = 'https://scholar.google.com/citations?user=zz6001fixture';
const STORED_IMAGE = 'https://fixture6001.example.edu/photos/stored.jpg';
const STORED_DEPARTMENT = 'Stored Fixture Studies';
const STORED_SUPPORT = {
  supported: false,
  sources: ['fixture-stored-support'],
  computedForEmail: STORED_EMAIL,
};
const ORCID_PATHS = ['identifiers.orcid', 'profileLinks.ORCID'];

const link = (kind: string, url: string, purpose = 'SCHOLARLY') => ({
  kind,
  purpose,
  url,
  verifiedAt: new Date('2026-01-01T00:00:00Z'),
  healthStatus: 'UNKNOWN',
});

describe('a user materialize scoped to identifiers.orcid (#5711, #5991)', () => {
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
    for (const name of ['observations', 'researchers', 'accounts', 'scrape_runs']) {
      await db.collection(name).deleteMany({});
    }
    resetDirectoryNetidsByAddressCache();
    resetInvalidatedScrapeRunCache();
    resetOverSharedPersonWebsiteKeysCache();
  });

  const seed = async () => {
    const _id = new mongoose.Types.ObjectId();
    await Researcher.collection.insertOne({
      _id,
      schemaVersion: 1,
      displayName: 'A. Synthetic',
      identifiers: {
        netid: NETID,
        email: STORED_EMAIL,
        orcid: YEAR_RUN,
        emailSupport: STORED_SUPPORT,
      },
      profile: { imageUrl: STORED_IMAGE, primaryDepartment: STORED_DEPARTMENT },
      profileLinks: [
        link('YALE_OFFICIAL', OFFICIAL_PAGE, 'PRIMARY_IDENTITY'),
        link('ORCID', `https://orcid.org/${YEAR_RUN}`),
        link('GOOGLE_SCHOLAR', SCHOLAR_PAGE),
      ],
      status: 'UNKNOWN',
      archived: false,
    });
    for (const [field, value] of [
      ['fname', 'Avery'],
      ['lname', 'Synthetic'],
      ['primaryDepartment', 'Fixture Studies'],
      ['imageUrl', 'https://fixture6001.example.edu/photos/avery.jpg'],
    ] as const) {
      await Observation.create({
        entityType: 'user',
        entityKey: KEY,
        field,
        value,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'dept-faculty-roster',
        sourceUrl: 'https://fixture6001.example.edu/faculty/',
        confidence: 0.9,
        observedAt: new Date('2026-11-01T00:00:00Z'),
        superseded: false,
      });
    }
    return _id;
  };

  const stored = async (id: unknown) => Researcher.findById(id).lean<any>();
  const resolve = (onlyFields: string[] | undefined, dryRun = false) =>
    materializeEntity(
      'user',
      { entityKey: KEY },
      { dryRun, ...(onlyFields ? { userWriteOnlyFields: onlyFields } : {}) },
    );

  it('plans only the ORCID and its link, and drops the profile paths an unscoped run would write', async () => {
    const id = await seed();
    const before = await stored(id);

    const planned = await resolve(['orcid'], true);

    expect(planned.plannedPaths).toEqual(ORCID_PATHS);
    expect(planned.droppedPaths).toEqual(
      expect.arrayContaining(['displayName', 'profile.imageUrl', 'profile.primaryDepartment']),
    );
    expect(await stored(id)).toEqual(before);
  });

  it('clears the implausible ORCID and its link, keeps every other stored path, and settles', async () => {
    const id = await seed();
    const before = await stored(id);

    const applied = await resolve(['identifiers.orcid']);
    const after = await stored(id);

    expect(applied.plannedPaths).toEqual(ORCID_PATHS);
    expect(after.identifiers.orcid).toBeUndefined();
    expect(after.profileLinks).toEqual(before.profileLinks.filter((l: any) => l.kind !== 'ORCID'));
    expect(after.displayName).toBe(before.displayName);
    expect(after.profile).toEqual(before.profile);
    expect(after.identifiers.emailSupport).toEqual(STORED_SUPPORT);
    expect(after.identifiers.email).toBe(STORED_EMAIL);
    const { orcid: _clearedOrcid, ...otherIdentifiers } = before.identifiers;
    expect(after.identifiers).toEqual(otherIdentifiers);
    const strip = ({ updatedAt: _u, identifiers: _i, profileLinks: _p, ...rest }: any) => rest;
    expect(strip(after)).toEqual(strip(before));

    const second = await resolve(['identifiers.orcid']);
    expect(second.plannedPaths).toEqual([]);
    expect(second.fieldsWritten).toBe(0);
    expect(await stored(id)).toEqual(after);
  });
});
