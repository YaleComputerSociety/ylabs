import http from 'node:http';
import type { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ScrapeRun } from '../../models/scrapeRun';
import { Source } from '../../models/source';
import { materializeEntity } from '../entityMaterializer';
import { ScraperOrchestrator } from '../orchestrator';
import { LabMicrositeDescriptionLLMExtractor } from '../sources/labMicrositeDescriptionLLMExtractor';
import { SOURCE_CONTENT_HASH_FIELD } from '../contentHashGate';

const SOURCE_NAME = 'lab-microsite-description-llm';
const SLUG = 'fixture-core-a';
const CORE_PATH = '/cores/a';

const SIBLING_TEASER =
  'The Fixture Metabolism Core focuses on metabolomics research, particularly using stable isotope flux analysis and lipid profiling to study metabolic disease across the medical campus.';
const OTHER_TEASER =
  'The Fixture Screening Center provides assay development and high-throughput screening with small-molecule libraries for investigators.';
const RESEARCH_PAGE_PROSE =
  'We investigate parametric amplification in superconducting circuits. Our experiments characterise gain, bandwidth, and added noise across a range of pump powers and device geometries, and we use those measurements to design modular processors.';

const teaserCard = (href: string, title: string, text: string) =>
  `<li><div class="cores-card listing-item card--listing"><div class="card__content"><h2><a href="${href}">${title}</a></h2><p>${text}</p></div></div></li>`;

const corePageHtml = (extraLinks: string) =>
  `<html><body><main><h1>Fixture Core A</h1>${extraLinks}<ul>${teaserCard('/cores/b', 'Metabolism Core', SIBLING_TEASER)}${teaserCard('/cores/c', 'Screening Center', OTHER_TEASER)}</ul></main></body></html>`;

describe('a stored related-unit teaser gets the two attested reads the refusal pass needs', () => {
  let replSet: MongoMemoryReplSet;
  let server: http.Server;
  let siteOrigin = '';
  let coreLinks = '';
  const requestedPaths: string[] = [];
  const callLLM = vi.fn(async () => ({
    fullDescription: '',
    shortDescription: '',
    topics: [],
    methods: [],
  }));

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());

    server = http.createServer((req, res) => {
      const path = (req.url || '/').split('?')[0];
      requestedPaths.push(path);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        path === CORE_PATH
          ? corePageHtml(coreLinks)
          : `<html><body><main><h1>Research</h1><p>${RESEARCH_PAGE_PROSE}</p></main></body></html>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    siteOrigin = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'sources', 'scrape_runs']) {
      await db.collection(name).deleteMany({});
    }
    requestedPaths.length = 0;
    coreLinks = '';
    await Source.create({
      name: SOURCE_NAME,
      displayName: 'Lab microsite LLM (description only)',
      defaultWeight: 0.82,
    });
  });

  const seedEntityStoringTheSiblingTeaser = async () => {
    const entity = await ResearchEntity.create({
      slug: SLUG,
      name: 'Fixture Core A',
      kind: 'core_facility',
      websiteUrl: `${siteOrigin}${CORE_PATH}`,
      fullDescription: SIBLING_TEASER,
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    const source = await Source.findOne({ name: SOURCE_NAME }).lean<{
      _id: mongoose.Types.ObjectId;
    }>();
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      entityId: String(entity._id),
      field: 'fullDescription',
      value: SIBLING_TEASER,
      sourceId: source?._id,
      sourceName: SOURCE_NAME,
      sourceUrl: `${siteOrigin}${CORE_PATH}`,
      confidence: 0.82,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
  };

  const runLane = async () => {
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register(
      new LabMicrositeDescriptionLLMExtractor({
        apiKey: 'test-key',
        fetchPage: async (url: string) => {
          const response = await fetch(url);
          return { url: response.url, html: await response.text() };
        },
        callLLM,
        callCardLLM: async () => '',
      }),
    );
    await orchestrator.run(SOURCE_NAME, {
      dryRun: false,
      useCache: false,
      release: false,
      only: [SLUG],
      exhaustive: true,
      ignoreWorkPlanner: true,
    });
  };

  const latestHash = async () =>
    Observation.findOne({ entityKey: SLUG, field: SOURCE_CONTENT_HASH_FIELD, superseded: false })
      .sort({ observedAt: -1 })
      .lean<{ value?: string; assertsNoValueFor?: string[]; sourceUrl?: string }>();

  it('re-reads the page exactly once more and then lets the content-hash gate close', async () => {
    await seedEntityStoringTheSiblingTeaser();

    await runLane();
    const firstHash = await latestHash();
    expect(firstHash?.assertsNoValueFor).toEqual(['fullDescription', 'shortDescription']);
    expect(firstHash?.sourceUrl).toBe(`${siteOrigin}${CORE_PATH}`);

    await runLane();
    const secondHash = await latestHash();
    expect(secondHash?.assertsNoValueFor).toEqual(['fullDescription', 'shortDescription']);
    expect(secondHash?.value).not.toBe(firstHash?.value);

    const llmCallsBeforeThirdRun = callLLM.mock.calls.length;
    await runLane();
    expect(callLLM.mock.calls.length).toBe(llmCallsBeforeThirdRun);
    expect((await latestHash())?.value).toBe(secondHash?.value);

    const attestedReads = await Observation.find({
      entityKey: SLUG,
      sourceName: SOURCE_NAME,
      assertsNoValueFor: { $all: ['fullDescription', 'shortDescription'] },
    }).lean<Array<{ scrapeRunId?: unknown }>>();
    expect(new Set(attestedReads.map((read) => String(read.scrapeRunId))).size).toBe(2);

    const runs = await ScrapeRun.find({})
      .sort({ startedAt: 1 })
      .lean<Array<{ metrics?: { descriptionSlotAttestation?: { empty?: number } } }>>();
    expect(runs.slice(0, 2).map((run) => run.metrics?.descriptionSlotAttestation?.empty)).toEqual([
      1, 1,
    ]);
  });

  it('lets crawled research prose replace a stored teaser the primary page cannot vouch for', async () => {
    coreLinks = `<a href="${CORE_PATH}/research">Research</a>`;
    await seedEntityStoringTheSiblingTeaser();

    await runLane();
    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(requestedPaths).toContain(`${CORE_PATH}/research`);
    const persisted = await ResearchEntity.findOne({ slug: SLUG }).lean<{
      fullDescription?: string;
    }>();
    expect(persisted?.fullDescription).toBe(RESEARCH_PAGE_PROSE);
  });
});
