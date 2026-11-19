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
import { Researcher } from '../../models/researcher';
import { ScrapeRun } from '../../models/scrapeRun';
import { Source } from '../../models/source';
import { materializeEntity } from '../entityMaterializer';
import { ScraperOrchestrator } from '../orchestrator';
import { REKEYED_PERSON_KEY_RETIREMENT_REASON } from '../rekeyedPersonKeyPlan';
import {
  DepartmentRosterScraper,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';

beforeEach(clearC4Flags);

const SOURCE_NAME = 'dept-faculty-roster';
const CHEM_ROSTER = 'https://chemistry.yale.edu/people/faculty';
const PHYS_ROSTER = 'https://physics.yale.edu/people/faculty';

interface Listed {
  name: string;
  profileUrl?: string;
  email?: string;
}

const listings: Record<string, Listed[]> = {};

const renderRoster = (people: Listed[]): string =>
  `<ul>${people
    .map(
      (person) =>
        `<li data-name="${person.name}" data-profile="${person.profileUrl ?? ''}" data-email="${person.email ?? ''}"></li>`,
    )
    .join('')}</ul>`;

const extractor = (html: string): FacultyEntry[] => {
  const $ = cheerio.load(html);
  return $('li')
    .toArray()
    .map((item) => ({
      name: $(item).attr('data-name') ?? '',
      profileUrl: $(item).attr('data-profile') || undefined,
      email: $(item).attr('data-email') || undefined,
      title: 'Professor of Chemistry',
    }));
};

const fetcher = async (url: string): Promise<string> => {
  const people = listings[url];
  if (!people) throw new Error('not found');
  return renderRoster(people);
};

const dept = (deptKey: string, deptName: string, url: string): DeptConfig => ({
  deptKey,
  deptName,
  schoolName: 'Yale Faculty of Arts and Sciences',
  url,
  paginated: false,
  extractor,
});

const CONFIGS = [
  dept('chemistry', 'Chemistry', CHEM_ROSTER),
  dept('physics', 'Physics', PHYS_ROSTER),
];

const SUBJECT = 'Wren Tallowmere';
const SUBJECT_DEPT_KEY = 'dept:chemistry:wren-tallowmere';
const SUBJECT_NETID_KEY = 'netid:wt482';
const SUBJECT_ADDRESS = 'wt482@yale.edu';
const SUBJECT_PAGE = 'https://chemistry.yale.edu/people/wren-tallowmere';

async function scrape(options: { only?: string[]; limit?: number } = {}) {
  const orchestrator = new ScraperOrchestrator();
  orchestrator.register(
    new DepartmentRosterScraper(
      CONFIGS,
      null,
      fetcher,
      async () => new Map(),
      async () => new Set(),
    ),
  );
  await orchestrator.run(SOURCE_NAME, {
    dryRun: false,
    useCache: false,
    release: false,
    ignoreWorkPlanner: true,
    ...options,
  });
  const run = await ScrapeRun.findOne({ sourceName: SOURCE_NAME })
    .sort({ startedAt: -1 })
    .lean<Record<string, any>>();
  return run?.metrics?.rekeyedPersonKeys as Record<string, any> | undefined;
}

async function liveKeys(): Promise<string[]> {
  const keys = await Observation.distinct('entityKey', {
    sourceName: SOURCE_NAME,
    entityType: 'user',
    superseded: false,
  });
  return (keys as string[]).sort();
}

async function retirementReasonsOf(entityKey: string): Promise<string[]> {
  const rows = await Observation.find({ sourceName: SOURCE_NAME, entityKey }).lean<
    Array<{ superseded?: boolean; rollback?: { reason?: string } }>
  >();
  return [...new Set(rows.map((row) => (row.superseded ? (row.rollback?.reason ?? '') : 'live')))];
}

async function plannedPaths(entityKey: string): Promise<string[]> {
  const result = (await materializeEntity(
    'user',
    { entityKey },
    { dryRun: true, synthesizeCardDescription: async () => '' },
  )) as { plannedSet?: Record<string, unknown> };
  return Object.keys(result.plannedSet ?? {}).sort();
}

describe('a person lane retires the key it re-keyed (#5817)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Observation.createIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'researchers', 'sources', 'scrape_runs', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
    for (const key of Object.keys(listings)) delete listings[key];
    await Source.create({
      name: SOURCE_NAME,
      displayName: 'Department rosters',
      defaultWeight: 0.7,
    });
  });

  it('retires the address-less key once the same page states an address, and a third read retires nothing', async () => {
    listings[CHEM_ROSTER] = [{ name: SUBJECT, profileUrl: SUBJECT_PAGE }];
    await scrape();
    expect(await liveKeys()).toEqual([SUBJECT_DEPT_KEY]);

    listings[CHEM_ROSTER] = [{ name: SUBJECT, profileUrl: SUBJECT_PAGE, email: SUBJECT_ADDRESS }];
    const second = await scrape();
    expect(await liveKeys()).toEqual([SUBJECT_NETID_KEY]);
    expect(await retirementReasonsOf(SUBJECT_DEPT_KEY)).toEqual([
      REKEYED_PERSON_KEY_RETIREMENT_REASON,
    ]);
    expect(second).toMatchObject({ retiredKeys: 1, admitted: { '(a) dept: -> netid:': 1 } });
    const afterSecond = await plannedPaths(SUBJECT_NETID_KEY);

    const third = await scrape();
    expect(third).toMatchObject({ retiredKeys: 0, retiredObservations: 0 });
    expect(await liveKeys()).toEqual([SUBJECT_NETID_KEY]);
    expect(await plannedPaths(SUBJECT_NETID_KEY)).toEqual(afterSecond);
  });

  it('counts the YSM department-prefixed and canonical profile paths as one page', async () => {
    listings[CHEM_ROSTER] = [
      { name: SUBJECT, profileUrl: 'https://medicine.yale.edu/chemistry/profile/wren-tallowmere/' },
    ];
    await scrape();
    listings[CHEM_ROSTER] = [
      {
        name: SUBJECT,
        profileUrl: 'https://medicine.yale.edu/profile/wren-tallowmere/',
        email: SUBJECT_ADDRESS,
      },
    ];
    expect(await scrape()).toMatchObject({ retiredKeys: 1 });
    expect(await liveKeys()).toEqual([SUBJECT_NETID_KEY]);
  });

  it('refuses when two people on the roster share the name, and counts the refusal', async () => {
    const second = 'https://chemistry.yale.edu/people/wren-tallowmere-2';
    listings[CHEM_ROSTER] = [
      { name: SUBJECT, profileUrl: SUBJECT_PAGE },
      { name: SUBJECT, profileUrl: second },
    ];
    await scrape();
    listings[CHEM_ROSTER] = [
      { name: SUBJECT, profileUrl: SUBJECT_PAGE, email: SUBJECT_ADDRESS },
      { name: SUBJECT, profileUrl: second, email: 'wt913@yale.edu' },
    ];
    const metrics = await scrape();
    expect(metrics).toMatchObject({
      retiredKeys: 0,
      refused: { '(d) dept: -> netid:': 1 },
      refusalReasons: { 'name-shared-on-listing': 1 },
    });
    expect(await liveKeys()).toContain(SUBJECT_DEPT_KEY);
    const run = await ScrapeRun.findOne({ sourceName: SOURCE_NAME })
      .sort({ startedAt: -1 })
      .lean<{ notes?: string }>();
    expect(run?.notes).toContain('name-shared-on-listing=1');
  });

  it('retires nothing on a name-only match: the old key named no person page', async () => {
    listings[CHEM_ROSTER] = [{ name: SUBJECT }];
    await scrape();
    listings[CHEM_ROSTER] = [{ name: SUBJECT, profileUrl: SUBJECT_PAGE, email: SUBJECT_ADDRESS }];
    expect(await scrape()).toMatchObject({
      retiredKeys: 0,
      leftAlone: { '(c) dept: -> netid:': 1 },
    });
    expect(await liveKeys()).toEqual([SUBJECT_DEPT_KEY, SUBJECT_NETID_KEY]);
  });

  it('retires nothing for a co-author card that links the same page under another name', async () => {
    listings[CHEM_ROSTER] = [{ name: SUBJECT, profileUrl: SUBJECT_PAGE }];
    await scrape();
    listings[CHEM_ROSTER] = [
      { name: 'Orrin Bexley', profileUrl: SUBJECT_PAGE, email: 'ob771@yale.edu' },
    ];
    expect(await scrape()).toMatchObject({ retiredKeys: 0 });
    expect(await liveKeys()).toEqual([SUBJECT_DEPT_KEY, 'netid:ob771']);
  });

  it('retires nothing on an --only run that did not read the old key roster', async () => {
    listings[CHEM_ROSTER] = [{ name: SUBJECT, profileUrl: SUBJECT_PAGE }];
    await scrape();
    listings[PHYS_ROSTER] = [{ name: SUBJECT, profileUrl: SUBJECT_PAGE, email: SUBJECT_ADDRESS }];
    expect(await scrape({ only: ['physics'] })).toMatchObject({ retiredKeys: 0 });
    expect(await liveKeys()).toEqual([SUBJECT_DEPT_KEY, SUBJECT_NETID_KEY]);
  });

  it('retires nothing on a --limit run that stopped part way through the roster', async () => {
    listings[CHEM_ROSTER] = [{ name: SUBJECT, profileUrl: SUBJECT_PAGE }];
    await scrape();
    listings[CHEM_ROSTER] = [
      { name: SUBJECT, profileUrl: SUBJECT_PAGE, email: SUBJECT_ADDRESS },
      { name: 'Orrin Bexley', profileUrl: 'https://chemistry.yale.edu/people/orrin-bexley' },
    ];
    expect(await scrape({ limit: 1 })).toMatchObject({ retiredKeys: 0 });
    expect(await liveKeys()).toEqual([SUBJECT_DEPT_KEY, SUBJECT_NETID_KEY]);
  });

  it('holds the old key when the researcher it reaches does not name the twin', async () => {
    const prefixed = 'https://medicine.yale.edu/chemistry/profile/wren-tallowmere/';
    await Researcher.create({
      displayName: SUBJECT,
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: prefixed,
          verifiedAt: new Date(),
        },
      ],
    });
    listings[CHEM_ROSTER] = [{ name: SUBJECT, profileUrl: prefixed }];
    await scrape();
    listings[CHEM_ROSTER] = [
      {
        name: SUBJECT,
        profileUrl: 'https://medicine.yale.edu/profile/wren-tallowmere/',
        email: SUBJECT_ADDRESS,
      },
    ];
    const metrics = await scrape();
    expect(metrics?.retiredKeys).toBe(0);
    expect(Object.values(metrics?.held ?? {}).reduce((sum: number, n: any) => sum + n, 0)).toBe(1);
    expect(await liveKeys()).toEqual([SUBJECT_DEPT_KEY, SUBJECT_NETID_KEY]);
  });
});
