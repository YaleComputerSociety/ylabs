import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../entityMaterializer';
import {
  fetchRecordedBy,
  LANE_PAGE_HEALTH_FIELD,
  LanePageReads,
  type LanePageProbe,
} from '../lanePageHealth';
import { HttpStatusError } from '../utils/httpFetch';
import { appendObservations } from '../observationStore';
import { CentersInstitutesScraper } from '../sources/centersInstitutesScraper';
import { LabMicrositeDescriptionLLMExtractor } from '../sources/labMicrositeDescriptionLLMExtractor';
import { LabMicrositeUndergradLLMExtractor } from '../sources/labMicrositeUndergradLLMExtractor';
import { LabSiteLeadVerificationScraper } from '../sources/labSiteLeadVerificationScraper';
import { OfficialProfilePiBackfillScraper } from '../sources/officialProfilePiBackfillScraper';
import { ResearchAreaSourceExtractor } from '../sources/researchAreaSourceExtractor';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';
import type { IScraper, ObservationInput, ScraperContext } from '../types';

const SLUG = 'synthetic-membrane-lab';
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

const storedDepartments = async () =>
  (await ResearchEntity.findById(rowId).lean<{ departments?: string[] }>())?.departments ?? [];

const noRows = async () => [];

const wiredLanes: Array<{ name: string; build: (probe: LanePageProbe) => IScraper }> = [
  {
    name: 'lab-microsite-undergrad-llm',
    build: (probe) =>
      new LabMicrositeUndergradLLMExtractor({
        apiKey: 'test-key',
        labFinder: noRows,
        renderedFetcher: null,
        fetchPage: vi.fn(),
        probePage: probe,
      }),
  },
  {
    name: 'lab-microsite-description-llm',
    build: (probe) =>
      new LabMicrositeDescriptionLLMExtractor({
        apiKey: 'test-key',
        labFinder: noRows,
        identityCorpusLoader: async () => ({
          knownPersonSurnames: NO_SURNAME_ROSTER,
          leadPersonNameByEntityId: new Map<string, string>(),
        }),
        fetchPage: vi.fn(),
        probePage: probe,
      }),
  },
  {
    name: 'centers-institutes-index',
    build: (probe) => new CentersInstitutesScraper([], null, vi.fn(), vi.fn(), probe),
  },
  {
    name: 'lab-site-lead-verification',
    build: (probe) => new LabSiteLeadVerificationScraper(noRows, vi.fn(), probe),
  },
  {
    name: 'official-profile-pi-backfill',
    build: (probe) =>
      new OfficialProfilePiBackfillScraper(
        vi.fn(),
        noRows,
        async () => null,
        noRows,
        noRows,
        noRows,
        0,
        async () => undefined,
        noRows,
        noRows,
        probe,
      ),
  },
  {
    name: 'research-area-source-extractor',
    build: (probe) =>
      new ResearchAreaSourceExtractor({
        fetchPage: vi.fn(),
        entityFinder: noRows,
        probePage: probe,
      }),
  },
];

describe('the page-reading lanes withdraw what a gone page they cite supplied (#4840)', () => {
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
    for (const name of ['observations', 'research_entities', 'role_assignments', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    const row = await ResearchEntity.create({
      slug: SLUG,
      name: 'Synthetic Membrane Lab',
      entityType: 'LAB',
    });
    rowId = String(row._id);
  });

  describe.each(wiredLanes)('$name', ({ name, build }) => {
    it('records a gone verdict for a cited page that stored health and a probe both call gone', async () => {
      await laneCites(name, GONE_PAGE, new Date('2026-09-01T00:00:00Z'));
      await storeGoneHealth(GONE_PAGE);
      const probe = goneProbe();
      const { ctx, emitted } = laneContext(name, { ignoreWorkPlanner: true });

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
      const { ctx, emitted } = laneContext(name, { ignoreWorkPlanner: true });

      await build(probe).run(ctx);

      expect(pageVerdicts(emitted)).toEqual([]);
    });

    it('records nothing for a row a narrowed run does not select', async () => {
      await laneCites(name, GONE_PAGE, new Date('2026-09-01T00:00:00Z'));
      await storeGoneHealth(GONE_PAGE);
      const probe = goneProbe();
      const { ctx, emitted } = laneContext(name, {
        ignoreWorkPlanner: true,
        only: ['another-row'],
      });

      await build(probe).run(ctx);

      expect(probe).not.toHaveBeenCalled();
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
      const { ctx, emitted } = laneContext(name, { ignoreWorkPlanner: true });

      await build(goneProbe()).run(ctx);
      await recordVerdicts(name, pageVerdicts(emitted), new Date('2026-09-10T00:00:00Z'));
      await materializeEntity('researchEntity', { entityId: rowId }, {});

      expect(await storedDepartments()).toEqual([RIVAL_DEPARTMENT]);
    });
  });

  describe('a narrowed run that names the citing row', () => {
    it('reaches a center whose roster page now answers 404', async () => {
      const lane = 'centers-institutes-index';
      await laneCites(lane, GONE_PAGE, new Date('2026-09-01T00:00:00Z'));
      await storeGoneHealth(GONE_PAGE);
      const scraper = new CentersInstitutesScraper(
        [
          {
            centerKey: 'synthetic-membrane',
            centerName: 'Synthetic Membrane Center',
            schoolName: '',
            kind: 'center',
            url: GONE_PAGE,
            extractor: () => ({ members: [] }),
            entityKey: SLUG,
          },
        ],
        null,
        vi.fn().mockRejectedValue(new HttpStatusError(404)),
        vi.fn(),
        goneProbe(),
      );
      const { ctx, emitted } = laneContext(lane, {
        ignoreWorkPlanner: true,
        only: ['synthetic-membrane'],
      });

      await scraper.run(ctx);

      expect(pageVerdicts(emitted)).toEqual([
        expect.objectContaining({ entityKey: SLUG, sourceUrl: GONE_PAGE }),
      ]);
    });

    it('reaches an official-profile row named by its id', async () => {
      const lane = 'official-profile-pi-backfill';
      await laneCites(lane, GONE_PAGE, new Date('2026-09-01T00:00:00Z'));
      await storeGoneHealth(GONE_PAGE);
      const selectRow = async () => [{ _id: rowId, slug: SLUG }];
      const scraper = new OfficialProfilePiBackfillScraper(
        vi.fn(),
        noRows,
        async () => null,
        noRows,
        selectRow,
        noRows,
        0,
        async () => undefined,
        noRows,
        noRows,
        goneProbe(),
      );
      const { ctx, emitted } = laneContext(lane, { ignoreWorkPlanner: true, only: [rowId] });

      await scraper.run(ctx);

      expect(pageVerdicts(emitted)).toEqual([
        expect.objectContaining({ entityKey: SLUG, sourceUrl: GONE_PAGE }),
      ]);
    });
  });

  describe('lab-site-lead-verification restoring a gone page', () => {
    const lane = 'lab-site-lead-verification';
    const candidate = async () => [{ entityId: rowId, slug: SLUG, website: GONE_PAGE, leads: [] }];

    async function withdrawnPage() {
      await laneCites(lane, GONE_PAGE, new Date('2026-09-01T00:00:00Z'));
      await storeGoneHealth(GONE_PAGE);
      const { ctx, emitted } = laneContext(lane, { ignoreWorkPlanner: true });
      await new LabSiteLeadVerificationScraper(noRows, vi.fn(), goneProbe()).run(ctx);
      await recordVerdicts(lane, pageVerdicts(emitted), new Date('2026-09-10T00:00:00Z'));
    }

    const healthyVerdicts = (emitted: ObservationInput[]) =>
      pageVerdicts(emitted).filter(
        (verdict) => (verdict.value as { healthStatus?: string }).healthStatus === 'HEALTHY',
      );

    it('restores it from a live read', async () => {
      await withdrawnPage();
      const { ctx, emitted } = laneContext(lane, { ignoreWorkPlanner: true });

      await new LabSiteLeadVerificationScraper(
        candidate,
        async () => ({ html: '<p>lab</p>', visitedUrls: [GONE_PAGE] }),
        goneProbe(),
      ).run(ctx);

      expect(healthyVerdicts(emitted)).toEqual([
        expect.objectContaining({ entityKey: SLUG, sourceUrl: GONE_PAGE }),
      ]);
    });

    it('does not restore it from a cached read', async () => {
      await withdrawnPage();
      const { ctx, emitted } = laneContext(lane, { ignoreWorkPlanner: true, useCache: true });

      await new LabSiteLeadVerificationScraper(
        candidate,
        async () => ({ html: '<p>lab</p>', visitedUrls: [GONE_PAGE], fromCache: true }),
        goneProbe(),
      ).run(ctx);

      expect(healthyVerdicts(emitted)).toEqual([]);
    });
  });
});

describe('a recorded lane fetch (#4840)', () => {
  it('records a failure with its status and rethrows it', async () => {
    const reads = new LanePageReads();
    const fetch = fetchRecordedBy(reads, async (_url: string) => {
      throw new HttpStatusError(404);
    });

    await expect(fetch(GONE_PAGE)).rejects.toThrow();

    expect([...reads.failures.values()]).toEqual([{ url: GONE_PAGE, httpStatusCode: 404 }]);
  });

  it('counts a read as live only when the fetcher reports where it landed', async () => {
    const reads = new LanePageReads();
    await fetchRecordedBy(reads, async (_url: string) => '<html></html>')(GONE_PAGE);
    expect(reads.reads.size).toBe(0);

    await fetchRecordedBy(reads, async (url: string) => ({ url, html: '' }))(LIVE_PAGE);
    expect([...reads.reads.values()]).toEqual([{ url: LIVE_PAGE, resolvedUrl: LIVE_PAGE }]);
  });

  it('records no live read for a fetch that lands away from the requested page', async () => {
    const reads = new LanePageReads();
    await fetchRecordedBy(reads, async (_url: string) => ({
      url: 'https://dept.example.edu/',
      html: '',
    }))(GONE_PAGE);

    expect(reads.reads.size).toBe(0);
  });
});
