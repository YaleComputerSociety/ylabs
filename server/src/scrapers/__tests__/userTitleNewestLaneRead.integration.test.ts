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
import { clearC4Flags } from './c4FlagTestEnv';

const NETID = 'qs5578';
const DIRECTORY_KEY = NETID;
const BACKFILL_KEY = `netid:${NETID}`;
const SCHOOL_KEY = 'ysm:quinn-synthetic';
const OFFICIAL_PAGE = 'https://medicine.yale.edu/profile/quinn-synthetic/';
const NOW = new Date('2026-11-10T00:00:00Z');
const OLD_RANK = 'Assistant Professor of Medicine';
const NEW_RANK = 'Associate Professor of Medicine';

const runs = {
  backfillJune: new mongoose.Types.ObjectId(),
  schoolAugust: new mongoose.Types.ObjectId(),
  rosterSeptember: new mongoose.Types.ObjectId(),
  schoolOctober: new mongoose.Types.ObjectId(),
  rosterOctober: new mongoose.Types.ObjectId(),
  directoryNovember: new mongoose.Types.ObjectId(),
  rosterNovember: new mongoose.Types.ObjectId(),
};

interface Read {
  entityKey: string;
  sourceName: string;
  confidence: number;
  observedAt: string;
  scrapeRunId: mongoose.Types.ObjectId;
  sourceUrl?: string;
  title?: string;
}

const observation = (read: Read, field: string, value: unknown) => ({
  entityType: 'user',
  entityKey: read.entityKey,
  sourceId: new mongoose.Types.ObjectId(),
  scrapeRunId: read.scrapeRunId,
  field,
  value,
  sourceName: read.sourceName,
  sourceUrl: read.sourceUrl ?? OFFICIAL_PAGE,
  confidence: read.confidence,
  observedAt: new Date(read.observedAt),
  superseded: false,
});

async function seed(reads: Read[]): Promise<void> {
  await Observation.insertMany(
    reads.flatMap((read) => [
      observation(read, 'fname', 'Quinn'),
      observation(read, 'lname', 'Synthetic'),
      ...(read.title ? [observation(read, 'title', read.title)] : []),
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

describe("a lane's titles are read as of its newest read (#5578)", () => {
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
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: OFFICIAL_PAGE,
          verifiedAt: new Date('2026-09-01T00:00:00Z'),
          healthStatus: 'UNKNOWN',
        },
      ],
    });
  });

  it('serves a re-read rank over the same lane value it replaced', async () => {
    const roster = { entityKey: BACKFILL_KEY, sourceName: 'dept-faculty-roster', confidence: 0.7 };
    await seed([
      {
        ...roster,
        observedAt: '2026-09-13T00:00:00Z',
        scrapeRunId: runs.rosterSeptember,
        sourceUrl: 'https://fixture-dept.yale.edu/people/a',
        title: OLD_RANK,
      },
      {
        ...roster,
        observedAt: '2026-09-13T00:00:00Z',
        scrapeRunId: runs.rosterSeptember,
        sourceUrl: 'https://fixture-dept.yale.edu/people/b',
        title: OLD_RANK,
      },
      {
        ...roster,
        observedAt: '2026-10-23T00:00:00Z',
        scrapeRunId: runs.rosterOctober,
        sourceUrl: 'https://fixture-dept.yale.edu/people/a',
        title: NEW_RANK,
      },
    ]);

    expect(await materializeInOrder([BACKFILL_KEY])).toBe(NEW_RANK);
  });

  it("drops a directory title that agrees with a lane's older read", async () => {
    const trainee = 'Postdoctoral Associate';
    const scientist = 'Associate Research Scientist in Fixture Radiology';
    await seed([
      {
        entityKey: BACKFILL_KEY,
        sourceName: 'ysm-atoz-index',
        confidence: 0.8,
        observedAt: '2026-08-29T00:00:00Z',
        scrapeRunId: runs.schoolAugust,
        title: trainee,
      },
      {
        entityKey: BACKFILL_KEY,
        sourceName: 'dept-faculty-roster',
        confidence: 0.7,
        observedAt: '2026-11-09T00:00:00Z',
        scrapeRunId: runs.rosterNovember,
        title: scientist,
      },
      {
        entityKey: DIRECTORY_KEY,
        sourceName: 'yale-directory',
        confidence: 0.9,
        observedAt: '2026-11-03T00:00:00Z',
        scrapeRunId: runs.directoryNovember,
        sourceUrl: 'https://directory.yale.edu/',
        title: trainee,
      },
    ]);

    expect(await materializeInOrder([BACKFILL_KEY, DIRECTORY_KEY])).toBe(scientist);
    expect(await materializeInOrder([DIRECTORY_KEY, BACKFILL_KEY])).toBe(scientist);
  });

  it('counts a lane that read the person under two keys once, as of its newest read', async () => {
    await seed([
      {
        entityKey: SCHOOL_KEY,
        sourceName: 'dept-faculty-roster',
        confidence: 0.7,
        observedAt: '2026-09-13T00:00:00Z',
        scrapeRunId: runs.rosterSeptember,
        title: OLD_RANK,
      },
      {
        entityKey: BACKFILL_KEY,
        sourceName: 'dept-faculty-roster',
        confidence: 0.7,
        observedAt: '2026-11-09T00:00:00Z',
        scrapeRunId: runs.rosterNovember,
        title: NEW_RANK,
      },
      {
        entityKey: BACKFILL_KEY,
        sourceName: 'ysm-atoz-index',
        confidence: 0.8,
        observedAt: '2026-08-29T00:00:00Z',
        scrapeRunId: runs.schoolAugust,
        title: OLD_RANK,
      },
    ]);

    expect(await materializeInOrder([SCHOOL_KEY, BACKFILL_KEY])).toBe(NEW_RANK);
    expect(await materializeInOrder([BACKFILL_KEY, SCHOOL_KEY])).toBe(NEW_RANK);
  });

  describe("a sibling key's old value and two lanes' stale values", () => {
    beforeEach(async () => {
      await seed([
        {
          entityKey: BACKFILL_KEY,
          sourceName: 'official-profile-pi-backfill',
          confidence: 0.95,
          observedAt: '2026-06-05T00:00:00Z',
          scrapeRunId: runs.backfillJune,
          title: OLD_RANK,
        },
        {
          entityKey: DIRECTORY_KEY,
          sourceName: 'yale-directory',
          confidence: 0.9,
          observedAt: '2026-11-03T00:00:00Z',
          scrapeRunId: runs.directoryNovember,
          sourceUrl: 'https://directory.yale.edu/',
          title: OLD_RANK,
        },
        {
          entityKey: SCHOOL_KEY,
          sourceName: 'ysm-faculty-directory',
          confidence: 0.8,
          observedAt: '2026-08-29T00:00:00Z',
          scrapeRunId: runs.schoolAugust,
          title: OLD_RANK,
        },
        {
          entityKey: SCHOOL_KEY,
          sourceName: 'dept-faculty-roster',
          confidence: 0.7,
          observedAt: '2026-09-13T00:00:00Z',
          scrapeRunId: runs.rosterSeptember,
          title: OLD_RANK,
        },
        {
          entityKey: SCHOOL_KEY,
          sourceName: 'ysm-faculty-directory',
          confidence: 0.8,
          observedAt: '2026-10-23T00:00:00Z',
          scrapeRunId: runs.schoolOctober,
          title: NEW_RANK,
        },
        {
          entityKey: SCHOOL_KEY,
          sourceName: 'dept-faculty-roster',
          confidence: 0.7,
          observedAt: '2026-10-23T00:00:00Z',
          scrapeRunId: runs.rosterOctober,
          title: NEW_RANK,
        },
      ]);
    });

    it("no longer outvote those lanes' newer reads, from any key and in any order", async () => {
      const keys = [DIRECTORY_KEY, BACKFILL_KEY, SCHOOL_KEY];
      expect(await materializeInOrder(keys)).toBe(NEW_RANK);
      expect(await materializeInOrder([...keys].reverse())).toBe(NEW_RANK);
      expect(await materializeInOrder([SCHOOL_KEY])).toBe(NEW_RANK);
    });

    it('write nothing on a second pass', async () => {
      const keys = [DIRECTORY_KEY, BACKFILL_KEY, SCHOOL_KEY];
      await materializeInOrder(keys);
      const secondPass = [];
      for (const entityKey of keys) {
        secondPass.push(await materializeEntity('user', { entityKey }, { now: NOW }));
      }

      expect(secondPass.map((result) => result.fieldsWritten)).toEqual([0, 0, 0]);
      expect(await storedTitle()).toBe(NEW_RANK);
    });
  });
});

describe('the title evidence screen (#5578)', () => {
  const title = (sourceName: string, value: string, observedAt: string, scrapeRunId?: string) => ({
    field: 'title',
    sourceName,
    value,
    observedAt: new Date(observedAt),
    ...(scrapeRunId ? { scrapeRunId } : {}),
  });

  it("keeps every title a roster states for one person in the lane's newest run", () => {
    const kept = userTitleEvidence([
      title('dept-faculty-roster', 'Professor of Medicine', '2026-10-23T12:00:00Z', 'run-b'),
      title('dept-faculty-roster', 'Director, Fixture Center', '2026-10-23T11:00:00Z', 'run-b'),
      title(
        'dept-faculty-roster',
        'Associate Professor of Medicine',
        '2026-09-13T00:00:00Z',
        'run-a',
      ),
    ]);

    expect(kept.map((observation) => observation.value)).toEqual([
      'Professor of Medicine',
      'Director, Fixture Center',
    ]);
  });

  it('serves a directory title only when no other source states one', () => {
    const directory = title(
      'yale-directory',
      'Professor of Medicine',
      '2026-11-03T00:00:00Z',
      'run-d',
    );
    const csv = title(
      'yale-directory-csv',
      'Professor of Medicine',
      '2026-05-15T00:00:00Z',
      'run-e',
    );
    const roster = title(
      'dept-faculty-roster',
      'Professor of Medicine',
      '2026-10-23T00:00:00Z',
      'run-b',
    );

    expect(userTitleEvidence([directory, csv])).toEqual([directory, csv]);
    expect(userTitleEvidence([directory, csv, roster])).toEqual([roster]);
  });

  it("keeps each lane's own newest read and every field that is not a title", () => {
    const kept = userTitleEvidence([
      title('ysm-faculty-directory', 'Assistant Professor', '2026-08-29T00:00:00Z', 'run-a'),
      title('dept-faculty-roster', 'Assistant Professor', '2026-09-13T00:00:00Z', 'run-c'),
      title('ysm-faculty-directory', 'Associate Professor', '2026-10-23T00:00:00Z', 'run-b'),
      { field: 'fname', sourceName: 'ysm-faculty-directory', value: 'Quinn' },
    ]);

    expect(kept.map((observation) => [observation.sourceName, observation.value])).toEqual([
      ['dept-faculty-roster', 'Assistant Professor'],
      ['ysm-faculty-directory', 'Associate Professor'],
      ['ysm-faculty-directory', 'Quinn'],
    ]);
  });
});
