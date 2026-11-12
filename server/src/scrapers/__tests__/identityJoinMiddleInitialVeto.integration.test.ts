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
import { joinUserIdentityToExistingResearcher } from '../entityMaterializer';
import { clearC4Flags } from './c4FlagTestEnv';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';

const RECORD_NETID = 'qf5979';
const OWN_PAGE = 'https://som.yale.edu/faculty-research/faculty-directory/quinn-fixture';
const ORCID_PAGE = 'https://medicine.yale.edu/profile/quinn-fixture/';
const UNISSUED_ORCID = '0000-0000-0000-0001';
const ELSEWHERE_PAGE = 'https://medicine.yale.edu/lab/quinn-fixture-elsewhere/';
const KEY = 'dept:som:quinn-a-fixture';

const observation = (
  entityKey: string,
  field: string,
  value: unknown,
  sourceUrl: string,
  sourceName = 'dept-faculty-roster',
) => ({
  entityType: 'user' as const,
  entityKey,
  field,
  value,
  sourceName,
  sourceId: new mongoose.Types.ObjectId(),
  sourceUrl,
  confidence: 0.8,
  superseded: false,
  observedAt: new Date('2026-09-01T00:00:00Z'),
});

const seedOrcidPageStating = async (givenName: string, orcidSpelling = UNISSUED_ORCID) => {
  await Observation.create([
    observation('netid:quinn.fixture', 'fname', givenName, ORCID_PAGE, 'ysm-faculty-directory'),
    observation('netid:quinn.fixture', 'lname', 'Fixture', ORCID_PAGE, 'ysm-faculty-directory'),
    observation(
      'netid:quinn.fixture',
      'orcid',
      orcidSpelling,
      ORCID_PAGE,
      'ysm-faculty-directory',
    ),
  ]);
};

const officialLink = (url: string) => ({
  kind: 'YALE_OFFICIAL',
  purpose: 'PRIMARY_IDENTITY',
  url,
  verifiedAt: new Date('2026-01-01T00:00:00Z'),
  healthStatus: 'UNKNOWN',
});

const joinKeyNamed = (displayName: string) =>
  joinUserIdentityToExistingResearcher({ entityKey: KEY }, [
    observation(KEY, 'displayName', displayName, OWN_PAGE),
    observation(KEY, 'profileUrls', { official: OWN_PAGE }, OWN_PAGE),
  ]);

describe('a name join refuses a record whose identity pages state another middle initial (#5979)', () => {
  let replSet: MongoMemoryReplSet;
  let recordId: mongoose.Types.ObjectId;

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
    resetDirectoryNetidsByAddressCache();
    const db = mongoose.connection.db!;
    for (const name of ['accounts', 'researchers', 'observations']) {
      await db.collection(name).deleteMany({});
    }
    recordId = (
      await Researcher.create({
        displayName: 'Quinn Fixture',
        identifiers: { netid: RECORD_NETID },
        profileLinks: [officialLink(OWN_PAGE)],
      })
    )._id;
    await Researcher.collection.updateOne(
      { _id: recordId },
      { $set: { 'identifiers.orcid': UNISSUED_ORCID } },
    );
  });

  describe('through the person-name arm', () => {
    it('refuses when the page stating the record ORCID names another middle initial', async () => {
      await seedOrcidPageStating('Quinn L.');

      const join = await joinKeyNamed('Quinn A. Fixture');

      expect(join.researcher).toBeNull();
      expect(join.identityJoin).toBeUndefined();
    });

    it('still joins when the record pages state the same middle initial', async () => {
      await seedOrcidPageStating('Quinn A.');

      const join = await joinKeyNamed('Quinn A. Fixture');

      expect(String(join.researcher?._id)).toBe(String(recordId));
      expect(join.identityJoin).toBe('person-name');
    });

    it('still joins a name stated without a middle initial', async () => {
      await seedOrcidPageStating('Quinn L.');

      const join = await joinKeyNamed('Quinn Fixture');

      expect(String(join.researcher?._id)).toBe(String(recordId));
    });

    it('finds the page stating the record ORCID in another spelling', async () => {
      await seedOrcidPageStating('Quinn L.', 'https://orcid.org/0000000000000001');

      const join = await joinKeyNamed('Quinn A. Fixture');

      expect(join.researcher).toBeNull();
      expect(join.identityJoin).toBeUndefined();
    });

    it('reads only the names observed at the record pages, not those a citing key holds from elsewhere', async () => {
      await seedOrcidPageStating('Quinn A.');
      await Observation.create([
        observation('netid:quinn.fixture', 'fname', 'Quinn L.', ELSEWHERE_PAGE),
        observation('netid:quinn.fixture', 'lname', 'Fixture', ELSEWHERE_PAGE),
      ]);

      const join = await joinKeyNamed('Quinn A. Fixture');

      expect(String(join.researcher?._id)).toBe(String(recordId));
      expect(join.identityJoin).toBe('person-name');
    });

    it('re-derives the same refusal on a second run', async () => {
      await seedOrcidPageStating('Quinn L.');

      const first = await joinKeyNamed('Quinn A. Fixture');
      const second = await joinKeyNamed('Quinn A. Fixture');

      expect(first.researcher).toBeNull();
      expect(second.researcher).toBeNull();
    });
  });

  describe('through the official-profile-page arm', () => {
    beforeEach(async () => {
      await Researcher.create({ displayName: 'Quinn Fixture', identifiers: {} });
    });

    it('refuses the page holder when the page stating its ORCID names another middle initial', async () => {
      await seedOrcidPageStating('Quinn L.');

      const join = await joinKeyNamed('Quinn A. Fixture');

      expect(join.researcher).toBeNull();
      expect(join.identityJoinedOnOfficialProfileUrlAlone).toBe(false);
    });

    it('still joins the page holder whose pages state the same middle initial', async () => {
      await seedOrcidPageStating('Quinn A.');

      const join = await joinKeyNamed('Quinn A. Fixture');

      expect(String(join.researcher?._id)).toBe(String(recordId));
      expect(join.identityJoin).toBe('official-profile-page');
    });
  });
});
