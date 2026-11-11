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

  it('never replaces a non-empty stored email', async () => {
    const researcher = await seedResearcherWithStoredEmail();
    await seedStaffDirectoryRecord(OWN_NETID, DIRECTORY_EMAIL, [OWN_NETID]);

    await materializeEntity('user', { entityKey: OWN_NETID }, {});

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
      entityKey: 'netid:own.directory.fixture',
      sourceName: 'dept-faculty-roster',
      sourceUrl: 'https://medicine.yale.edu/people/',
      field: 'email',
      value: DIRECTORY_EMAIL,
    });

    await materializeEntity('user', { entityKey: 'netid:own.directory.fixture' }, {});

    expect(await storedEmail(researcher._id)).toBeUndefined();
  });
});
