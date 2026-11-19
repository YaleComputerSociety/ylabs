import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { resetDirectoryNetidsByAddressCache } from '../directoryContradictedProfileNetid';
import {
  OfficialProfilePiBackfillScraper,
  resolveExistingUserForIdentity,
  type ExistingProfileUser,
} from '../sources/officialProfilePiBackfillScraper';
import type { ObservationInput } from '../types';

const PAGE = 'https://engineering.yale.edu/research-and-faculty/faculty-directory/avery-fixture/';
const PAGE_EMAIL = 'avery.fixture5701@yale.edu';
const OWNER_NETID = 'af5701a';
const OTHER_NETID = 'zz5701b';
const MEMBER_EMAIL = 'zzc5701@yale.edu';

const personJsonLd = (name: string, email: string) =>
  `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name,
    email,
  })}</script>`;

const titlelessPersonPage = `<html><head><title>Avery Fixture | Yale Engineering</title>
${personJsonLd('Avery Fixture', PAGE_EMAIL)}</head><body>
<main>
<h1>Avery Fixture</h1>
<p>Avery Fixture studies synthetic fixture materials and their mechanics.</p>
<a href="mailto:${PAGE_EMAIL}">${PAGE_EMAIL}</a>
</main>
</body></html>`;

const titledPersonPage = titlelessPersonPage.replace(
  '<h1>Avery Fixture</h1>',
  '<h1>Avery Fixture</h1><div class="profile-title">Professor of Fixture Engineering</div>',
);

const titlelessGroupPage = `<html><head><title>Avery Fixture Lab | Yale Engineering</title></head><body>
<main>
<article>
<h1>Avery Fixture Lab</h1>
<div class="contact-info"><a href="mailto:${MEMBER_EMAIL}">${MEMBER_EMAIL}</a></div>
</article>
</main>
</body></html>`;

const titlelessUnitPage = `<html><head><title>Fixture Engineering Department</title></head><body>
<main>
<h1>Department of Fixture Engineering</h1>
<p>Faculty: Avery Fixture, Casey Fixture.</p>
<a href="mailto:${MEMBER_EMAIL}">${MEMBER_EMAIL}</a>
</main>
</body></html>`;

const titlelessListingPage = `<html><head><title>People | Yale Engineering</title></head><body>
<main>
<h1>People</h1>
<ul>
<li><a href="/faculty-directory/avery-fixture">Avery Fixture</a> <a href="mailto:${PAGE_EMAIL}">${PAGE_EMAIL}</a></li>
<li><a href="/faculty-directory/casey-fixture">Casey Fixture</a> <a href="mailto:${MEMBER_EMAIL}">${MEMBER_EMAIL}</a></li>
</ul>
</main>
</body></html>`;

const entity = {
  _id: new mongoose.Types.ObjectId().toString(),
  name: 'Avery Fixture Lab',
  slug: 'faculty-research-area-avery-fixture',
  profileUrls: { official: PAGE },
  sourceUrls: [PAGE],
};

type UserResolver = (identity: any) => Promise<ExistingProfileUser | null>;

async function runLane(
  html: string,
  userResolver: UserResolver = resolveExistingUserForIdentity,
): Promise<ObservationInput[]> {
  const emitted: ObservationInput[] = [];
  const scraper = new OfficialProfilePiBackfillScraper(
    vi.fn(async () => html),
    vi.fn(async () => [entity]),
    vi.fn(userResolver),
    vi.fn(async () => []),
    vi.fn(async () => []),
  );
  await scraper.run({
    scrapeRunId: 'run-5701',
    sourceId: 'source-5701',
    sourceName: 'official-profile-pi-backfill',
    sourceWeight: 0.95,
    options: { dryRun: true, useCache: false, release: false },
    emit: async (obs: ObservationInput | ObservationInput[]) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  } as any);
  return emitted;
}

const userObservations = (emitted: ObservationInput[]) =>
  emitted
    .filter((o) => o.entityType === 'user')
    .map((o) => ({ entityKey: o.entityKey, field: o.field, value: o.value }))
    .sort((a, b) => `${a.entityKey}${a.field}`.localeCompare(`${b.entityKey}${b.field}`));

const leadAttributions = (emitted: ObservationInput[]) =>
  emitted.filter(
    (o) =>
      o.entityType === 'researchEntity' &&
      (o.field === 'inferredPiUserId' || o.field === 'inferredPiUserKey'),
  );

describe('the official profile lane files a titleless person page identity under its own key (#5701)', () => {
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
    resetDirectoryNetidsByAddressCache();
    await Researcher.deleteMany({});
    await Observation.deleteMany({});
  });

  const seedOwner = () =>
    Researcher.create({
      displayName: 'Avery Fixture',
      identifiers: { netid: OWNER_NETID, email: PAGE_EMAIL },
      status: 'ACTIVE',
      archived: false,
    });

  it("files a titleless page's own email under the owner's key and nothing else", async () => {
    await seedOwner();

    const emitted = await runLane(titlelessPersonPage);

    expect(userObservations(emitted)).toEqual([
      { entityKey: `netid:${OWNER_NETID}`, field: 'email', value: PAGE_EMAIL },
    ]);
    expect(leadAttributions(emitted)).toEqual([]);
  });

  it("files a titleless page's own email under the key its address names when no researcher holds it", async () => {
    const emitted = await runLane(titlelessPersonPage);

    expect(userObservations(emitted)).toEqual([
      { entityKey: 'netid:avery.fixture5701', field: 'email', value: PAGE_EMAIL },
    ]);
    expect(leadAttributions(emitted)).toEqual([]);
  });

  it('keeps the named identity and the lead attribution on a page that states a title', async () => {
    const owner = await seedOwner();

    const emitted = await runLane(titledPersonPage);

    expect(
      userObservations(emitted)
        .filter((o) => o.entityKey === `netid:${OWNER_NETID}`)
        .map((o) => o.field),
    ).toEqual(['email', 'fname', 'lname', 'netid']);
    expect(leadAttributions(emitted).map((o) => [o.field, o.value])).toEqual([
      ['inferredPiUserId', String(owner._id)],
    ]);
  });

  it('emits the same identity on a second run', async () => {
    await seedOwner();

    const first = userObservations(await runLane(titlelessPersonPage));
    const second = userObservations(await runLane(titlelessPersonPage));

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it.each([
    ['a group page named after its lead', titlelessGroupPage],
    ['a department page', titlelessUnitPage],
    ['a people listing', titlelessListingPage],
  ])('emits no identity from %s with no title', async (_shape, html) => {
    await seedOwner();

    const emitted = await runLane(html);

    expect(userObservations(emitted)).toEqual([]);
    expect(leadAttributions(emitted)).toEqual([]);
  });

  it('still refuses the key when another researcher with a different netid holds the page email', async () => {
    await Researcher.create({
      displayName: 'Avery Fixture',
      identifiers: { netid: OTHER_NETID, email: PAGE_EMAIL },
      status: 'ACTIVE',
      archived: false,
    });
    const keyPerson = async () => ({ netid: OWNER_NETID, email: 'avery.other5701@yale.edu' });

    const emitted = await runLane(titlelessPersonPage, keyPerson);

    expect(userObservations(emitted).filter((o) => o.entityKey === `netid:${OWNER_NETID}`)).toEqual(
      [],
    );
  });

  it('still refuses a page holder whose netid the directory pairs with another person', async () => {
    await Observation.create({
      entityType: 'user',
      entityKey: OTHER_NETID,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'yale-directory',
      sourceUrl: 'https://directory.example.test/',
      confidence: 0.95,
      observedAt: new Date('2026-06-05T00:00:00Z'),
      superseded: false,
      field: 'email',
      value: PAGE_EMAIL,
    });
    await Researcher.create({
      displayName: 'Avery Fixture',
      identifiers: { netid: OWNER_NETID },
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: PAGE,
          verifiedAt: new Date('2026-08-01T00:00:00Z'),
        },
      ],
      status: 'ACTIVE',
      archived: false,
    });

    const emitted = await runLane(titlelessPersonPage);

    expect(userObservations(emitted).filter((o) => o.entityKey === `netid:${OWNER_NETID}`)).toEqual(
      [],
    );
  });

  it('still refuses a page that names another netid than the holder of its address', async () => {
    const netidPage = 'https://medicine.yale.edu/profile/zzb5701/';
    await Researcher.create({
      displayName: 'Avery Fixture',
      identifiers: { netid: OWNER_NETID, email: PAGE_EMAIL },
      status: 'ACTIVE',
      archived: false,
    });
    const emitted: ObservationInput[] = [];
    const scraper = new OfficialProfilePiBackfillScraper(
      vi.fn(async () =>
        titlelessPersonPage.replace(
          '</head>',
          `<link rel="canonical" href="${netidPage}" /></head>`,
        ),
      ),
      vi.fn(async () => [
        { ...entity, profileUrls: { official: netidPage }, sourceUrls: [netidPage] },
      ]),
      vi.fn(resolveExistingUserForIdentity),
      vi.fn(async () => []),
      vi.fn(async () => []),
    );
    await scraper.run({
      scrapeRunId: 'run-5701-netid',
      sourceId: 'source-5701',
      sourceName: 'official-profile-pi-backfill',
      sourceWeight: 0.95,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (obs: ObservationInput | ObservationInput[]) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: () => {},
    } as any);

    expect(userObservations(emitted).filter((o) => o.entityKey === `netid:${OWNER_NETID}`)).toEqual(
      [],
    );
  });

  it('feeds no profile link from a titleless page, so the shared-page refusal is never bypassed', async () => {
    await seedOwner();

    const emitted = await runLane(titlelessPersonPage);

    expect(emitted.filter((o) => o.field === 'profileUrls' || o.field === 'title')).toEqual([]);
  });
});
