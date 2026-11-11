import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntities: vi.fn(async () => {}),
    syncEntity: vi.fn(async () => true),
    deleteFromIndex: vi.fn(async () => {}),
  };
});

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { materializeEntity, userTitleEvidence } from '../entityMaterializer';
import {
  extractProfile as extractYseProfile,
  facultyToUserObservations as yseUserObservations,
} from '../sources/yseFacultyDirectoryScraper';
import { planFieldValueRefusal } from '../../utils/researchEntityFieldValueRefusals';
import { clearC4Flags } from './c4FlagTestEnv';

const NETID = 'qs5578';
const DIRECTORY_KEY = NETID;
const NETID_KEY = `netid:${NETID}`;
const SCHOOL_KEY = 'ysm:quinn-synthetic';
const OFFICIAL_PAGE = 'https://medicine.yale.edu/profile/quinn-synthetic/';
const SCHOOL_PAGE_AS_CITED = 'http://www.medicine.yale.edu/profile/quinn-synthetic';
const YSE_PAGE = 'https://environment.yale.edu/profile/quinn-synthetic';
const ROSTER_LISTING = 'https://fixture-dept.yale.edu/people/faculty';
const NOW = new Date('2026-11-10T00:00:00Z');

const FIRST_HAND_RANK = 'Associate Professor of Fixture Medicine';
const OLDER_FIRST_HAND_RANK = 'Assistant Professor of Fixture Medicine';
const COPIED_RANK = 'Professor of Fixture Medicine';

interface Read {
  entityKey: string;
  sourceName: string;
  confidence: number;
  observedAt: string;
  sourceUrl: string;
  title: string;
}

const observation = (read: Read, field: string, value: unknown) => ({
  entityType: 'user',
  entityKey: read.entityKey,
  sourceId: new mongoose.Types.ObjectId(),
  scrapeRunId: new mongoose.Types.ObjectId(),
  field,
  value,
  sourceName: read.sourceName,
  sourceUrl: read.sourceUrl,
  confidence: read.confidence,
  observedAt: new Date(read.observedAt),
  superseded: false,
});

async function seed(reads: Read[]): Promise<void> {
  await Observation.insertMany(
    reads.flatMap((read) => [
      observation(read, 'fname', 'Quinn'),
      observation(read, 'lname', 'Synthetic'),
      observation(read, 'title', read.title),
    ]),
  );
}

async function storedTitle(): Promise<string | undefined> {
  const researcher: any = await Researcher.findOne({ 'identifiers.netid': NETID }).lean();
  return researcher?.profile?.title;
}

async function materializeInOrder(keys: string[]): Promise<string | undefined> {
  await Researcher.updateOne({ 'identifiers.netid': NETID }, { $unset: { 'profile.title': 1 } });
  for (const entityKey of keys) await materializeEntity('user', { entityKey }, { now: NOW });
  return storedTitle();
}

async function expectFromEveryKeyInEveryOrder(keys: string[], title: string): Promise<void> {
  expect(await materializeInOrder(keys)).toBe(title);
  expect(await materializeInOrder([...keys].reverse())).toBe(title);
  for (const key of keys) expect(await materializeInOrder([key])).toBe(title);
}

const directoryRead = (title: string): Read => ({
  entityKey: DIRECTORY_KEY,
  sourceName: 'yale-directory',
  confidence: 0.9,
  observedAt: '2026-11-03T00:00:00Z',
  sourceUrl: 'https://directory.yale.edu/',
  title,
});

const backfillRead = (title: string): Read => ({
  entityKey: NETID_KEY,
  sourceName: 'official-profile-pi-backfill',
  confidence: 0.95,
  observedAt: '2026-06-05T00:00:00Z',
  sourceUrl: OFFICIAL_PAGE,
  title,
});

const rosterRead = (title: string, sourceUrl: string): Read => ({
  entityKey: NETID_KEY,
  sourceName: 'dept-faculty-roster',
  confidence: 0.7,
  observedAt: '2026-11-09T00:00:00Z',
  sourceUrl,
  title,
});

const schoolRead = (title: string, observedAt: string): Read => ({
  entityKey: SCHOOL_KEY,
  sourceName: 'ysm-faculty-directory',
  confidence: 0.8,
  observedAt,
  sourceUrl: SCHOOL_PAGE_AS_CITED,
  title,
});

const officialLink = (url: string) => ({
  kind: 'YALE_OFFICIAL',
  purpose: 'PRIMARY_IDENTITY',
  url,
  verifiedAt: new Date('2026-09-01T00:00:00Z'),
  healthStatus: 'UNKNOWN',
});

describe("a researcher's own profile page decides the title (#5578)", () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    const db = mongoose.connection.db!;
    for (const name of ['accounts', 'researchers', 'observations']) {
      await db.collection(name).deleteMany({});
    }
    await Researcher.create({
      displayName: 'Quinn Synthetic',
      identifiers: { netid: NETID },
      profileLinks: [officialLink(OFFICIAL_PAGE)],
    });
  });

  it('serves the newest first-hand read over a newer roster title, an agreeing directory and a stale lane', async () => {
    await seed([
      schoolRead(FIRST_HAND_RANK, '2026-10-01T00:00:00Z'),
      rosterRead(COPIED_RANK, ROSTER_LISTING),
      directoryRead(COPIED_RANK),
      backfillRead(COPIED_RANK),
    ]);

    await expectFromEveryKeyInEveryOrder([DIRECTORY_KEY, NETID_KEY, SCHOOL_KEY], FIRST_HAND_RANK);
  });

  it('serves the leading title of a page that also lists an additional title', async () => {
    await Researcher.updateOne(
      { 'identifiers.netid': NETID },
      { $set: { profileLinks: [officialLink(YSE_PAGE)] } },
    );
    const profile = extractYseProfile(
      `<html><body><main><section class="profile">
        <h1>Quinn Synthetic</h1>
        <div class="intro-text profile__position"><p>
          <span class="semijoin">${FIRST_HAND_RANK}</span>
          <span class="semijoin">Director, Fixture Center for Water</span>
        </p></div>
        <p><a href="mailto:${NETID}@yale.edu">${NETID}@yale.edu</a></p>
      </section></main></body></html>`,
      { name: 'Quinn Synthetic', profileUrl: YSE_PAGE, slug: 'quinn-synthetic' },
    );
    const { observations, entityKey } = yseUserObservations(profile);
    await Observation.insertMany(
      observations.map((input) => ({
        ...input,
        sourceId: new mongoose.Types.ObjectId(),
        scrapeRunId: new mongoose.Types.ObjectId(),
        sourceName: 'yse-faculty-directory',
        confidence: 0.8,
        observedAt: new Date('2026-10-01T00:00:00Z'),
        superseded: false,
      })),
    );
    await seed([rosterRead(COPIED_RANK, ROSTER_LISTING)]);

    await expectFromEveryKeyInEveryOrder([entityKey, NETID_KEY], FIRST_HAND_RANK);
  });

  it('does not count a roster title as first-hand because it cites the profile page', async () => {
    await seed([
      schoolRead(FIRST_HAND_RANK, '2026-10-01T00:00:00Z'),
      rosterRead(COPIED_RANK, OFFICIAL_PAGE),
    ]);

    await expectFromEveryKeyInEveryOrder([NETID_KEY, SCHOOL_KEY], FIRST_HAND_RANK);
  });

  it('falls back to the older first-hand read, not to a copying lane, when the newest is refused', async () => {
    await seed([
      schoolRead(OLDER_FIRST_HAND_RANK, '2026-08-01T00:00:00Z'),
      schoolRead('Professor of', '2026-10-01T00:00:00Z'),
      rosterRead(COPIED_RANK, ROSTER_LISTING),
      backfillRead(COPIED_RANK),
    ]);

    await expectFromEveryKeyInEveryOrder([NETID_KEY, SCHOOL_KEY], OLDER_FIRST_HAND_RANK);
  });

  it('passes over a first-hand title the researcher refuses, from every key', async () => {
    await seed([
      schoolRead(FIRST_HAND_RANK, '2026-10-01T00:00:00Z'),
      rosterRead(COPIED_RANK, ROSTER_LISTING),
    ]);
    await Researcher.updateOne(
      { 'identifiers.netid': NETID },
      {
        $set: planFieldValueRefusal(undefined, {
          field: 'title',
          value: FIRST_HAND_RANK,
          rule: 'other_persons_page',
          refusedBy: 'synthetic fixture',
        }),
      },
    );

    await expectFromEveryKeyInEveryOrder([NETID_KEY, SCHOOL_KEY], COPIED_RANK);
    const secondPass = [];
    for (const entityKey of [NETID_KEY, SCHOOL_KEY]) {
      secondPass.push(await materializeEntity('user', { entityKey }, { now: NOW }));
    }
    expect(secondPass.map((result) => result.fieldsWritten)).toEqual([0, 0]);
  });

  it("keeps an operator's edit ahead of the first-hand read", async () => {
    await seed([
      schoolRead(FIRST_HAND_RANK, '2026-10-01T00:00:00Z'),
      {
        entityKey: NETID_KEY,
        sourceName: 'manual-admin-edit',
        confidence: 1,
        observedAt: '2026-07-01T00:00:00Z',
        sourceUrl: 'https://ylabs.example.invalid/admin',
        title: COPIED_RANK,
      },
    ]);

    await expectFromEveryKeyInEveryOrder([NETID_KEY, SCHOOL_KEY], COPIED_RANK);
  });

  it('keeps the newest-read fallback when no first-hand read exists', async () => {
    await seed([
      rosterRead(FIRST_HAND_RANK, ROSTER_LISTING),
      directoryRead(COPIED_RANK),
      backfillRead(OLDER_FIRST_HAND_RANK),
    ]);

    expect(await materializeInOrder([DIRECTORY_KEY, NETID_KEY])).toBe(FIRST_HAND_RANK);
    expect(await materializeInOrder([NETID_KEY, DIRECTORY_KEY])).toBe(FIRST_HAND_RANK);
  });

  it('writes nothing on a second pass', async () => {
    await seed([
      schoolRead(FIRST_HAND_RANK, '2026-10-01T00:00:00Z'),
      rosterRead(COPIED_RANK, ROSTER_LISTING),
      directoryRead(COPIED_RANK),
      backfillRead(COPIED_RANK),
    ]);
    const keys = [DIRECTORY_KEY, NETID_KEY, SCHOOL_KEY];
    await materializeInOrder(keys);
    const secondPass = [];
    for (const entityKey of keys) {
      secondPass.push(await materializeEntity('user', { entityKey }, { now: NOW }));
    }

    expect(secondPass.map((result) => result.fieldsWritten)).toEqual([0, 0, 0]);
    expect(await storedTitle()).toBe(FIRST_HAND_RANK);
  });
});

describe('an official page two live researchers claim (#5578)', () => {
  let replSet: MongoMemoryReplSet;
  const OTHER_NETID = 'rf5578';
  const OTHER_RANK = 'Research Associate in Fixture Surgery';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    const db = mongoose.connection.db!;
    for (const name of ['accounts', 'researchers', 'observations']) {
      await db.collection(name).deleteMany({});
    }
    await Researcher.create({
      displayName: 'Quinn Synthetic',
      identifiers: { netid: NETID },
      profileLinks: [officialLink(OFFICIAL_PAGE)],
    });
    await Researcher.create({
      displayName: 'Robin Fixture',
      identifiers: { netid: OTHER_NETID },
      profileLinks: [officialLink(OFFICIAL_PAGE)],
    });
    const read = (
      entityKey: string,
      sourceName: string,
      sourceUrl: string,
      value: string,
      observedAt: string,
      names: [string, string],
    ) =>
      [
        ['fname', names[0]],
        ['lname', names[1]],
        ['title', value],
      ].map(([field, fieldValue]) => ({
        entityType: 'user',
        entityKey,
        sourceId: new mongoose.Types.ObjectId(),
        scrapeRunId: new mongoose.Types.ObjectId(),
        field,
        value: fieldValue,
        sourceName,
        sourceUrl,
        confidence: 0.8,
        observedAt: new Date(observedAt),
        superseded: false,
      }));
    const quinn: [string, string] = ['Quinn', 'Synthetic'];
    const robin: [string, string] = ['Robin', 'Fixture'];
    const robinKey = `netid:${OTHER_NETID}`;
    await Observation.insertMany([
      ...read(
        NETID_KEY,
        'ysm-faculty-directory',
        OFFICIAL_PAGE,
        FIRST_HAND_RANK,
        '2026-08-01T00:00:00Z',
        quinn,
      ),
      ...read(
        NETID_KEY,
        'dept-faculty-roster',
        ROSTER_LISTING,
        COPIED_RANK,
        '2026-11-09T00:00:00Z',
        quinn,
      ),
      ...read(
        NETID_KEY,
        'official-profile-pi-backfill',
        OFFICIAL_PAGE,
        COPIED_RANK,
        '2026-10-01T00:00:00Z',
        quinn,
      ),
      ...read(
        robinKey,
        'ysm-faculty-directory',
        OFFICIAL_PAGE,
        FIRST_HAND_RANK,
        '2026-08-01T00:00:00Z',
        robin,
      ),
      ...read(
        robinKey,
        'dept-faculty-roster',
        ROSTER_LISTING,
        OTHER_RANK,
        '2026-11-09T00:00:00Z',
        robin,
      ),
      ...read(
        robinKey,
        'official-profile-pi-backfill',
        OFFICIAL_PAGE,
        OTHER_RANK,
        '2026-10-01T00:00:00Z',
        robin,
      ),
    ]);
  });

  const titleOf = async (netid: string) =>
    ((await Researcher.findOne({ 'identifiers.netid': netid }).lean()) as any)?.profile?.title;

  async function materializeAll(keys: string[]): Promise<void> {
    await Researcher.updateMany({}, { $unset: { 'profile.title': 1 } });
    for (const entityKey of keys) await materializeEntity('user', { entityKey }, { now: NOW });
  }

  it("gives the page's reads no authority, so each researcher's fallback serves, from either side", async () => {
    const keys = [NETID_KEY, `netid:${OTHER_NETID}`];
    for (const order of [keys, [...keys].reverse()]) {
      await materializeAll(order);
      expect(await titleOf(NETID)).toBe(COPIED_RANK);
      expect(await titleOf(OTHER_NETID)).toBe(OTHER_RANK);
    }
  });

  it('lets the first-hand read win again once the page has a sole live claimant', async () => {
    await Researcher.updateOne({ 'identifiers.netid': OTHER_NETID }, { $set: { archived: true } });

    await materializeAll([NETID_KEY]);

    expect(await titleOf(NETID)).toBe(FIRST_HAND_RANK);
  });
});

describe('the first-hand title screen (#5578)', () => {
  const pages = new Set(['medicine.yale.edu/profile/quinn-synthetic']);
  const title = (sourceName: string, value: string, observedAt: string, _id: string) => ({
    _id,
    field: 'title',
    sourceName,
    value,
    sourceUrl: OFFICIAL_PAGE,
    observedAt: new Date(observedAt),
  });

  it('chooses one value of a read that states two, by the earliest id', () => {
    const kept = userTitleEvidence(
      [
        title('ysm-faculty-directory', 'Second Seen Title', '2026-10-01T00:00:00Z', 'b'),
        title('ysm-faculty-directory', 'First Seen Title', '2026-10-01T00:00:00Z', 'a'),
      ],
      pages,
    );

    expect(kept.map((observation) => observation.value)).toEqual(['First Seen Title']);
  });

  it("ignores a first-hand lane's read of a page that is not the researcher's", () => {
    const elsewhere = {
      ...title('ysm-faculty-directory', FIRST_HAND_RANK, '2026-10-01T00:00:00Z', 'a'),
      sourceUrl: 'https://medicine.yale.edu/profile/someone-else/',
    };
    const roster = title('dept-faculty-roster', COPIED_RANK, '2026-09-01T00:00:00Z', 'b');

    expect(userTitleEvidence([elsewhere, roster], pages)).toEqual([elsewhere, roster]);
  });
});
