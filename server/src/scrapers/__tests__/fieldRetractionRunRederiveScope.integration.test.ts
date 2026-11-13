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

import { Researcher } from '../../models/researcher';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeEntity } from '../entityMaterializer';
import {
  reconcileFieldRetractionsFromRun,
  reconcileUserFieldRetractions,
  scopedRunUserRederiver,
} from '../fieldRetraction';
import { appendObservations } from '../observationStore';
import {
  extractOfficialProfileIdentity,
  identityToUserObservations,
} from '../sources/officialProfilePiBackfillScraper';
import type { ObservationInput } from '../types';

beforeEach(clearC4Flags);

const PI_SOURCE = 'official-profile-pi-backfill';
const PI_PAGE = 'https://medicine.yale.edu/profile/rowan-quillfeather/';
const PI_KEY = 'netid:rq1';
const ADDRESS = 'rowan.quillfeather@yale.edu';

const piProfile = (contact: string) => `
  <html>
    <head><link rel="canonical" href="${PI_PAGE}" /></head>
    <body>
      <main>
        <h1>Rowan Quillfeather</h1>
        <div class="title">Professor of Fixture Studies</div>
        ${contact}
        <div class="department">Fixture Studies</div>
      </main>
    </body>
  </html>
`;
const piEntity = {
  name: 'Quillfeather Fixture Lab',
  slug: 'quillfeather-fixture-lab',
  leadUsers: [{ fname: 'Rowan', lname: 'Quillfeather', netid: 'rq1' }],
};

const piRead = (contact: string): ObservationInput[] => {
  const identity = extractOfficialProfileIdentity(piProfile(contact), PI_PAGE, piEntity, {
    requireEmail: false,
    expectedPeople: piEntity.leadUsers,
  });
  if (!identity) throw new Error('fixture profile did not parse');
  return identityToUserObservations(identity, { netid: 'rq1' });
};

let clock = Date.UTC(2026, 9, 1);
async function appendRun(observations: ObservationInput[]): Promise<string> {
  clock += 24 * 60 * 60 * 1000;
  const observedAt = new Date(clock);
  const run = await ScrapeRun.create({
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: PI_SOURCE,
    status: 'success',
    startedAt: observedAt,
  });
  await appendObservations(
    observations.map((observation) => ({ ...observation, observedAt })),
    {
      scrapeRunId: String(run._id),
      sourceId: String(new mongoose.Types.ObjectId()),
      sourceName: PI_SOURCE,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );
  return String(run._id);
}

const storedPerson = () =>
  Researcher.findOne({ 'identifiers.netid': 'rq1' }).lean<{
    identifiers?: { email?: string; emailSupport?: unknown };
    profile?: { title?: string; primaryDepartment?: string };
    profileLinks?: unknown[];
    profileFieldWriters?: unknown;
  }>();

async function seedRetractableEmailOnAnUnmaterializedPerson(): Promise<string> {
  await appendRun(piRead(`<a href="mailto:${ADDRESS}">Email</a>`));
  await Researcher.collection.insertOne({
    displayName: 'Rowan Quillfeather',
    fname: 'Rowan',
    lname: 'Quillfeather',
    identifiers: { netid: 'rq1', email: ADDRESS },
  });
  await appendRun(piRead(''));
  return appendRun(piRead(''));
}

describe('the end-of-run retraction re-derive writes only the retracted field (#6009)', () => {
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
    process.env.SCRAPER_FIELD_RETRACTION = 'true';
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'scrape_runs', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('re-derives only the email scope and leaves the unmaterialized profile fields alone', async () => {
    const lastRunId = await seedRetractableEmailOnAnUnmaterializedPerson();
    const scopes: string[][] = [];

    const result = await reconcileFieldRetractionsFromRun(lastRunId, {
      materializeUser: (identifier, onlyFields) => {
        scopes.push([...onlyFields]);
        return materializeEntity('user', identifier, {
          dryRun: false,
          userWriteOnlyFields: onlyFields,
        });
      },
    });

    expect(result.userFieldRetraction).toMatchObject({
      outcome: 'reconciled',
      retiredObservations: 1,
      rederivedSubjects: 1,
      rederiveErrors: 0,
    });
    expect(scopes).toEqual([['identifiers.email']]);
    const after = await storedPerson();
    expect(after?.identifiers?.emailSupport).toBeDefined();
    expect(after?.profile).toBeUndefined();
    expect(after?.profileLinks).toBeUndefined();
    expect(after?.profileFieldWriters).toBeUndefined();
  });

  it('skips and counts a subject whose retracted field has no scope, writing nothing to it', async () => {
    await seedRetractableEmailOnAnUnmaterializedPerson();
    const materialize = vi.fn().mockResolvedValue(undefined);
    const scoped = scopedRunUserRederiver(materialize);

    const result = await reconcileUserFieldRetractions({
      sourceName: PI_SOURCE,
      rederive: (identifier, retractedFields) =>
        scoped(identifier, [...retractedFields, 'fieldWithNoScope']),
    });

    expect(result).toMatchObject({ rederivedSubjects: 0, rederiveErrors: 1 });
    expect(materialize).not.toHaveBeenCalled();
    const after = await storedPerson();
    expect(after?.identifiers?.emailSupport).toBeUndefined();
    expect(after?.profileLinks).toBeUndefined();
  });

  it('an unscoped re-derive of the same person would have written those profile fields', async () => {
    await seedRetractableEmailOnAnUnmaterializedPerson();
    await materializeEntity('user', { entityKey: PI_KEY }, { dryRun: false });
    const after = await storedPerson();
    expect(after?.profile?.title).toBe('Professor of Fixture Studies');
    expect(after?.profileLinks).toHaveLength(1);
  });
});
