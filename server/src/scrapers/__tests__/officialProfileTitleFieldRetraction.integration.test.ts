/**
 * #6233 end to end against a real store: official-profile-pi-backfill retires a title it
 * asserted before its extractor learned to refuse it, once two later reads of the same,
 * identity-confirmed page find no admissible title there. A page still stating an appointment,
 * another person's page and another lane's title are never touched, and a second pass changes
 * nothing.
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { appendObservations } from '../observationStore';
import {
  USER_TITLE_FIELD_RETRACTION_ROLLBACK_REASON,
  reconcileUserFieldRetractions,
  userFieldRetractionContractFor,
} from '../fieldRetraction';
import {
  extractOfficialProfilePersonIdentity,
  identityToUserObservations,
} from '../sources/officialProfilePiBackfillScraper';
import type { ObservationInput } from '../types';

beforeEach(clearC4Flags);

const PI_SOURCE = 'official-profile-pi-backfill';
const RIVAL_SOURCE = 'ysm-faculty-directory';
const PI_PAGE = 'https://medicine.yale.edu/profile/rowan-quillfeather/';
const PI_KEY = 'netid:rq1';
const PAGE_HEADLINE = 'Fixture lab wins an award for its coastal sediment study';
const STALE_APPOINTMENT = 'Associate Professor of Fixture Studies';
const APPOINTMENT = 'Professor of Fixture Studies';
const TRAINEE_APPOINTMENT = 'Postdoctoral Fellow';

const piProfile = (name: string, titleBlock: string) => `
  <html>
    <head>
      <link rel="canonical" href="${PI_PAGE}" />
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"ProfilePage","@id":"${PI_PAGE}#page","url":"${PI_PAGE}"},
        {"@type":"Person","@id":"${PI_PAGE}","name":"${name}","url":"${PI_PAGE}","email":"rq1@yale.edu"}
      ]}</script>
    </head>
    <body>
      <main>
        <h1>${name}</h1>
        ${titleBlock}
        <div class="department">Fixture Studies</div>
        <a href="mailto:rq1@yale.edu">rq1@yale.edu</a>
      </main>
    </body>
  </html>
`;
const piEntity = {
  name: 'Quillfeather Fixture Lab',
  slug: 'quillfeather-fixture-lab',
  leadUsers: [{ fname: 'Rowan', lname: 'Quillfeather', netid: 'rq1' }],
};
const headlineOnly = `<p class="news">${PAGE_HEADLINE}</p>`;
const statedAppointment = `<div class="title">${APPOINTMENT}</div>`;

const piRead = (html: string): ObservationInput[] => {
  const identity = extractOfficialProfilePersonIdentity(html, PI_PAGE, piEntity, {
    requireEmail: false,
    expectedPeople: piEntity.leadUsers,
  });
  if (!identity) return [];
  return identityToUserObservations(identity, { netid: 'rq1' });
};

const assertedTitle = (value: string): ObservationInput => ({
  entityType: 'user',
  entityKey: PI_KEY,
  field: 'title',
  value,
  sourceUrl: PI_PAGE,
  confidenceOverride: 0.95,
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

const liveTitles = async (sourceName: string) =>
  (
    await Observation.find({
      sourceName,
      entityType: 'user',
      field: 'title',
      superseded: { $ne: true },
      'rollback.rolledBackAt': { $exists: false },
    }).lean<Array<{ entityKey: string; value: unknown }>>()
  ).map((row) => `${row.entityKey} ${String(row.value)}`);

describe('official-profile-pi-backfill retires a title its page no longer states (#6233)', () => {
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

  it('declares title retractable for this lane only', () => {
    expect(userFieldRetractionContractFor(PI_SOURCE)?.retractableFields).toContain('title');
    expect(userFieldRetractionContractFor('dept-faculty-roster')?.retractableFields).not.toContain(
      'title',
    );
  });

  it("claims title absent on every row of a read of the person's own page with no admissible title", () => {
    const rows = piRead(piProfile('Rowan Quillfeather', headlineOnly));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.field === 'title')).toBe(false);
    expect(rows.every((row) => row.assertsNoValueFor?.includes('title'))).toBe(true);
  });

  it('claims nothing on a read whose page still states an appointment', () => {
    const rows = piRead(piProfile('Rowan Quillfeather', statedAppointment));
    expect(rows.find((row) => row.field === 'title')?.value).toBe(APPOINTMENT);
    expect(rows.some((row) => row.assertsNoValueFor?.includes('title'))).toBe(false);
  });

  it("claims nothing on another person's page", () => {
    expect(piRead(piProfile('Morgan Elsewhere', headlineOnly))).toEqual([]);
  });

  it('retires the stale title after two attesting reads, leaves the rival lane alone, and a second pass is a no-op', async () => {
    await appendRun(PI_SOURCE, [assertedTitle(STALE_APPOINTMENT)]);
    await appendRun(RIVAL_SOURCE, [assertedTitle(APPOINTMENT)]);
    await appendRun(PI_SOURCE, piRead(piProfile('Rowan Quillfeather', headlineOnly)));
    const rederive = vi.fn().mockResolvedValue(undefined);

    const afterOne = await reconcileUserFieldRetractions({ sourceName: PI_SOURCE, rederive });
    expect(afterOne.counts.awaitingSecondCompleteRead).toBe(1);
    expect(await liveTitles(PI_SOURCE)).toEqual([`${PI_KEY} ${STALE_APPOINTMENT}`]);

    await appendRun(PI_SOURCE, piRead(piProfile('Rowan Quillfeather', headlineOnly)));
    const applied = await reconcileUserFieldRetractions({ sourceName: PI_SOURCE, rederive });
    expect(applied).toMatchObject({ outcome: 'reconciled', retiredObservations: 1 });
    expect(rederive).toHaveBeenCalledExactlyOnceWith({ entityKey: PI_KEY }, ['title']);
    expect(await liveTitles(PI_SOURCE)).toEqual([]);
    expect(await liveTitles(RIVAL_SOURCE)).toEqual([`${PI_KEY} ${APPOINTMENT}`]);
    const retired = await Observation.findOne({ sourceName: PI_SOURCE, field: 'title' }).lean<{
      rollback?: { reason?: string };
    }>();
    expect(retired?.rollback?.reason).toBe(USER_TITLE_FIELD_RETRACTION_ROLLBACK_REASON);

    const again = await reconcileUserFieldRetractions({ sourceName: PI_SOURCE, rederive });
    expect(again).toMatchObject({ retiredObservations: 0, retractions: [] });
    expect(rederive).toHaveBeenCalledTimes(1);
  });

  it('retires the stale lane title on a page stating only a trainee appointment, and keeps the rival lane trainee title', async () => {
    const traineePage = piProfile(
      'Rowan Quillfeather',
      `<div class="title">${TRAINEE_APPOINTMENT}</div>`,
    );
    const traineeRead = piRead(traineePage);
    expect(traineeRead.length).toBeGreaterThan(0);
    expect(traineeRead.some((row) => row.field === 'title')).toBe(false);
    expect(traineeRead.every((row) => row.assertsNoValueFor?.includes('title'))).toBe(true);

    await appendRun(PI_SOURCE, [assertedTitle(STALE_APPOINTMENT)]);
    await appendRun(RIVAL_SOURCE, [assertedTitle(TRAINEE_APPOINTMENT)]);
    const rederive = vi.fn().mockResolvedValue(undefined);
    await appendRun(PI_SOURCE, traineeRead);
    await reconcileUserFieldRetractions({ sourceName: PI_SOURCE, rederive });
    await appendRun(PI_SOURCE, piRead(traineePage));

    const applied = await reconcileUserFieldRetractions({ sourceName: PI_SOURCE, rederive });
    expect(applied).toMatchObject({ outcome: 'reconciled', retiredObservations: 1 });
    expect(await liveTitles(PI_SOURCE)).toEqual([]);
    expect(await liveTitles(RIVAL_SOURCE)).toEqual([`${PI_KEY} ${TRAINEE_APPOINTMENT}`]);
  });

  it('keeps a title the page still states', async () => {
    await appendRun(PI_SOURCE, piRead(piProfile('Rowan Quillfeather', statedAppointment)));
    await appendRun(PI_SOURCE, piRead(piProfile('Rowan Quillfeather', statedAppointment)));
    await appendRun(PI_SOURCE, piRead(piProfile('Rowan Quillfeather', statedAppointment)));

    const planned = await reconcileUserFieldRetractions({ sourceName: PI_SOURCE });
    expect(planned.retractions).toEqual([]);
    expect(await liveTitles(PI_SOURCE)).toEqual([`${PI_KEY} ${APPOINTMENT}`]);
    expect(
      await Observation.countDocuments({ sourceName: PI_SOURCE, assertsNoValueFor: 'title' }),
    ).toBe(0);
  });
});
