/**
 * observations:reconcile-field-retractions re-derives a person whose email or ORCID it retired
 * through a user materialize scoped to that field, so the re-derive writes only the retired
 * field's paths and never the rest of the profile an unscoped materialize would rewrite.
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearC4Flags } from '../../scrapers/__tests__/c4FlagTestEnv';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    syncEntities: vi.fn().mockResolvedValue(undefined),
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
import { materializeEntity } from '../../scrapers/entityMaterializer';
import { reconcileUserFieldRetractions } from '../../scrapers/fieldRetraction';
import { resetDirectoryNetidsByAddressCache } from '../../scrapers/directoryContradictedProfileNetid';
import { resetInvalidatedScrapeRunCache } from '../../scrapers/invalidatedScrapeRuns';
import { resetOverSharedPersonWebsiteKeysCache } from '../../scrapers/overSharedPersonWebsite';
import {
  plannedUserRederives,
  scopedUserRederiver,
  type ScopedUserRederiveRow,
} from '../reconcileFieldRetractions';

beforeEach(clearC4Flags);

const SOURCE = 'dept-faculty-roster';
const NETID = 'zz6001b';
const KEY = `netid:${NETID}`;
const PAGE = 'https://fixture6001.example.edu/people/rowan-synthetic';
const ROSTER = 'https://fixture6001.example.edu/faculty/';
const ADDRESS = 'rowan.synthetic6001@yale.edu';
const YEAR_RUN = '2025-2024-2023-2022';
const STORED_IMAGE = 'https://fixture6001.example.edu/photos/stored.jpg';
const STORED_DEPARTMENT = 'Stored Fixture Studies';
const EMAIL_PATHS = ['identifiers.email', 'identifiers.emailSupport'];
const ORCID_PATHS = ['identifiers.orcid', 'profileLinks.ORCID'];

let clock = Date.UTC(2026, 9, 1);
const nextRun = () => {
  clock += 24 * 60 * 60 * 1000;
  return { scrapeRunId: new mongoose.Types.ObjectId(), observedAt: new Date(clock) };
};

const row = (run: ReturnType<typeof nextRun>, fields: Record<string, unknown>) =>
  Observation.create({
    entityType: 'user',
    entityKey: KEY,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: SOURCE,
    sourceUrl: PAGE,
    confidence: 0.9,
    superseded: false,
    ...run,
    ...fields,
  });

describe('reconcile re-derives a retracted person inside the retracted field scope (#5711, #5991)', () => {
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

  const seed = async (retracted: 'email' | 'orcid') => {
    const _id = new mongoose.Types.ObjectId();
    await Researcher.collection.insertOne({
      _id,
      schemaVersion: 1,
      displayName: 'R. Synthetic',
      identifiers: {
        netid: NETID,
        email: ADDRESS,
        ...(retracted === 'orcid' ? { orcid: YEAR_RUN } : {}),
      },
      profile: { imageUrl: STORED_IMAGE, primaryDepartment: STORED_DEPARTMENT },
      profileLinks:
        retracted === 'orcid'
          ? [
              {
                kind: 'ORCID',
                purpose: 'SCHOLARLY',
                url: `https://orcid.org/${YEAR_RUN}`,
                verifiedAt: new Date('2026-01-01T00:00:00Z'),
                healthStatus: 'UNKNOWN',
              },
            ]
          : [],
      status: 'UNKNOWN',
      archived: false,
    });
    const first = nextRun();
    await row(first, { field: retracted, value: retracted === 'email' ? ADDRESS : YEAR_RUN });
    for (const [field, value] of [
      ['fname', 'Rowan'],
      ['lname', 'Synthetic'],
      ['primaryDepartment', 'Fixture Studies'],
      ['imageUrl', 'https://fixture6001.example.edu/photos/rowan.jpg'],
    ] as const) {
      await row(first, { sourceUrl: ROSTER, field, value });
    }
    for (let read = 0; read < 2; read += 1) {
      await row(nextRun(), {
        field: 'profileUrls',
        value: { profile: PAGE },
        assertsNoValueFor: [retracted],
      });
    }
    return _id;
  };

  const reconcile = async () => {
    const planned = await reconcileUserFieldRetractions({ sourceName: SOURCE, dryRun: true });
    const rows: ScopedUserRederiveRow[] = [];
    const applied = await reconcileUserFieldRetractions({
      sourceName: SOURCE,
      rederive: scopedUserRederiver(
        (entityKey, onlyFields) =>
          materializeEntity(
            'user',
            { entityKey },
            { dryRun: false, userWriteOnlyFields: onlyFields },
          ),
        rows,
      ),
    });
    return { planned: plannedUserRederives([planned]), applied, rows };
  };

  const unchangedOutside = (before: any, after: any, retracted: 'email' | 'orcid') => {
    expect(after.displayName).toBe(before.displayName);
    expect(after.profile).toEqual(before.profile);
    expect(after.identifiers.netid).toBe(NETID);
    if (retracted === 'orcid') {
      expect(after.identifiers.email).toBe(before.identifiers.email);
      expect(after.identifiers.emailSupport).toEqual(before.identifiers.emailSupport);
    } else {
      expect(after.profileLinks).toEqual(before.profileLinks);
    }
  };

  for (const [retracted, paths] of [
    ['email', EMAIL_PATHS],
    ['orcid', ORCID_PATHS],
  ] as const) {
    it(`a retracted ${retracted} plans and writes only its own paths, and a second pass is a no-op`, async () => {
      const id = await seed(retracted);
      const before = await Researcher.findById(id).lean<any>();
      const unscoped = await materializeEntity('user', { entityKey: KEY }, { dryRun: true });
      expect(unscoped.plannedPaths).toEqual(expect.arrayContaining(['displayName']));

      const { planned, applied, rows } = await reconcile();

      expect(planned).toEqual([
        expect.objectContaining({
          entityKey: KEY,
          retractedFields: [retracted],
          plannedPaths: paths,
        }),
      ]);
      expect(applied).toMatchObject({ retiredObservations: 1, rederivedSubjects: 1 });
      expect(rows).toHaveLength(1);
      expect(rows[0].plannedPaths.every((path) => paths.includes(path as never))).toBe(true);
      expect(rows[0].droppedPaths).toEqual(expect.arrayContaining(['displayName']));
      const after = await Researcher.findById(id).lean<any>();
      unchangedOutside(before, after, retracted);
      if (retracted === 'orcid') {
        expect(rows[0].plannedPaths).toEqual(ORCID_PATHS);
        expect(after.identifiers.orcid).toBeUndefined();
        expect(after.profileLinks).toEqual([]);
      } else {
        expect(rows[0].plannedPaths).toEqual(['identifiers.emailSupport']);
        expect(after.identifiers.emailSupport).toMatchObject({ supported: false, sources: [] });
      }

      const again = await reconcile();
      expect(again.planned).toEqual([]);
      expect(again.applied.rederivedSubjects).toBe(0);
      expect(await Researcher.findById(id).lean<any>()).toEqual(after);
    });
  }
});
