import axios from 'axios';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return { ...actual, default: { ...actual.default, get: vi.fn() } };
});

vi.mock('../../utils/ssrfGuard', async () => {
  const actual =
    await vi.importActual<typeof import('../../utils/ssrfGuard')>('../../utils/ssrfGuard');
  return { ...actual, assertPublicHttpUrl: async (url: string) => new URL(url) };
});

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    syncEntities: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../entityMaterializer';
import {
  emitLanePageHealthForCitedPages,
  LANE_PAGE_HEALTH_FIELD,
  LanePageReads,
  type LanePageProbe,
} from '../lanePageHealth';
import { appendObservations } from '../observationStore';
import { DepartmentUndergradResearchScraper } from '../sources/departmentUndergradResearchScraper';
import { YsmAtoZScraper } from '../sources/ysmAtoZScraper';
import {
  YsmFacultyDirectoryScraper,
  type HtmlFetcher,
} from '../sources/ysmFacultyDirectoryScraper';
import type { IScraper, ObservationInput, ScraperContext } from '../types';
import { HttpStatusError } from '../utils/httpFetch';

const FACULTY_PROFILE_SLUG = 'synthetic-membrane-lab';
const SLUG = `ysm-faculty-${FACULTY_PROFILE_SLUG}`;
const FACULTY_PROFILE_PAGE = `https://medicine.yale.edu/profile/${FACULTY_PROFILE_SLUG}/`;
const GONE_PAGE = 'https://dept.example.edu/retired-listing';
const LIVE_PAGE = 'https://dept.example.edu/current-listing';
const DEPARTMENT = 'Synthetic Membrane Studies';
const RIVAL_DEPARTMENT = 'Synthetic Transport Studies';
const RIVAL_LANE = 'synthetic-rival-lane';

let rowId = '';

const goneProbe = () =>
  vi.fn<LanePageProbe>().mockResolvedValue({ healthStatus: 'UNAVAILABLE', httpStatusCode: 404 });

function laneContext(sourceName: string, options: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: new mongoose.Types.ObjectId().toString(),
    sourceId: new mongoose.Types.ObjectId().toString(),
    sourceName,
    sourceWeight: 0.8,
    options: { dryRun: true, useCache: false, release: false, ...options },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => undefined,
  };
  return { ctx, emitted };
}

async function laneCites(
  sourceName: string,
  sourceUrl: string,
  observedAt: Date,
  department = DEPARTMENT,
  sourceWeight = 0.8,
) {
  await appendObservations(
    [
      {
        entityType: 'researchEntity',
        entityId: rowId,
        entityKey: SLUG,
        sourceUrl,
        field: 'departments',
        value: [department],
        observedAt,
      },
    ],
    {
      scrapeRunId: new mongoose.Types.ObjectId().toString(),
      sourceId: new mongoose.Types.ObjectId().toString(),
      sourceName,
      sourceWeight,
      dryRun: false,
    },
  );
}

async function recordVerdicts(sourceName: string, verdicts: ObservationInput[], observedAt: Date) {
  await appendObservations(
    verdicts.map((verdict) => ({ ...verdict, observedAt })),
    {
      scrapeRunId: new mongoose.Types.ObjectId().toString(),
      sourceId: new mongoose.Types.ObjectId().toString(),
      sourceName,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );
}

const pageVerdicts = (emitted: ObservationInput[]) =>
  emitted.filter((observation) => observation.field === LANE_PAGE_HEALTH_FIELD);

async function storeGoneHealth(url: string) {
  await ResearchEntity.updateOne(
    { _id: rowId },
    {
      $set: {
        sourceLinkHealth: [
          { url, healthStatus: 'UNAVAILABLE', httpStatusCode: 404, checkedAt: new Date() },
        ],
      },
    },
  );
}

async function recordGoneVerdict(sourceName: string, url: string) {
  await laneCites(sourceName, url, new Date('2026-09-01T00:00:00Z'));
  await storeGoneHealth(url);
  const first = laneContext(sourceName);
  await emitLanePageHealthForCitedPages(first.ctx, new LanePageReads(), goneProbe());
  expect(pageVerdicts(first.emitted)).toHaveLength(1);
  await recordVerdicts(sourceName, first.emitted, new Date('2026-09-10T00:00:00Z'));
}

const departmentPage = (key: string, url: string) => ({
  key,
  url,
  department: DEPARTMENT,
  school: 'Synthetic School',
  parser: 'general-guidance' as const,
});

const storedDepartments = async () =>
  (await ResearchEntity.findById(rowId).lean<{ departments?: string[] }>())?.departments ?? [];

const emptyYsmIndex = '<html><body><table><tbody></tbody></table></body></html>';
const emptyFacultyDirectory = '<html><body><main></main></body></html>';

const wiredLanes: Array<{ name: string; build: (probe: LanePageProbe) => IScraper }> = [
  {
    name: 'ysm-atoz-index',
    build: (probe) => new YsmAtoZScraper(probe),
  },
  {
    name: 'department-undergrad-research',
    build: (probe) =>
      new DepartmentUndergradResearchScraper({
        pageConfigs: [],
        fetchHtml: vi.fn(),
        probePage: probe,
      }),
  },
  {
    name: 'ysm-faculty-directory',
    build: (probe) =>
      new YsmFacultyDirectoryScraper(
        vi.fn().mockResolvedValue(emptyFacultyDirectory),
        vi.fn().mockResolvedValue(new Map()),
        async () => undefined,
        probe,
      ),
  },
];

describe('a lane withdraws what a page it still cites but no longer reads supplied (#4840)', () => {
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
    for (const name of [
      'observations',
      'research_entities',
      'role_assignments',
      'signals',
      'scrape_snapshots',
    ]) {
      await db.collection(name).deleteMany({});
    }
    const row = await ResearchEntity.create({
      slug: SLUG,
      name: 'Synthetic Membrane Lab',
      entityType: 'LAB',
    });
    rowId = String(row._id);
    vi.mocked(axios.get).mockReset();
    vi.mocked(axios.get).mockResolvedValue({ data: emptyYsmIndex, request: {} });
  });

  describe.each(wiredLanes)('$name', ({ name, build }) => {
    it('records a gone verdict for a cited page that stored health and a probe both call gone', async () => {
      await laneCites(name, GONE_PAGE, new Date('2026-09-01T00:00:00Z'));
      await storeGoneHealth(GONE_PAGE);
      const probe = goneProbe();
      const { ctx, emitted } = laneContext(name);

      await build(probe).run(ctx);

      expect(probe).toHaveBeenCalledTimes(1);
      expect(pageVerdicts(emitted)).toEqual([
        expect.objectContaining({
          entityKey: SLUG,
          entityId: rowId,
          sourceUrl: GONE_PAGE,
          value: expect.objectContaining({ healthStatus: 'UNAVAILABLE', httpStatusCode: 404 }),
        }),
      ]);
    });

    it('records nothing when the confirming probe is inconclusive', async () => {
      await laneCites(name, GONE_PAGE, new Date('2026-09-01T00:00:00Z'));
      await storeGoneHealth(GONE_PAGE);
      const probe = vi.fn<LanePageProbe>().mockResolvedValue({ healthStatus: 'UNKNOWN' });
      const { ctx, emitted } = laneContext(name);

      await build(probe).run(ctx);

      expect(pageVerdicts(emitted)).toEqual([]);
    });

    it('stops counting the withdrawn values once the verdict is resolved', async () => {
      await laneCites(name, GONE_PAGE, new Date('2026-09-01T00:00:00Z'));
      await laneCites(
        RIVAL_LANE,
        LIVE_PAGE,
        new Date('2026-08-01T00:00:00Z'),
        RIVAL_DEPARTMENT,
        0.3,
      );
      await storeGoneHealth(GONE_PAGE);
      await materializeEntity('researchEntity', { entityId: rowId }, {});
      expect(await storedDepartments()).toContain(DEPARTMENT);
      const { ctx, emitted } = laneContext(name);

      await build(goneProbe()).run(ctx);
      await recordVerdicts(name, pageVerdicts(emitted), new Date('2026-09-10T00:00:00Z'));
      await materializeEntity('researchEntity', { entityId: rowId }, {});

      expect(await storedDepartments()).toEqual([RIVAL_DEPARTMENT]);
      expect(
        await Observation.countDocuments({
          sourceName: name,
          field: 'departments',
          superseded: false,
        }),
      ).toBe(1);
    });
  });

  it('never probes a page whose stored health does not call it gone and that the lane did not fail to read', async () => {
    await laneCites('ysm-atoz-index', LIVE_PAGE, new Date('2026-09-01T00:00:00Z'));
    const probe = goneProbe();
    const { ctx, emitted } = laneContext('ysm-atoz-index');

    await emitLanePageHealthForCitedPages(ctx, new LanePageReads(), probe);

    expect(probe).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('treats a 403, 429, 5xx or timeout from the lane read as nothing', async () => {
    await laneCites('ysm-atoz-index', LIVE_PAGE, new Date('2026-09-01T00:00:00Z'));
    const probe = goneProbe();
    for (const failure of [
      new HttpStatusError(403),
      new HttpStatusError(429),
      new HttpStatusError(503),
      Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }),
    ]) {
      const reads = new LanePageReads();
      reads.recordFailure(LIVE_PAGE, failure);
      const { ctx, emitted } = laneContext('ysm-atoz-index');
      await emitLanePageHealthForCitedPages(ctx, reads, probe);
      expect(emitted).toEqual([]);
    }
    expect(probe).not.toHaveBeenCalled();
  });

  it('confirms a page the lane read as 404 even before stored health has a verdict', async () => {
    await laneCites('ysm-atoz-index', LIVE_PAGE, new Date('2026-09-01T00:00:00Z'));
    const reads = new LanePageReads();
    reads.recordFailure(LIVE_PAGE, new HttpStatusError(404));
    const { ctx, emitted } = laneContext('ysm-atoz-index');

    await emitLanePageHealthForCitedPages(ctx, reads, goneProbe());

    expect(pageVerdicts(emitted)).toHaveLength(1);
  });

  it('records nothing for a page the lane cited on this very run', async () => {
    await storeGoneHealth(GONE_PAGE);
    const { ctx, emitted } = laneContext('ysm-atoz-index');
    await appendObservations(
      [
        {
          entityType: 'researchEntity',
          entityId: rowId,
          entityKey: SLUG,
          sourceUrl: GONE_PAGE,
          field: 'departments',
          value: [DEPARTMENT],
        },
      ],
      { ...ctx, dryRun: false },
    );
    const probe = goneProbe();

    await emitLanePageHealthForCitedPages(ctx, new LanePageReads(), probe);

    expect(probe).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('does not re-probe a page whose values are already withdrawn', async () => {
    await laneCites('ysm-atoz-index', GONE_PAGE, new Date('2026-09-01T00:00:00Z'));
    await storeGoneHealth(GONE_PAGE);
    const first = laneContext('ysm-atoz-index');
    await emitLanePageHealthForCitedPages(first.ctx, new LanePageReads(), goneProbe());
    await recordVerdicts('ysm-atoz-index', first.emitted, new Date('2026-09-10T00:00:00Z'));
    const probe = goneProbe();
    const second = laneContext('ysm-atoz-index');

    await emitLanePageHealthForCitedPages(second.ctx, new LanePageReads(), probe);

    expect(probe).not.toHaveBeenCalled();
    expect(second.emitted).toEqual([]);
  });

  it('restores the values when the lane reads a page it had recorded gone', async () => {
    await laneCites('ysm-atoz-index', GONE_PAGE, new Date('2026-09-01T00:00:00Z'));
    await laneCites(RIVAL_LANE, LIVE_PAGE, new Date('2026-08-01T00:00:00Z'), RIVAL_DEPARTMENT, 0.3);
    await storeGoneHealth(GONE_PAGE);
    const first = laneContext('ysm-atoz-index');
    await emitLanePageHealthForCitedPages(first.ctx, new LanePageReads(), goneProbe());
    await recordVerdicts('ysm-atoz-index', first.emitted, new Date('2026-09-10T00:00:00Z'));
    await materializeEntity('researchEntity', { entityId: rowId }, {});
    expect(await storedDepartments()).not.toContain(DEPARTMENT);

    const reads = new LanePageReads();
    reads.recordRead(GONE_PAGE);
    const second = laneContext('ysm-atoz-index');
    await emitLanePageHealthForCitedPages(second.ctx, reads, goneProbe());
    expect(pageVerdicts(second.emitted)).toEqual([
      expect.objectContaining({ value: expect.objectContaining({ healthStatus: 'HEALTHY' }) }),
    ]);
    await recordVerdicts('ysm-atoz-index', second.emitted, new Date('2026-09-20T00:00:00Z'));
    await materializeEntity('researchEntity', { entityId: rowId }, {});

    expect(await storedDepartments()).toContain(DEPARTMENT);
  });

  it('scopes a narrowed run to the rows it names', async () => {
    await laneCites('ysm-atoz-index', GONE_PAGE, new Date('2026-09-01T00:00:00Z'));
    await storeGoneHealth(GONE_PAGE);
    const probe = goneProbe();
    const { ctx, emitted } = laneContext('ysm-atoz-index');

    await emitLanePageHealthForCitedPages(ctx, new LanePageReads(), probe, {
      entityKeys: ['another-row'],
    });

    expect(probe).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('restores the row behind the profile a narrowed faculty-directory run names', async () => {
    await recordGoneVerdict('ysm-faculty-directory', FACULTY_PROFILE_PAGE);
    const directory = `<html><body><script id='page-data' type='application/json'>${JSON.stringify({
      mainComponents: [
        {
          key: 'PeopleAzList',
          model: {
            items: [
              {
                id: 'S',
                items: [{ url: `/profile/${FACULTY_PROFILE_SLUG}/`, text: 'Lab, Synthetic' }],
              },
            ],
          },
        },
      ],
    })}</script></body></html>`;
    const fetcher: HtmlFetcher = async (url, _useCache, pageReads) => {
      if (url.includes('/faculty-directory/')) return directory;
      pageReads?.recordRead(url);
      return '<html><body></body></html>';
    };
    const { ctx, emitted } = laneContext('ysm-faculty-directory', {
      only: [FACULTY_PROFILE_SLUG],
    });

    await new YsmFacultyDirectoryScraper(
      fetcher,
      vi.fn().mockResolvedValue(new Map()),
      async () => undefined,
      goneProbe(),
    ).run(ctx);

    expect(pageVerdicts(emitted)).toEqual([
      expect.objectContaining({
        sourceUrl: FACULTY_PROFILE_PAGE,
        value: expect.objectContaining({ healthStatus: 'HEALTHY' }),
      }),
    ]);
  });

  it('narrows a department run to the pages its --only names', async () => {
    await recordGoneVerdict('department-undergrad-research', LIVE_PAGE);
    const { ctx, emitted } = laneContext('department-undergrad-research', {
      only: ['current-listing'],
    });

    await new DepartmentUndergradResearchScraper({
      pageConfigs: [
        departmentPage('current-listing', LIVE_PAGE),
        departmentPage('retired-listing', GONE_PAGE),
      ],
      fetchHtml: async (url, _useCache, pageReads) => {
        pageReads?.recordRead(url);
        return '<html><body></body></html>';
      },
      probePage: goneProbe(),
    }).run(ctx);

    expect(pageVerdicts(emitted)).toEqual([
      expect.objectContaining({
        sourceUrl: LIVE_PAGE,
        value: expect.objectContaining({ healthStatus: 'HEALTHY' }),
      }),
    ]);
  });

  describe.each([
    { landing: 'the requested page', responseUrl: GONE_PAGE, restored: true },
    { landing: 'the site root', responseUrl: 'https://dept.example.edu/', restored: false },
  ])('a fetch of a page recorded gone that lands on $landing', ({ responseUrl, restored }) => {
    const department = () =>
      new DepartmentUndergradResearchScraper({
        pageConfigs: [departmentPage('retired-listing', GONE_PAGE)],
        probePage: goneProbe(),
      });

    beforeEach(async () => {
      await recordGoneVerdict('department-undergrad-research', GONE_PAGE);
      vi.mocked(axios.get).mockResolvedValue({
        data: '<html><body></body></html>',
        request: { res: { responseUrl } },
      });
    });

    it(restored ? 'restores the page' : 'restores nothing', async () => {
      const { ctx, emitted } = laneContext('department-undergrad-research');

      await department().run(ctx);

      expect(pageVerdicts(emitted)).toEqual(
        restored
          ? [
              expect.objectContaining({
                value: expect.objectContaining({ healthStatus: 'HEALTHY' }),
              }),
            ]
          : [],
      );
    });

    it('records nothing when the page is served from the cache', async () => {
      const { ctx, emitted } = laneContext('department-undergrad-research', { useCache: true });
      await department().run(ctx);
      const cached = laneContext('department-undergrad-research', { useCache: true });

      await department().run(cached.ctx);

      expect(pageVerdicts(cached.emitted)).toEqual([]);
      expect(pageVerdicts(emitted)).toHaveLength(restored ? 1 : 0);
    });
  });
});
