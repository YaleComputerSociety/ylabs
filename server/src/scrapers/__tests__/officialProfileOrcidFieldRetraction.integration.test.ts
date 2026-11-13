/**
 * #6003 end to end against a real store: official-profile-pi-backfill retires an implausible
 * ORCID it asserted before #5998 once two later reads of the same page attest that the page
 * states no ORCID. A page still stating a plausible ORCID, a page labelling an iD the reader
 * refuses, and another lane's ORCID are never touched, and a second pass changes nothing.
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';
import { syntheticPersonOrcid } from '../../test/syntheticOrcid';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { appendObservations } from '../observationStore';
import {
  USER_ORCID_FIELD_RETRACTION_ROLLBACK_REASON,
  reconcileUserFieldRetractions,
} from '../fieldRetraction';
import {
  extractOfficialProfileIdentity,
  identityToUserObservations,
} from '../sources/officialProfilePiBackfillScraper';
import type { ObservationInput } from '../types';

beforeEach(clearC4Flags);

const PI_SOURCE = 'official-profile-pi-backfill';
const RIVAL_SOURCE = 'ysm-faculty-directory';
const PI_PAGE = 'https://medicine.yale.edu/profile/rowan-quillfeather/';
const PI_KEY = 'netid:rq1';
const YEAR_RUN = '2025-2024-2023-2022';
const PLAUSIBLE_ORCID = syntheticPersonOrcid(6003);

const piProfile = (section: string) => `
  <html>
    <head><link rel="canonical" href="${PI_PAGE}" /></head>
    <body>
      <main>
        <h1>Rowan Quillfeather</h1>
        <div class="title">Professor of Fixture Studies</div>
        <div class="department">Fixture Studies</div>
        ${section}
      </main>
    </body>
  </html>
`;
const piEntity = {
  name: 'Quillfeather Fixture Lab',
  slug: 'quillfeather-fixture-lab',
  leadUsers: [{ fname: 'Rowan', lname: 'Quillfeather', netid: 'rq1' }],
};

const publicationYears = `<section class="publications"><h2>Publications</h2><p>${YEAR_RUN}</p></section>`;
const orcidLink = `<a href="https://orcid.org/${PLAUSIBLE_ORCID}">ORCID</a>`;
const labelledYearRun = `<p>ORCID: ${YEAR_RUN}</p>`;

const piRead = (section: string): ObservationInput[] => {
  const identity = extractOfficialProfileIdentity(piProfile(section), PI_PAGE, piEntity, {
    requireEmail: false,
    expectedPeople: piEntity.leadUsers,
  });
  if (!identity) throw new Error('fixture profile did not parse');
  return identityToUserObservations(identity, { netid: 'rq1' });
};

const assertedOrcid = (value: string): ObservationInput => ({
  entityType: 'user',
  entityKey: PI_KEY,
  field: 'orcid',
  value,
  sourceUrl: PI_PAGE,
  confidenceOverride: 0.9,
});

let clock = Date.UTC(2026, 10, 1);
async function appendRun(sourceName: string, observations: ObservationInput[]) {
  clock += 24 * 60 * 60 * 1000;
  const observedAt = new Date(clock);
  const run = await ScrapeRun.create({
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    status: 'success',
    startedAt: observedAt,
  });
  await appendObservations(
    observations.map((observation) => ({ ...observation, observedAt })),
    {
      scrapeRunId: String(run._id),
      sourceId: String(new mongoose.Types.ObjectId()),
      sourceName,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );
}

const liveOrcids = async (sourceName: string) =>
  (
    await Observation.find({
      sourceName,
      entityType: 'user',
      field: 'orcid',
      superseded: { $ne: true },
      'rollback.rolledBackAt': { $exists: false },
    }).lean<Array<{ entityKey: string; value: unknown }>>()
  ).map((row) => `${row.entityKey} ${String(row.value)}`);

describe('official-profile-pi-backfill retires an implausible ORCID it asserted (#6003)', () => {
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
    for (const name of ['observations', 'researchers', 'sources', 'scrape_runs']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('claims orcid absent on every row of a read whose page states no ORCID, even beside a year run', () => {
    const rows = piRead(publicationYears);
    expect(rows.some((row) => row.field === 'orcid')).toBe(false);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.assertsNoValueFor?.includes('orcid'))).toBe(true);
  });

  it('retires the year run after two attesting reads, leaves the rival lane alone, and a second pass is a no-op', async () => {
    await appendRun(PI_SOURCE, [assertedOrcid(YEAR_RUN)]);
    await appendRun(RIVAL_SOURCE, [assertedOrcid(YEAR_RUN)]);
    await appendRun(PI_SOURCE, piRead(publicationYears));
    const rederive = vi.fn().mockResolvedValue(undefined);

    const afterOne = await reconcileUserFieldRetractions({ sourceName: PI_SOURCE, rederive });
    expect(afterOne.counts.awaitingSecondCompleteRead).toBe(1);
    expect(await liveOrcids(PI_SOURCE)).toEqual([`${PI_KEY} ${YEAR_RUN}`]);

    await appendRun(PI_SOURCE, piRead(publicationYears));
    const applied = await reconcileUserFieldRetractions({ sourceName: PI_SOURCE, rederive });
    expect(applied).toMatchObject({ outcome: 'reconciled', retiredObservations: 1 });
    expect(rederive).toHaveBeenCalledExactlyOnceWith({ entityKey: PI_KEY }, ['orcid']);
    expect(await liveOrcids(PI_SOURCE)).toEqual([]);
    expect(await liveOrcids(RIVAL_SOURCE)).toEqual([`${PI_KEY} ${YEAR_RUN}`]);
    const retired = await Observation.findOne({ sourceName: PI_SOURCE, field: 'orcid' }).lean<{
      rollback?: { reason?: string };
    }>();
    expect(retired?.rollback?.reason).toBe(USER_ORCID_FIELD_RETRACTION_ROLLBACK_REASON);

    const again = await reconcileUserFieldRetractions({ sourceName: PI_SOURCE, rederive });
    expect(again).toMatchObject({ outcome: 'no-candidates', retiredObservations: 0 });
    expect(rederive).toHaveBeenCalledTimes(1);
  });

  it('keeps a plausible ORCID the page still states', async () => {
    await appendRun(PI_SOURCE, piRead(orcidLink));
    expect(await liveOrcids(PI_SOURCE)).toEqual([`${PI_KEY} ${PLAUSIBLE_ORCID}`]);
    await appendRun(PI_SOURCE, piRead(`${orcidLink}${publicationYears}`));
    await appendRun(PI_SOURCE, piRead(`${orcidLink}${publicationYears}`));

    const planned = await reconcileUserFieldRetractions({ sourceName: PI_SOURCE });
    expect(planned.retractions).toEqual([]);
    expect(await liveOrcids(PI_SOURCE)).toEqual([`${PI_KEY} ${PLAUSIBLE_ORCID}`]);
    expect(
      await Observation.countDocuments({ sourceName: PI_SOURCE, assertsNoValueFor: 'orcid' }),
    ).toBe(0);
  });

  it('claims nothing while the page labels an iD the reader refuses', async () => {
    await appendRun(PI_SOURCE, [assertedOrcid(YEAR_RUN)]);
    await appendRun(PI_SOURCE, piRead(labelledYearRun));
    await appendRun(PI_SOURCE, piRead(labelledYearRun));

    const planned = await reconcileUserFieldRetractions({ sourceName: PI_SOURCE });
    expect(planned.retractions).toEqual([]);
    expect(planned.counts.absenceNotWitnessed).toBe(1);
    expect(await liveOrcids(PI_SOURCE)).toEqual([`${PI_KEY} ${YEAR_RUN}`]);
  });
});
