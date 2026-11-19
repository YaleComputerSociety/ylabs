import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    syncEntities: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

const captured = vi.hoisted(() => ({
  options: undefined as undefined | { materializeUser?: unknown },
}));

vi.mock('../fieldRetraction', async () => {
  const actual = await vi.importActual<typeof import('../fieldRetraction')>('../fieldRetraction');
  return {
    ...actual,
    reconcileFieldRetractionsFromRun: vi.fn(
      async (
        scrapeRunId: string,
        options: Parameters<typeof actual.reconcileFieldRetractionsFromRun>[1],
      ) => {
        captured.options = options;
        return actual.reconcileFieldRetractionsFromRun(scrapeRunId, options);
      },
    ),
  };
});

import { Researcher } from '../../models/researcher';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeFromRun } from '../entityMaterializer';
import type { ScopedUserMaterializer } from '../fieldRetraction';
import { appendObservations } from '../observationStore';
import {
  extractOfficialProfileIdentity,
  identityToUserObservations,
} from '../sources/officialProfilePiBackfillScraper';

beforeEach(clearC4Flags);

const PI_SOURCE = 'official-profile-pi-backfill';
const PI_PAGE = 'https://medicine.yale.edu/profile/rowan-quillfeather/';
const PI_KEY = 'netid:rq1';
const ADDRESS = 'rowan.quillfeather@yale.edu';

const piObservations = () => {
  const identity = extractOfficialProfileIdentity(
    `<html><head><link rel="canonical" href="${PI_PAGE}" /></head><body><main>
      <h1>Rowan Quillfeather</h1><div class="title">Professor of Fixture Studies</div>
      <a href="mailto:${ADDRESS}">Email</a><div class="department">Fixture Studies</div>
    </main></body></html>`,
    PI_PAGE,
    {
      name: 'Quillfeather Fixture Lab',
      slug: 'quillfeather-fixture-lab',
      leadUsers: [{ fname: 'Rowan', lname: 'Quillfeather', netid: 'rq1' }],
    },
    {
      requireEmail: false,
      expectedPeople: [{ fname: 'Rowan', lname: 'Quillfeather', netid: 'rq1' }],
    },
  );
  if (!identity) throw new Error('fixture profile did not parse');
  return identityToUserObservations(identity, { netid: 'rq1' });
};

const unmaterializedPerson = {
  displayName: 'Rowan Quillfeather',
  fname: 'Rowan',
  lname: 'Quillfeather',
  identifiers: { netid: 'rq1', email: ADDRESS },
};

describe('materializeFromRun hands the retraction re-derive a scoped user materializer (#6009)', () => {
  let replSet: MongoMemoryReplSet;
  const originalFlag = process.env.SCRAPER_FIELD_RETRACTION;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    process.env.SCRAPER_FIELD_RETRACTION = originalFlag;
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    captured.options = undefined;
    process.env.SCRAPER_FIELD_RETRACTION = 'true';
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'scrape_runs', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('writes only the scope it is handed, through the real call site', async () => {
    const run = await ScrapeRun.create({
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: PI_SOURCE,
      status: 'success',
      startedAt: new Date('2026-10-02T00:00:00Z'),
    });
    await appendObservations(
      piObservations().map((observation) => ({
        ...observation,
        observedAt: new Date('2026-10-02T00:00:00Z'),
      })),
      {
        scrapeRunId: String(run._id),
        sourceId: String(new mongoose.Types.ObjectId()),
        sourceName: PI_SOURCE,
        sourceWeight: 0.8,
        dryRun: false,
      },
    );

    await materializeFromRun(String(run._id), { dryRun: false });
    const materializeUser = captured.options?.materializeUser as ScopedUserMaterializer | undefined;
    expect(materializeUser).toBeTypeOf('function');

    await Researcher.deleteMany({});
    await Researcher.collection.insertOne(unmaterializedPerson);
    await materializeUser!({ entityKey: PI_KEY }, ['identifiers.email']);

    const after = await Researcher.findOne({ 'identifiers.netid': 'rq1' }).lean<{
      identifiers?: { emailSupport?: unknown };
      profile?: unknown;
      profileLinks?: unknown;
      profileFieldWriters?: unknown;
    }>();
    expect(after?.identifiers?.emailSupport).toBeDefined();
    expect(after?.profile).toBeUndefined();
    expect(after?.profileLinks).toBeUndefined();
    expect(after?.profileFieldWriters).toBeUndefined();
  });
});
