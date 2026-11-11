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

import { Account } from '../../models/account';
import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeEntity } from '../entityMaterializer';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';
import { corpusPersonEmailObservations } from '../sources/yaleDirectoryScraper';

const OWN_NETID = 'own123';
const LEGACY_EMAIL = 'legacy.copy@example.invalid';
const DIRECTORY_EMAIL = 'own.directory.fixture@yale.edu';
const PAGE_EMAIL = 'own.page.fixture@yale.edu';
const OWN_PAGE = 'https://medicine.yale.edu/profile/robin-own/';
const PERSON_PAGE_EMAIL = 'ada.fixture@yale.edu';
const OTHER_PAGE = 'https://medicine.yale.edu/profile/sam-other/';

describe('an empty researcher email is filled from identity-verified evidence on every resolve (#5627)', () => {
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
    for (const name of [
      'observations',
      'researchers',
      'accounts',
      'research_entities',
      'role_assignments',
      'scrape_runs',
    ]) {
      await db.collection(name).deleteMany({});
    }
    resetDirectoryNetidsByAddressCache();
    resetInvalidatedScrapeRunCache();
  });

  const officialLink = (url: string) => ({
    kind: 'YALE_OFFICIAL' as const,
    purpose: 'PRIMARY_IDENTITY' as const,
    url,
    verifiedAt: new Date('2026-01-01T00:00:00Z'),
    healthStatus: 'UNKNOWN' as const,
  });

  const seedResearcher = (extra: Record<string, unknown> = {}) =>
    Researcher.create({
      displayName: 'Robin Own',
      identifiers: { netid: OWN_NETID },
      profile: { title: 'Professor of Medicine' },
      profileLinks: [officialLink(OWN_PAGE)],
      ...extra,
    });

  const seedResearcherWithStoredEmail = () =>
    seedResearcher({ identifiers: { netid: OWN_NETID, email: LEGACY_EMAIL } });

  const observation = (fields: Record<string, unknown>) =>
    Observation.create({
      entityType: 'user',
      sourceId: new mongoose.Types.ObjectId(),
      confidence: 0.9,
      observedAt: new Date('2026-11-01T00:00:00Z'),
      superseded: false,
      ...fields,
    });

  const seedStaffDirectoryRecord = async (netid: string, email: string, corpus: string[]) => {
    const observations = corpusPersonEmailObservations(
      { netid, email, first_name: 'Robin', last_name: 'Own', title: 'Research Affiliates' },
      new Set(corpus),
    );
    for (const input of observations) {
      await observation({ ...input, sourceName: 'yale-directory' });
    }
    return observations;
  };

  const seedOwnKeyPageEmail = (email: string, pageUrl: string) =>
    observation({
      entityKey: `netid:${OWN_NETID}`,
      sourceName: 'official-profile-pi-backfill',
      sourceUrl: pageUrl,
      field: 'email',
      value: email,
    });

  const storedEmail = async (id: unknown) =>
    (await Researcher.findById(id).lean<{ identifiers?: { email?: string } }>())?.identifiers
      ?.email;

  it('fills an empty email from a staff-titled directory record and mints nothing', async () => {
    const researcher = await seedResearcher();
    const emitted = await seedStaffDirectoryRecord(OWN_NETID, DIRECTORY_EMAIL, [OWN_NETID]);

    expect(emitted.map((input) => input.field).sort()).toEqual(['email', 'netid']);
    await materializeEntity('user', { entityKey: OWN_NETID }, {});

    expect(await storedEmail(researcher._id)).toBe(DIRECTORY_EMAIL);
    const after = await Researcher.findById(researcher._id).lean<any>();
    expect(after.displayName).toBe('Robin Own');
    expect(after.profile.title).toBe('Professor of Medicine');
    expect(await Researcher.countDocuments({})).toBe(1);
    expect(await ResearchEntity.countDocuments({})).toBe(0);
    expect(await RoleAssignment.countDocuments({})).toBe(0);
  });

  it('emits nothing for a staff-titled directory record the corpus does not hold', async () => {
    const emitted = await seedStaffDirectoryRecord('stranger1', 'stranger.fixture@yale.edu', [
      OWN_NETID,
    ]);

    expect(emitted).toEqual([]);
    expect(await Observation.countDocuments({})).toBe(0);
    expect(await Researcher.countDocuments({})).toBe(0);
    expect(await ResearchEntity.countDocuments({})).toBe(0);
  });

  it('replaces a stored email when only the person own page states the candidate', async () => {
    const researcher = await seedResearcher({
      displayName: 'Ada Fixture',
      identifiers: { netid: OWN_NETID, email: LEGACY_EMAIL },
    });
    await seedOwnKeyPageEmail(PERSON_PAGE_EMAIL, OWN_PAGE);

    await materializeEntity('user', { entityKey: `netid:${OWN_NETID}` }, {});

    expect(await storedEmail(researcher._id)).toBe(PERSON_PAGE_EMAIL);
  });

  it('keeps the stored email when page evidence states both addresses', async () => {
    const researcher = await seedResearcherWithStoredEmail();
    await seedOwnKeyPageEmail(PAGE_EMAIL, OWN_PAGE);
    await seedOwnKeyPageEmail(LEGACY_EMAIL, 'https://medicine.yale.edu/lab/robin-own/');

    await materializeEntity('user', { entityKey: `netid:${OWN_NETID}` }, {});

    expect(await storedEmail(researcher._id)).toBe(LEGACY_EMAIL);
  });

  it('keeps the stored email when only the directory states the candidate', async () => {
    const researcher = await seedResearcherWithStoredEmail();
    await seedStaffDirectoryRecord(OWN_NETID, DIRECTORY_EMAIL, [OWN_NETID]);

    await materializeEntity('user', { entityKey: OWN_NETID }, {});

    expect(await storedEmail(researcher._id)).toBe(LEGACY_EMAIL);
  });

  it('keeps the stored email when the page is not one the person holds', async () => {
    const researcher = await seedResearcher({
      identifiers: { netid: OWN_NETID, email: LEGACY_EMAIL },
      profileLinks: [],
    });
    await seedOwnKeyPageEmail(PAGE_EMAIL, OWN_PAGE);

    await materializeEntity('user', { entityKey: `netid:${OWN_NETID}` }, {});

    expect(await storedEmail(researcher._id)).toBe(LEGACY_EMAIL);
  });

  it('replaces a stored email when the own page and the directory agree on the candidate', async () => {
    const researcher = await seedResearcher({
      displayName: 'Ada Fixture',
      identifiers: { netid: OWN_NETID, email: LEGACY_EMAIL },
    });
    await seedStaffDirectoryRecord(OWN_NETID, PERSON_PAGE_EMAIL, [OWN_NETID]);
    await seedOwnKeyPageEmail(PERSON_PAGE_EMAIL, OWN_PAGE);

    await materializeEntity('user', { entityKey: OWN_NETID }, {});

    expect(await storedEmail(researcher._id)).toBe(PERSON_PAGE_EMAIL);
  });

  it.todo(
    'keeps the stored email once a fresh read of the own page no longer states the candidate (absence does not retract a user email)',
  );

  it('restores a replaced email to its prior value when the netid is rolled back', async () => {
    await Researcher.createIndexes();
    const stampedNetid = 'race456';
    await Account.create({
      netid: stampedNetid,
      email: 'race.replace.fixture@example.invalid',
      status: 'ACTIVE',
    });
    const researcher = await Researcher.create({
      displayName: 'Ada Fixture',
      identifiers: { email: LEGACY_EMAIL },
      profileLinks: [officialLink(OWN_PAGE)],
    });
    for (const [field, value] of [
      ['netid', stampedNetid],
      ['fname', 'Ada'],
      ['lname', 'Fixture'],
      ['email', PERSON_PAGE_EMAIL],
    ] as const) {
      await observation({
        entityKey: `netid:${stampedNetid}`,
        sourceName: 'official-profile-pi-backfill',
        sourceUrl: OWN_PAGE,
        field,
        value,
      });
    }
    const originalSave = Researcher.prototype.save;
    let replacementAttempted = false;
    let concurrentHolderInserted = false;
    const saveSpy = vi.spyOn(Researcher.prototype, 'save').mockImplementation(async function (
      this: any,
      ...args: any[]
    ) {
      if (!concurrentHolderInserted && this.identifiers?.netid === stampedNetid) {
        replacementAttempted = this.identifiers?.email === PERSON_PAGE_EMAIL;
        concurrentHolderInserted = true;
        await Researcher.collection.insertOne({
          displayName: 'Concurrent Holder',
          identifiers: { netid: stampedNetid },
          archived: false,
        });
      }
      return originalSave.apply(this, args as any);
    });

    try {
      await materializeEntity('user', { entityKey: `netid:${stampedNetid}` }, {});
    } finally {
      saveSpy.mockRestore();
    }

    expect(replacementAttempted).toBe(true);
    const after = await Researcher.findById(researcher._id).lean<any>();
    expect(after.identifiers?.netid).toBeUndefined();
    expect(after.identifiers?.email).toBe(LEGACY_EMAIL);
  });

  it('keeps the stored email when the page candidate is an office mailbox', async () => {
    const researcher = await seedResearcher({
      displayName: 'Ada Fixture',
      identifiers: { netid: OWN_NETID, email: LEGACY_EMAIL },
    });
    await seedOwnKeyPageEmail('registrar.fixture@yale.edu', OWN_PAGE);

    await materializeEntity('user', { entityKey: `netid:${OWN_NETID}` }, {});

    expect(await storedEmail(researcher._id)).toBe(LEGACY_EMAIL);
  });

  it('keeps the stored email when the page candidate does not name the person', async () => {
    const researcher = await seedResearcher({
      displayName: 'Ada Fixture',
      identifiers: { netid: OWN_NETID, email: LEGACY_EMAIL },
    });
    await seedOwnKeyPageEmail('lab.fixture@yale.edu', OWN_PAGE);

    await materializeEntity('user', { entityKey: `netid:${OWN_NETID}` }, {});

    expect(await storedEmail(researcher._id)).toBe(LEGACY_EMAIL);
  });

  it('keeps a non-empty stored email when verified sources disagree', async () => {
    const researcher = await seedResearcherWithStoredEmail();
    await seedStaffDirectoryRecord(OWN_NETID, DIRECTORY_EMAIL, [OWN_NETID]);
    await seedOwnKeyPageEmail(PAGE_EMAIL, OWN_PAGE);

    await materializeEntity('user', { entityKey: OWN_NETID }, {});

    expect(await storedEmail(researcher._id)).toBe(LEGACY_EMAIL);
  });

  it("never replaces a stored email from another person's page", async () => {
    const researcher = await seedResearcherWithStoredEmail();
    await Researcher.create({
      displayName: 'Sam Other',
      identifiers: { netid: 'other456' },
      profileLinks: [officialLink(OTHER_PAGE)],
    });
    await seedOwnKeyPageEmail('other.page.fixture@yale.edu', OTHER_PAGE);

    await materializeEntity('user', { entityKey: `netid:${OWN_NETID}` }, {});

    expect(await storedEmail(researcher._id)).toBe(LEGACY_EMAIL);
  });

  it('fills from the official page the person already holds, under their own netid key', async () => {
    const researcher = await seedResearcher();
    await seedOwnKeyPageEmail(PAGE_EMAIL, OWN_PAGE);

    await materializeEntity('user', { entityKey: `netid:${OWN_NETID}` }, {});

    expect(await storedEmail(researcher._id)).toBe(PAGE_EMAIL);
  });

  it('does not count a page nobody holds as the person own official link', async () => {
    const researcher = await seedResearcher({ profileLinks: [] });
    await seedOwnKeyPageEmail(PAGE_EMAIL, OWN_PAGE);

    await materializeEntity('user', { entityKey: `netid:${OWN_NETID}` }, {});

    expect(await storedEmail(researcher._id)).toBeUndefined();
  });

  it('re-derives the same value on a second resolve and plans no further email write', async () => {
    const researcher = await seedResearcher();
    await seedStaffDirectoryRecord(OWN_NETID, DIRECTORY_EMAIL, [OWN_NETID]);

    await materializeEntity('user', { entityKey: OWN_NETID }, {});
    const second = await materializeEntity('user', { entityKey: OWN_NETID }, { dryRun: true });

    expect(await storedEmail(researcher._id)).toBe(DIRECTORY_EMAIL);
    expect((second as { plannedPaths?: string[] }).plannedPaths ?? []).not.toContain(
      'identifiers.email',
    );
  });

  it("never fills from evidence citing another person's page", async () => {
    const researcher = await seedResearcher();
    await Researcher.create({
      displayName: 'Sam Other',
      identifiers: { netid: 'other456' },
      profileLinks: [officialLink(OTHER_PAGE)],
    });
    await seedOwnKeyPageEmail('other.page.fixture@yale.edu', OTHER_PAGE);

    await materializeEntity('user', { entityKey: `netid:${OWN_NETID}` }, {});

    expect(await storedEmail(researcher._id)).toBeUndefined();
  });

  it('never fills from a page whose email another netid already holds', async () => {
    const researcher = await seedResearcher();
    await Researcher.create({
      displayName: 'Sam Other',
      identifiers: { netid: 'other456', email: PAGE_EMAIL },
    });
    await seedOwnKeyPageEmail(PAGE_EMAIL, OWN_PAGE);

    await materializeEntity('user', { entityKey: `netid:${OWN_NETID}` }, {});

    expect(await storedEmail(researcher._id)).toBeUndefined();
  });

  it('never fills from a directory address another netid already holds', async () => {
    const researcher = await seedResearcher();
    await Researcher.create({
      displayName: 'Sam Other',
      identifiers: { netid: 'other456', email: DIRECTORY_EMAIL },
    });
    await seedStaffDirectoryRecord(OWN_NETID, DIRECTORY_EMAIL, [OWN_NETID]);

    await materializeEntity('user', { entityKey: OWN_NETID }, {});

    expect(await storedEmail(researcher._id)).toBeUndefined();
  });

  it('never fills from a directory record whose run an operator invalidated', async () => {
    const researcher = await seedResearcher();
    const invalidatedRunId = new mongoose.Types.ObjectId();
    await ScrapeRun.create({
      _id: invalidatedRunId,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'yale-directory',
      status: 'success',
      invalidated: true,
    });
    await seedStaffDirectoryRecord(OWN_NETID, DIRECTORY_EMAIL, [OWN_NETID]);
    await Observation.updateMany(
      { entityKey: OWN_NETID, field: 'email' },
      { $set: { scrapeRunId: invalidatedRunId } },
    );

    const result = await materializeEntity('user', { entityKey: OWN_NETID }, {});

    expect(result.skipped).toBeUndefined();
    expect(await storedEmail(researcher._id)).toBeUndefined();
  });

  it('drops the filled email when the netid it was verified against is rolled back', async () => {
    await Researcher.createIndexes();
    const stampedNetid = 'race123';
    await Account.create({
      netid: stampedNetid,
      email: 'race.account.fixture@example.invalid',
      status: 'ACTIVE',
    });
    const researcher = await Researcher.create({ displayName: 'Robin Own' });
    for (const [field, value] of [
      ['netid', stampedNetid],
      ['fname', 'Robin'],
      ['lname', 'Own'],
      ['email', DIRECTORY_EMAIL],
      ['title', 'Professor of Medicine'],
    ] as const) {
      await observation({
        entityKey: stampedNetid,
        sourceName: 'yale-directory',
        sourceUrl: `https://directory.yale.edu/${stampedNetid}`,
        field,
        value,
      });
    }
    const originalSave = Researcher.prototype.save;
    let concurrentHolderInserted = false;
    const saveSpy = vi.spyOn(Researcher.prototype, 'save').mockImplementation(async function (
      this: any,
      ...args: any[]
    ) {
      if (!concurrentHolderInserted && this.identifiers?.netid === stampedNetid) {
        concurrentHolderInserted = true;
        await Researcher.collection.insertOne({
          displayName: 'Concurrent Holder',
          identifiers: { netid: stampedNetid },
          archived: false,
        });
      }
      return originalSave.apply(this, args as any);
    });

    try {
      const result = await materializeEntity('user', { entityKey: stampedNetid }, {});
      expect(result.conflicts).toBeGreaterThanOrEqual(1);
    } finally {
      saveSpy.mockRestore();
    }

    expect(concurrentHolderInserted).toBe(true);
    const after = await Researcher.findById(researcher._id).lean<any>();
    expect(after.identifiers?.netid).toBeUndefined();
    expect(after.identifiers?.email).toBeUndefined();
  });

  it('keeps the stored value when verified sources disagree', async () => {
    const researcher = await seedResearcher();
    await seedStaffDirectoryRecord(OWN_NETID, DIRECTORY_EMAIL, [OWN_NETID]);
    await seedOwnKeyPageEmail(PAGE_EMAIL, OWN_PAGE);

    await materializeEntity('user', { entityKey: OWN_NETID }, {});

    expect(await storedEmail(researcher._id)).toBeUndefined();
  });

  it('keeps the stored value when no identity-verified evidence states one', async () => {
    const researcher = await seedResearcher();
    await observation({
      entityKey: `netid:${OWN_NETID}`,
      sourceName: 'dept-faculty-roster',
      sourceUrl: OWN_PAGE,
      field: 'email',
      value: DIRECTORY_EMAIL,
    });

    const result = await materializeEntity('user', { entityKey: `netid:${OWN_NETID}` }, {});

    expect(result.skipped).toBeUndefined();

    expect(await storedEmail(researcher._id)).toBeUndefined();
  });
});
