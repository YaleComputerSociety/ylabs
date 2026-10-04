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

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';
import { materializeEntity } from '../entityMaterializer';
import { LANE_PAGE_HEALTH_FIELD } from '../lanePageHealth';
import { appendObservations } from '../observationStore';
import { LabMicrositeDescriptionLLMExtractor } from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';
import { HttpStatusError } from '../utils/httpFetch';

const LANE = 'lab-microsite-description-llm';
const SLUG = 'synthetic-signaling-lab';
const PAGE = 'https://synthetic-signaling.example.edu/';
const DESCRIPTION =
  'The Synthetic Signaling Lab studies how cells relay chemical signals across membranes, using imaging and computational models of receptor dynamics.';

let rowId = '';

const runContext = () => ({ scrapeRunId: new mongoose.Types.ObjectId().toString() });

async function appendLaneObservations(observations: ObservationInput[], observedAt: Date) {
  await appendObservations(
    observations.map((observation) => ({ ...observation, observedAt })),
    {
      ...runContext(),
      sourceId: new mongoose.Types.ObjectId().toString(),
      sourceName: LANE,
      sourceWeight: 0.8,
      dryRun: false,
    },
  );
}

async function laneReadsDescription(observedAt: Date) {
  await appendLaneObservations(
    [
      {
        entityType: 'researchEntity',
        entityId: rowId,
        entityKey: SLUG,
        sourceUrl: PAGE,
        field: 'fullDescription',
        value: DESCRIPTION,
      },
    ],
    observedAt,
  );
}

async function runLane(fetchPage: () => Promise<{ url: string; html: string }>, probePage: any) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'source-1',
    sourceName: LANE,
    sourceWeight: 0.8,
    options: { dryRun: true, useCache: false, release: false, limit: 10, ignoreWorkPlanner: true },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => undefined,
  } as ScraperContext;
  const lane = new LabMicrositeDescriptionLLMExtractor({
    identityCorpusLoader: async () => ({
      knownPersonSurnames: NO_SURNAME_ROSTER,
      leadPersonNameByEntityId: new Map<string, string>(),
    }),
    apiKey: 'test-key',
    labFinder: async () => [
      { _id: rowId, slug: SLUG, name: 'Synthetic Signaling Lab', websiteUrl: PAGE },
    ],
    fetchPage,
    probePage,
    callLLM: vi.fn().mockRejectedValue(new Error('no model in this test')),
    callCardLLM: vi.fn().mockRejectedValue(new Error('no model in this test')),
  });
  await lane.run(ctx);
  return emitted.filter((observation) => observation.field === LANE_PAGE_HEALTH_FIELD);
}

const gone = () => Promise.reject(new HttpStatusError(404));
const forbidden = () => Promise.reject(new HttpStatusError(403));
const timedOut = () =>
  Promise.reject(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));
const answers = () =>
  Promise.resolve({
    url: PAGE,
    html: `<main><h1>Synthetic Signaling Lab</h1><p>${DESCRIPTION}</p></main>`,
  });

const resolve = () => materializeEntity('researchEntity', { entityId: rowId }, {});

const storedDescription = async () =>
  (await ResearchEntity.findById(rowId).lean<{ fullDescription?: unknown }>())?.fullDescription;

describe('a fixed-list lane page that is gone withdraws the values it supplied (#4729)', () => {
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
      name: 'Synthetic Signaling Lab',
      entityType: 'LAB',
      websiteUrl: PAGE,
    });
    rowId = String(row._id);
    await laneReadsDescription(new Date('2026-09-01T00:00:00Z'));
    await resolve();
    expect(await storedDescription()).toBe(DESCRIPTION);
  });

  it('withdraws the description once a second read confirms the page is gone', async () => {
    const probe = vi.fn().mockResolvedValue({ healthStatus: 'UNAVAILABLE', httpStatusCode: 404 });
    const verdicts = await runLane(gone, probe);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(verdicts).toHaveLength(1);
    await appendLaneObservations(verdicts, new Date('2026-09-10T00:00:00Z'));

    await resolve();
    expect(await storedDescription()).toBeFalsy();
    await resolve();
    expect(await storedDescription()).toBeFalsy();
    expect(
      await Observation.countDocuments({
        sourceName: LANE,
        field: 'fullDescription',
        superseded: false,
      }),
    ).toBe(1);
  });

  it('withdraws nothing when the page answers 403 or times out', async () => {
    const probe = vi.fn();
    for (const fetchPage of [forbidden, timedOut]) {
      const verdicts = await runLane(fetchPage, probe);
      expect(verdicts).toEqual([]);
    }
    expect(probe).not.toHaveBeenCalled();
    await resolve();
    expect(await storedDescription()).toBe(DESCRIPTION);
  });

  it('withdraws nothing when the confirming read is inconclusive', async () => {
    const probe = vi.fn().mockResolvedValue({ healthStatus: 'UNKNOWN', httpStatusCode: 403 });
    expect(await runLane(gone, probe)).toEqual([]);
    await resolve();
    expect(await storedDescription()).toBe(DESCRIPTION);
  });

  it('restores the description when the page comes back', async () => {
    const probe = vi.fn().mockResolvedValue({ healthStatus: 'UNAVAILABLE', httpStatusCode: 410 });
    await appendLaneObservations(await runLane(gone, probe), new Date('2026-09-10T00:00:00Z'));
    await resolve();
    expect(await storedDescription()).toBeFalsy();

    const liveVerdicts = await runLane(answers, vi.fn());
    expect(liveVerdicts.map((observation) => (observation.value as any).healthStatus)).toEqual([
      'HEALTHY',
    ]);
    await appendLaneObservations(liveVerdicts, new Date('2026-09-20T00:00:00Z'));
    await resolve();
    expect(await storedDescription()).toBe(DESCRIPTION);
  });
});
