/**
 * #5711 end to end against a real store: once two later reads of the same page by the same
 * lane attest that the page states no address, that lane's email row for the person on that
 * page is retired and the person is re-derived; a second pass changes nothing, and a read
 * that merely omits the address, or a rival lane's row, is never touched.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as cheerio from 'cheerio';
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

import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { Source } from '../../models/source';
import { appendObservations } from '../observationStore';
import {
  USER_FIELD_RETRACTION_ROLLBACK_REASON,
  reconcileUserFieldRetractions,
} from '../fieldRetraction';
import { ScraperOrchestrator } from '../orchestrator';
import {
  extractOfficialProfileIdentity,
  identityToUserObservations,
} from '../sources/officialProfilePiBackfillScraper';
import {
  DepartmentRosterScraper,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';
import type { ObservationInput } from '../types';

beforeEach(clearC4Flags);

const PI_SOURCE = 'official-profile-pi-backfill';
const ROSTER_SOURCE = 'dept-faculty-roster';
const RIVAL_SOURCE = 'yale-directory-email';
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
      <footer class="site-footer"><a href="mailto:fixture.office@yale.edu">Office</a></footer>
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

const liveEmails = async (sourceName: string) =>
  (
    await Observation.find({
      sourceName,
      entityType: 'user',
      field: 'email',
      superseded: { $ne: true },
    }).lean<Array<{ entityKey: string; value: unknown }>>()
  ).map((row) => `${row.entityKey} ${String(row.value)}`);

describe('a dropped email retires by attested omission (#5711)', () => {
  let replSet: MongoMemoryReplSet;
  let server: http.Server;
  let localOrigin = '';
  const rosterProfile = { contact: '' };

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    server = http.createServer((req, res) => {
      const path = (req.url || '/').split('?')[0];
      const body =
        path === '/people/faculty'
          ? `<html><body><main><ul><li><a class="person" href="/people/sable-inkwright">Sable Inkwright</a><span class="title">Professor of Economics</span></li></ul></main></body></html>`
          : path === '/people/sable-inkwright'
            ? `<!doctype html><html><head><title>Sable Inkwright | Economics</title><meta property="og:title" content="Sable Inkwright" /></head>
<body><main><article><h1 class="node__title">Sable Inkwright</h1>
<dl class="node__contact-info"><dt>Email</dt><dd>${rosterProfile.contact}</dd></dl></article></main>
<footer class="site-footer"><a href="mailto:econ.office@yale.edu">econ.office@yale.edu</a></footer></body></html>`
            : '';
      res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    localOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  beforeEach(async () => {
    rosterProfile.contact = '';
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'sources', 'scrape_runs']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('official-profile-pi-backfill: retires the address after two attesting reads, and a second pass is a no-op', async () => {
    await appendRun(PI_SOURCE, piRead(`<a href="mailto:${ADDRESS}">Email</a>`));
    await appendRun(RIVAL_SOURCE, [
      { entityType: 'user', entityKey: PI_KEY, field: 'email', value: ADDRESS },
    ]);
    await appendRun(PI_SOURCE, piRead(''));
    const rederive = vi.fn().mockResolvedValue(undefined);

    const afterOne = await reconcileUserFieldRetractions({ sourceName: PI_SOURCE, rederive });
    expect(afterOne.counts.awaitingSecondCompleteRead).toBe(1);
    expect(await liveEmails(PI_SOURCE)).toEqual([`${PI_KEY} ${ADDRESS}`]);

    await appendRun(PI_SOURCE, piRead(''));
    const applied = await reconcileUserFieldRetractions({ sourceName: PI_SOURCE, rederive });
    expect(applied).toMatchObject({ outcome: 'reconciled', retiredObservations: 1 });
    expect(rederive).toHaveBeenCalledExactlyOnceWith({ entityKey: PI_KEY });
    expect(await liveEmails(PI_SOURCE)).toEqual([]);
    expect(await liveEmails(RIVAL_SOURCE)).toEqual([`${PI_KEY} ${ADDRESS}`]);
    const retired = await Observation.findOne({ sourceName: PI_SOURCE, field: 'email' }).lean<{
      rollback?: { reason?: string };
    }>();
    expect(retired?.rollback?.reason).toBe(USER_FIELD_RETRACTION_ROLLBACK_REASON);

    const again = await reconcileUserFieldRetractions({ sourceName: PI_SOURCE, rederive });
    expect(again).toMatchObject({ outcome: 'no-candidates', retiredObservations: 0 });
    expect(rederive).toHaveBeenCalledTimes(1);
  });

  it('official-profile-pi-backfill: keeps the address when later reads only omit it', async () => {
    await appendRun(PI_SOURCE, piRead(`<a href="mailto:${ADDRESS}">Email</a>`));
    const refusedOnly = '<p>Appointments: fixture.scheduling@yale.edu</p>';
    await appendRun(PI_SOURCE, piRead(refusedOnly));
    await appendRun(PI_SOURCE, piRead(refusedOnly));

    const planned = await reconcileUserFieldRetractions({ sourceName: PI_SOURCE });
    expect(planned.retractions).toEqual([]);
    expect(planned.counts.absenceNotWitnessed).toBe(1);
    expect(await liveEmails(PI_SOURCE)).toEqual([`${PI_KEY} ${ADDRESS}`]);
  });

  const economics: DeptConfig = {
    deptKey: 'economics',
    deptName: 'Economics',
    schoolName: 'Yale Faculty of Arts and Sciences',
    url: 'https://economics.yale.edu/people/faculty',
    paginated: false,
    extractor: (html: string): FacultyEntry[] => {
      const $ = cheerio.load(html);
      return $('li')
        .toArray()
        .map((item) => ({
          name: $(item).find('a.person').text().trim(),
          profileUrl: `https://economics.yale.edu${$(item).find('a.person').attr('href')}`,
          title: $(item).find('.title').text().trim() || undefined,
        }));
    },
  };

  const scrapeRoster = async () => {
    await Source.updateOne(
      { name: ROSTER_SOURCE },
      { $setOnInsert: { name: ROSTER_SOURCE, displayName: 'Rosters', defaultWeight: 0.7 } },
      { upsert: true },
    );
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register(
      new DepartmentRosterScraper(
        [economics],
        null,
        async (url: string) => {
          const response = await fetch(url.replace('https://economics.yale.edu', localOrigin));
          return response.ok ? response.text() : '';
        },
        async () => new Map(),
      ),
    );
    await orchestrator.run(ROSTER_SOURCE, {
      dryRun: false,
      useCache: false,
      release: false,
      ignoreWorkPlanner: true,
    });
  };

  it('dept-faculty-roster: attests on the profile page its email rows use, and two claims retire the address the person was keyed by', async () => {
    rosterProfile.contact =
      '<a href="mailto:sable.inkwright@yale.edu">sable.inkwright@yale.edu</a>';
    await scrapeRoster();
    expect(await liveEmails(ROSTER_SOURCE)).toEqual([
      'netid:sable.inkwright sable.inkwright@yale.edu',
    ]);
    const emailRow = await Observation.findOne({ sourceName: ROSTER_SOURCE, field: 'email' }).lean<{
      sourceUrl: string;
    }>();

    rosterProfile.contact = '';
    await scrapeRoster();
    await scrapeRoster();
    const claims = await Observation.find({
      sourceName: ROSTER_SOURCE,
      entityType: 'user',
      assertsNoValueFor: 'email',
    }).lean<Array<{ field: string; sourceUrl: string }>>();
    expect(claims.length).toBe(2);
    expect(new Set(claims.map((claim) => `${claim.field} ${claim.sourceUrl}`))).toEqual(
      new Set([`profileUrls ${emailRow?.sourceUrl}`]),
    );

    const reconciled = await reconcileUserFieldRetractions({ sourceName: ROSTER_SOURCE });
    expect(reconciled.retiredObservations).toBe(1);
    expect(await liveEmails(ROSTER_SOURCE)).toEqual([]);
  });

  it('dept-faculty-roster: claims nothing while the profile still shows any address', async () => {
    rosterProfile.contact = 'Lab manager: econ.labmanager@yale.edu';
    await scrapeRoster();
    await scrapeRoster();
    expect(
      await Observation.countDocuments({ sourceName: ROSTER_SOURCE, assertsNoValueFor: 'email' }),
    ).toBe(0);
  });
});
