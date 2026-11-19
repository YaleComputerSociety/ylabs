import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async (_type: string, docs: unknown[]) => docs.length),
  syncEntity: vi.fn(async () => true),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, ...meiliMocks };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return {
    ...actual,
    recomputeBrowseRankForEntities: vi.fn().mockResolvedValue({ updated: 0, indexSyncFailures: 0 }),
  };
});

import routes from '../../routes';
import { refreshDirectoryRemovalsBeforeServing } from '../../middleware/directoryRemovalFreshness';
import { DirectoryRemoval } from '../../models/directoryRemoval';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { ScrapeRun } from '../../models/scrapeRun';
import { loadDirectoryRemovalMatcher } from '../../services/directoryRemovalMatcher';
import { setDirectoryRemovalServingForTest } from '../../services/directoryRemovalServing';
import { materializeEntity, materializeFromRun } from '../../scrapers/entityMaterializer';
import { appendObservations } from '../../scrapers/observationStore';
import {
  CentersInstitutesScraper,
  type CenterConfig,
  type CenterMember,
} from '../../scrapers/sources/centersInstitutesScraper';
import type { ObservationInput, ScraperContext } from '../../scrapers/types';
import { clearC4Flags } from '../../scrapers/__tests__/c4FlagTestEnv';
import {
  DIRECTORY_REMOVAL_KEY_ENV,
  directoryRemovalDigest,
} from '../../utils/directoryRemovalDigest';
import { runDirectoryRemovalReslug } from '../directoryRemovalReslugCore';

const KEY = 'synthetic-directory-removal-key-0123456789';
const SOURCE_NAME = 'centers-institutes-index';
const SOURCE_ID = new mongoose.Types.ObjectId();
const ROSTER_URL = 'https://fixture-center.example.edu/people';
const OLD_SLUG = 'center-varrow-tallent';
const NEW_SLUG = 'center-tallent';
const REMOVED_NETID = 'zz9301';

const member = (name: string, role: CenterMember['role'] = 'core-faculty'): CenterMember => ({
  name,
  role,
  profileUrl: `https://fixture-center.example.edu/people/${name.toLowerCase().replace(/ /g, '-')}`,
});

const REMOVED_LEAD = member('Quillon Varrow', 'director');
const KEPT_LEAD = member('Brisa Tallent', 'director');
const FIRST_ROSTER = [REMOVED_LEAD, KEPT_LEAD, member('Odile Marchetti')];
const LATER_ROSTER = [...FIRST_ROSTER, member('Tobin Ashgrove')];

const config: CenterConfig = {
  centerKey: 'varrow-tallent',
  centerName: 'Varrow Tallent Synthetic Center',
  schoolName: '',
  kind: 'center',
  url: ROSTER_URL,
  homeUrl: 'https://fixture-center.example.edu/',
  paginated: false,
  extractor: (html: string) => ({ members: JSON.parse(html) as CenterMember[] }),
};

const afterAMoment = () => new Promise((resolve) => setTimeout(resolve, 5));

async function runCenterLane(roster: CenterMember[]): Promise<void> {
  await afterAMoment();
  const scrapeRunId = new mongoose.Types.ObjectId();
  await ScrapeRun.create({
    _id: scrapeRunId,
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    status: 'running',
  });
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    options: { dryRun: false, useCache: false, release: false },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  await new CentersInstitutesScraper([config], null, async () => JSON.stringify(roster)).run(ctx);
  await appendObservations(emitted, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
  await materializeFromRun(String(scrapeRunId));
}

const researcherNamed = (name: string) => Researcher.findOne({ displayName: name }).lean<any>();

async function seedPerson(name: string, netid: string) {
  return Researcher.create({ displayName: name, identifiers: { netid }, profileLinks: [] });
}

async function seedRow(slug: string, leadIds: mongoose.Types.ObjectId[], extra = {}) {
  const row = await ResearchEntity.create({
    slug,
    name: `Synthetic ${slug}`,
    kind: 'lab',
    entityType: 'LAB',
    ...extra,
  });
  await RoleAssignment.insertMany(
    leadIds.map((personId) => ({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: row._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 1,
      reviewStatus: 'APPROVED',
    })),
  );
  return row;
}

const recordRemovalOf = (netid: string) =>
  DirectoryRemoval.create({
    digest: directoryRemovalDigest(KEY, 'netid', netid),
    kind: 'netid',
    recordedAt: new Date(),
  });

const reslug = async (apply: boolean) =>
  runDirectoryRemovalReslug({ matcher: await loadDirectoryRemovalMatcher(), apply });

const slugs = async () =>
  (await ResearchEntity.find({}).select('slug').lean<Array<{ slug: string }>>())
    .map((row) => row.slug)
    .sort();

const KEY_ONLY_LANE_KEY = 'varrow-tallent-optics-lab';

async function runKeyOnlyLane(
  extra: Array<Pick<ObservationInput, 'field' | 'value' | 'entityId'>> = [],
  entityKey = KEY_ONLY_LANE_KEY,
): Promise<string> {
  await afterAMoment();
  const scrapeRunId = new mongoose.Types.ObjectId();
  await ScrapeRun.create({
    _id: scrapeRunId,
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    status: 'running',
  });
  const base = {
    entityType: 'researchEntity' as const,
    entityKey,
    sourceUrl: 'https://fixture-optics.example.edu/about',
  };
  await appendObservations(
    [
      { ...base, field: 'slug', value: entityKey },
      { ...base, field: 'name', value: 'Synthetic Optics Lab' },
      { ...base, field: 'entityType', value: 'LAB' },
      ...extra.map((observation) => ({ ...base, ...observation })),
    ],
    {
      scrapeRunId: String(scrapeRunId),
      sourceId: String(SOURCE_ID),
      sourceName: SOURCE_NAME,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );
  await materializeFromRun(String(scrapeRunId));
  return String(scrapeRunId);
}

async function keyOnlyLaneRowRenamedForARemovedLead(
  extra: Array<Pick<ObservationInput, 'field' | 'value'>> = [],
) {
  await runKeyOnlyLane(extra);
  const row = await ResearchEntity.findOne({ slug: KEY_ONLY_LANE_KEY }).lean<any>();
  const removed = await seedPerson(REMOVED_LEAD.name, REMOVED_NETID);
  const kept = await seedPerson(KEPT_LEAD.name, 'zz9305');
  await RoleAssignment.insertMany(
    [removed._id, kept._id].map((personId) => ({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: row._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 1,
      reviewStatus: 'APPROVED',
    })),
  );
  await recordRemovalOf(REMOVED_NETID);
  await reslug(true);
  return row;
}

describe('directory-removal:reslug renames a co-led row a removed lead names (#4160)', () => {
  let replSet: MongoMemoryReplSet;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
    await ResearchEntity.syncIndexes();
    await DirectoryRemoval.syncIndexes();
    const app = express();
    app.use(express.json());
    app.use('/api', refreshDirectoryRemovalsBeforeServing);
    app.use('/api', routes);
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    setDirectoryRemovalServingForTest(undefined);
    await new Promise((resolve) => server?.close(resolve));
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    vi.stubEnv(DIRECTORY_REMOVAL_KEY_ENV, KEY);
    setDirectoryRemovalServingForTest(undefined);
    meiliMocks.syncEntities.mockClear();
    const db = mongoose.connection.db!;
    for (const name of [
      'observations',
      'research_entities',
      'research_entity_relationships',
      'researchers',
      'role_assignments',
      'scrape_runs',
      'directory_removals',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function laneMintedCoLedRowWithARemovedLead() {
    await runCenterLane(FIRST_ROSTER);
    const removed = await researcherNamed(REMOVED_LEAD.name);
    await Researcher.updateOne(
      { _id: removed._id },
      { $set: { 'identifiers.netid': REMOVED_NETID } },
    );
    const row = await ResearchEntity.findOne({ slug: OLD_SLUG }).lean<any>();
    expect(row).toBeTruthy();
    await ResearchEntity.updateOne(
      { _id: row._id },
      {
        $set: {
          studentVisibilityTier: 'student_ready',
          shortDescription: 'Studies synthetic tissue repair.',
          fullDescription: 'The center studies how synthetic tissues repair after injury.',
        },
      },
    );
    await recordRemovalOf(REMOVED_NETID);
    return row;
  }

  it('refuses to run while the removal list is empty', async () => {
    await expect(reslug(false)).rejects.toThrow(/no active directory_removals entry/);
  });

  it('refuses to run with entries but no key', async () => {
    await recordRemovalOf(REMOVED_NETID);
    vi.stubEnv(DIRECTORY_REMOVAL_KEY_ENV, '');
    await expect(reslug(false)).rejects.toThrow(/without a directory removal key/);
  });

  it('writes nothing on a dry run', { timeout: 60000 }, async () => {
    await laneMintedCoLedRowWithARemovedLead();
    const before = {
      slugs: await slugs(),
      keyed: await Observation.countDocuments({ entityId: { $ne: null } }),
    };

    const report = await reslug(false);

    expect(report.rowsToRename).toBe(1);
    expect(report.observationsToStamp).toBeGreaterThan(0);
    expect(report.rowsRenamed).toBeUndefined();
    expect(await slugs()).toEqual(before.slugs);
    expect(await Observation.countDocuments({ entityId: { $ne: null } })).toBe(before.keyed);
    expect(meiliMocks.syncEntities).not.toHaveBeenCalled();
  });

  it(
    'renames only the qualifying co-led row and leaves a namesake row and a sole-lead row',
    {
      timeout: 60000,
    },
    async () => {
      const coLed = await laneMintedCoLedRowWithARemovedLead();
      const removed = await researcherNamed(REMOVED_LEAD.name);
      const namesake = await seedPerson(REMOVED_LEAD.name, 'zz9302');
      const other = await seedPerson('Pell Ostrander', 'zz9303');
      await seedRow('quillon-varrow-ostrander-lab', [namesake._id, other._id]);
      await seedRow('quillon-varrow-lab', [removed._id]);

      const report = await reslug(true);

      expect(report).toMatchObject({
        removedResearchers: 1,
        liveRowsLedByARemovedResearcher: 2,
        rowsWithNoOtherLiveLead: 1,
        rowsToRename: 1,
        rowsRenamed: 1,
        searchDocumentsResynced: 1,
        searchIndexSyncFailures: 0,
      });
      expect(await slugs()).toEqual(
        [NEW_SLUG, 'quillon-varrow-lab', 'quillon-varrow-ostrander-lab'].sort(),
      );
      const renamed = await ResearchEntity.findById(coLed._id).lean<any>();
      expect(renamed.slug).toBe(NEW_SLUG);
      expect(renamed.mergedFrom).toBeUndefined();
      expect(
        await Observation.countDocuments({
          entityType: 'researchEntity',
          entityKey: OLD_SLUG,
          entityId: null,
        }),
      ).toBe(0);
      const [, synced] = meiliMocks.syncEntities.mock.calls[0];
      expect((synced as any[]).map((doc) => doc.slug)).toEqual([NEW_SLUG]);
    },
  );

  it(
    'serves the row at the new slug and 404s the old one through the detail route',
    {
      timeout: 60000,
    },
    async () => {
      await laneMintedCoLedRowWithARemovedLead();
      await reslug(true);

      expect((await fetch(`${baseUrl}/api/research/${OLD_SLUG}`)).status).toBe(404);
      expect((await fetch(`${baseUrl}/api/research/${NEW_SLUG}`)).status).toBe(200);
    },
  );

  it('numbers the new slug when a lane already files observations under it', async () => {
    await laneMintedCoLedRowWithARemovedLead();
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: NEW_SLUG,
      field: 'name',
      value: 'Synthetic Unminted Center',
      confidence: 0.8,
      sourceId: SOURCE_ID,
      sourceName: SOURCE_NAME,
      scrapeRunId: new mongoose.Types.ObjectId(),
      observedAt: new Date(),
    });

    await reslug(true);

    expect(await slugs()).toEqual([`${NEW_SLUG}-2`]);
  });

  it('is a no-op on a second apply', { timeout: 60000 }, async () => {
    await laneMintedCoLedRowWithARemovedLead();
    await reslug(true);
    meiliMocks.syncEntities.mockClear();

    const second = await reslug(true);

    expect(second).toMatchObject({ rowsToRename: 0, rowsRenamed: 0, observationsStamped: 0 });
    expect(await slugs()).toEqual([NEW_SLUG]);
    expect(meiliMocks.syncEntities).not.toHaveBeenCalled();
  });

  it(
    'keeps the new slug when the lane re-emits the old key, twice, and attaches its new roster edges',
    {
      timeout: 120000,
    },
    async () => {
      const coLed = await laneMintedCoLedRowWithARemovedLead();
      await reslug(true);

      await runCenterLane(LATER_ROSTER);
      await runCenterLane(LATER_ROSTER);
      await materializeEntity('researchEntity', { entityId: String(coLed._id) });

      expect(await slugs()).toEqual([NEW_SLUG]);
      const newMember = await researcherNamed('Tobin Ashgrove');
      expect(newMember).toBeTruthy();
      const edge = await RoleAssignment.findOne({ personId: newMember._id }).lean<any>();
      expect(String(edge?.target?.id)).toBe(String(coLed._id));
      expect((await fetch(`${baseUrl}/api/research/${OLD_SLUG}`)).status).toBe(404);
    },
  );

  it(
    'adopts the renamed row for a lane key with no website to fold on, run twice',
    {
      timeout: 120000,
    },
    async () => {
      await keyOnlyLaneRowRenamedForARemovedLead();

      await runKeyOnlyLane();
      await runKeyOnlyLane();

      expect(await slugs()).toEqual(['tallent-optics-lab']);
    },
  );

  it(
    'mints nothing at the old slug after the renamed row is archived, run twice, once the stamps the reslug wrote are gone',
    {
      timeout: 120000,
    },
    async () => {
      const row = await keyOnlyLaneRowRenamedForARemovedLead();
      const reslugStamped = await Observation.distinct('_id', {
        entityKey: KEY_ONLY_LANE_KEY,
        reslugAdoption: true,
      });
      expect(reslugStamped.length).toBeGreaterThan(0);
      await runKeyOnlyLane();
      await Observation.deleteMany({ _id: { $in: reslugStamped } });
      await Observation.deleteMany({ superseded: true });
      await ResearchEntity.updateOne({ _id: row._id }, { $set: { archived: true } });

      await runKeyOnlyLane();
      await runKeyOnlyLane();

      expect(await ResearchEntity.countDocuments({ slug: KEY_ONLY_LANE_KEY })).toBe(0);
      expect(await slugs()).toEqual(['tallent-optics-lab']);
    },
  );

  it(
    'still mints a key whose observations name an archived row by id without a reslug stamp',
    {
      timeout: 120000,
    },
    async () => {
      const unrelatedKey = 'synthetic-unrelated-optics-lab';
      const archivedElsewhere = await seedRow('synthetic-archived-elsewhere', [], {
        archived: true,
      });
      await runKeyOnlyLane(
        [{ field: 'name', value: 'Synthetic Optics Lab', entityId: String(archivedElsewhere._id) }],
        unrelatedKey,
      );
      expect(
        await Observation.countDocuments({
          entityKey: unrelatedKey,
          entityId: archivedElsewhere._id,
        }),
      ).toBeGreaterThan(0);

      await runKeyOnlyLane([], unrelatedKey);

      expect(
        await ResearchEntity.countDocuments({ slug: unrelatedKey, archived: { $ne: true } }),
      ).toBe(1);
    },
  );

  it(
    'keeps the old lane key on the renamed row after its superseded observations are pruned',
    {
      timeout: 120000,
    },
    async () => {
      const row = await keyOnlyLaneRowRenamedForARemovedLead();
      await runKeyOnlyLane();

      const liveOldKeyIds = await Observation.distinct('entityId', {
        entityType: 'researchEntity',
        entityKey: KEY_ONLY_LANE_KEY,
        superseded: false,
      });
      expect(liveOldKeyIds.map(String)).toEqual([String(row._id)]);
      await Observation.deleteMany({ superseded: true });
      await runKeyOnlyLane();

      expect(await slugs()).toEqual(['tallent-optics-lab']);
    },
  );

  it(
    'keeps taking the old lane key contact after fresh observations supersede the stamped ones',
    {
      timeout: 120000,
    },
    async () => {
      const firstContact = 'optics-first-contact@yale.edu';
      const laterContact = 'optics-later-contact@yale.edu';
      const row = await keyOnlyLaneRowRenamedForARemovedLead([
        { field: 'contactEmail', value: firstContact },
      ]);
      expect((await ResearchEntity.findById(row._id).lean<any>()).contactEmail).toBe(firstContact);

      await runKeyOnlyLane([{ field: 'contactEmail', value: laterContact }]);
      await runKeyOnlyLane([{ field: 'contactEmail', value: laterContact }]);

      const renamed = await ResearchEntity.findById(row._id).lean<any>();
      expect(renamed.slug).toBe('tallent-optics-lab');
      expect(renamed.contactEmail).toBe(laterContact);
    },
  );

  it(
    'takes a numbered slug when the stripped slug is held by any row, archived included',
    {
      timeout: 60000,
    },
    async () => {
      const removed = await seedPerson(REMOVED_LEAD.name, REMOVED_NETID);
      const kept = await seedPerson(KEPT_LEAD.name, 'zz9304');
      await seedRow(NEW_SLUG, [], { archived: true });
      const coLed = await seedRow(OLD_SLUG, [removed._id, kept._id]);
      await recordRemovalOf(REMOVED_NETID);

      const report = await reslug(true);

      expect(report.rowsTakingANumberedSlug).toBe(1);
      expect((await ResearchEntity.findById(coLed._id).lean<any>()).slug).toBe(`${NEW_SLUG}-2`);
    },
  );

  it(
    'never mints a new row whose slug carries a removed researcher name',
    { timeout: 60000 },
    async () => {
      await seedPerson(REMOVED_LEAD.name, REMOVED_NETID);
      await recordRemovalOf(REMOVED_NETID);
      const scrapeRunId = new mongoose.Types.ObjectId();
      await ScrapeRun.create({
        _id: scrapeRunId,
        sourceId: SOURCE_ID,
        sourceName: SOURCE_NAME,
        status: 'running',
      });
      const base = {
        entityType: 'researchEntity' as const,
        entityKey: 'quillon-varrow-optics-lab',
        sourceUrl: 'https://fixture-optics.example.edu/',
      };
      await appendObservations(
        [
          { ...base, field: 'slug', value: base.entityKey },
          { ...base, field: 'name', value: 'Synthetic Optics Lab' },
          { ...base, field: 'entityType', value: 'LAB' },
        ],
        {
          scrapeRunId: String(scrapeRunId),
          sourceId: String(SOURCE_ID),
          sourceName: SOURCE_NAME,
          sourceWeight: 0.8,
          dryRun: false,
        },
      );

      const result = await materializeFromRun(String(scrapeRunId));

      expect(result.removedByRequest).toBe(1);
      expect(await ResearchEntity.countDocuments({ slug: base.entityKey })).toBe(0);
    },
  );

  it(
    'records no previous slug, so the old slug stays a 404 rather than a redirect (#5808)',
    { timeout: 60000 },
    async () => {
      const coLed = await laneMintedCoLedRowWithARemovedLead();
      await reslug(true);

      const renamed = await ResearchEntity.findById(coLed._id).lean<any>();
      expect(renamed.slug).toBe(NEW_SLUG);
      expect(renamed.previousSlugs).toBeUndefined();
      expect(await ResearchEntity.countDocuments({ 'previousSlugs.slug': OLD_SLUG })).toBe(0);
      const old = await fetch(`${baseUrl}/api/research/${OLD_SLUG}`, { redirect: 'manual' });
      expect(old.status).toBe(404);
    },
  );
});
