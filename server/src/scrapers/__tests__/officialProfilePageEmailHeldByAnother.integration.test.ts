import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Researcher } from '../../models/researcher';
import {
  OfficialProfilePiBackfillScraper,
  pageEmailHeldByAnotherResearcher,
} from '../sources/officialProfilePiBackfillScraper';
import type { ObservationInput } from '../types';

const PAGE = 'https://medicine.yale.edu/profile/blair-synthetic/';
const PAGE_EMAIL = 'blair.synthetic@yale.edu';
const KEY_NETID = 'avs11';

const pageHtml = `<html><head><title>Blair Synthetic | Yale School of Medicine</title></head><body>
<h1>Blair Synthetic, PhD</h1>
<div class="profile-title">Professor of Fixture Pathology</div>
<a href="mailto:${PAGE_EMAIL}">${PAGE_EMAIL}</a>
</body></html>`;

const entity = {
  _id: new mongoose.Types.ObjectId().toString(),
  name: 'Blair Synthetic Lab',
  slug: 'ysm-faculty-blair-synthetic',
  profileUrls: { official: PAGE },
  sourceUrls: [PAGE],
};

async function runLane(): Promise<ObservationInput[]> {
  const emitted: ObservationInput[] = [];
  const scraper = new OfficialProfilePiBackfillScraper(
    vi.fn(async () => pageHtml),
    vi.fn(async () => [entity]),
    vi.fn(async () => ({ netid: KEY_NETID, email: 'avery.synthetic@yale.edu' })),
    vi.fn(async () => []),
    vi.fn(async () => []),
  );
  await scraper.run({
    scrapeRunId: 'run-5606',
    sourceId: 'source-5606',
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

const userObservationsUnderKey = (emitted: ObservationInput[]) =>
  emitted.filter((o) => o.entityType === 'user' && o.entityKey === `netid:${KEY_NETID}`);

describe('the official profile lane never files a page under a key whose person does not own its email (#5606)', () => {
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
    await Researcher.deleteMany({});
  });

  it('emits no identity under the key when a researcher with another netid holds the page email, on either run', async () => {
    await Researcher.create({
      displayName: 'Blair Synthetic',
      identifiers: { netid: 'bls22', email: PAGE_EMAIL },
    });

    expect(userObservationsUnderKey(await runLane())).toEqual([]);
    expect(userObservationsUnderKey(await runLane())).toEqual([]);
  });

  it('still files the page under the key when no other researcher holds its email', async () => {
    const emitted = userObservationsUnderKey(await runLane());
    expect(emitted.map((o) => o.field)).toContain('email');
  });
});

describe('pageEmailHeldByAnotherResearcher (#5606)', () => {
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
    await Researcher.deleteMany({});
  });

  it('is true for a holder with a different netid', async () => {
    await Researcher.create({
      displayName: 'Blair Synthetic',
      identifiers: { netid: 'bls22', email: PAGE_EMAIL },
    });
    expect(
      await pageEmailHeldByAnotherResearcher(PAGE_EMAIL.toUpperCase(), { netid: KEY_NETID }),
    ).toBe(true);
  });

  it('is false for a holder with no netid, a possible second record of the same person', async () => {
    await Researcher.create({ displayName: 'Blair Synthetic', identifiers: { email: PAGE_EMAIL } });
    expect(await pageEmailHeldByAnotherResearcher(PAGE_EMAIL, { netid: KEY_NETID })).toBe(false);
  });

  it('is false for the key person', async () => {
    const keyPerson = await Researcher.create({
      displayName: 'Avery Synthetic',
      identifiers: { netid: KEY_NETID, email: PAGE_EMAIL },
    });
    expect(
      await pageEmailHeldByAnotherResearcher(PAGE_EMAIL, {
        _id: String(keyPerson._id),
        netid: KEY_NETID,
      }),
    ).toBe(false);
  });
});
