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
import { Source } from '../../models/source';
import { materializeEntity } from '../entityMaterializer';
import { ScraperOrchestrator } from '../orchestrator';
import { LabMicrositeDescriptionLLMExtractor } from '../sources/labMicrositeDescriptionLLMExtractor';
import { SOURCE_CONTENT_HASH_FIELD } from '../contentHashGate';

const SOURCE_NAME = 'lab-microsite-description-llm';
const SLUG = 'hatridge-lab-fixture';

const GOOD_STORED_DESCRIPTION =
  'The Hatridge Lab focuses on quantum information research, particularly using superconducting microwave circuits as a platform to entangle larger quantum systems and to build modular quantum processors.';

const FIGURE_CAPTION =
  'The aluminum housing for a 6-qubit, 2 module processor design set on the still stage of one of our new dilution refrigerators for ambience. From top left, the input lines run to the mixing chamber plate.';

const RESEARCH_PAGE_PROSE =
  'We investigate parametric amplification in superconducting circuits. Our experiments characterise gain, bandwidth, and added noise across a range of pump powers and device geometries, and we use those measurements to design modular processors that entangle several qubit modules at once.';

const JS_SHELL_HOME_HTML =
  '<html><body><div id="root"></div><main><a href="/research">Research</a></main></body></html>';

type PersistedEntity = { fullDescription?: string };

function researchPageHtml(prose: string): string {
  return `<html><body><main><h1>Research</h1><p>${prose}</p></main></body></html>`;
}

describe('an unopposed crawled research page may fill but never replace a description (#2180)', () => {
  let replSet: MongoMemoryReplSet;
  let server: http.Server;
  let siteOrigin = '';
  let researchPageProse = FIGURE_CAPTION;
  const requestedPaths: string[] = [];

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());

    server = http.createServer((req, res) => {
      const path = (req.url || '/').split('?')[0];
      requestedPaths.push(path);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(path === '/' ? JS_SHELL_HOME_HTML : researchPageHtml(researchPageProse));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    siteOrigin = `http://127.0.0.1:${port}`;
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
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
    researchPageProse = FIGURE_CAPTION;
    await Source.create({
      name: SOURCE_NAME,
      displayName: 'Lab microsite LLM (description only)',
      defaultWeight: 0.82,
    });
  });

  const seedEntityWithStoredDescription = async (fullDescription: string) => {
    const entity = await ResearchEntity.create({
      slug: SLUG,
      name: 'Hatridge Lab',
      kind: 'lab',
      websiteUrl: `${siteOrigin}/`,
      fullDescription,
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    if (fullDescription) {
      const source = await Source.findOne({ name: SOURCE_NAME }).lean<{
        _id: mongoose.Types.ObjectId;
      }>();
      await Observation.create({
        entityType: 'researchEntity',
        entityKey: SLUG,
        entityId: String(entity._id),
        field: 'fullDescription',
        value: fullDescription,
        sourceId: source?._id,
        sourceName: SOURCE_NAME,
        sourceUrl: `${siteOrigin}/`,
        confidence: 0.82,
        observedAt: new Date('2026-01-01T00:00:00Z'),
        superseded: false,
      });
    }
    return entity;
  };

  const runSweepAndMaterialize = async () => {
    const orchestrator = new ScraperOrchestrator();
    orchestrator.register(
      new LabMicrositeDescriptionLLMExtractor({
        apiKey: 'test-key',
        fetchPage: async (url: string) => {
          const response = await fetch(url);
          return { url: response.url, html: await response.text() };
        },
        callLLM: async () => ({
          fullDescription: '',
          shortDescription: '',
          topics: [],
          methods: [],
        }),
        callCardLLM: async () => '',
      }),
    );
    await orchestrator.run(SOURCE_NAME, {
      dryRun: false,
      useCache: false,
      release: false,
      only: [SLUG],
      ignoreWorkPlanner: true,
    });
    await materializeEntity('researchEntity', { entityKey: SLUG });
    return ResearchEntity.findOne({ slug: SLUG }).lean<PersistedEntity>();
  };

  it('never lets a figure caption on the crawled research page become the description', async () => {
    await seedEntityWithStoredDescription(GOOD_STORED_DESCRIPTION);

    const persisted = await runSweepAndMaterialize();

    expect(requestedPaths).toContain('/research');
    expect(persisted?.fullDescription).toBe(GOOD_STORED_DESCRIPTION);
    expect(persisted?.fullDescription).not.toContain('aluminum housing');
    const captionObservation = await Observation.findOne({
      entityKey: SLUG,
      field: 'fullDescription',
      value: FIGURE_CAPTION,
    }).lean();
    expect(captionObservation).toBeNull();
  });

  it('fills an empty description from the crawled research page', async () => {
    researchPageProse = RESEARCH_PAGE_PROSE;
    await seedEntityWithStoredDescription('');

    const persisted = await runSweepAndMaterialize();

    expect(persisted?.fullDescription).toBe(RESEARCH_PAGE_PROSE);
  });

  it('reconsiders a suppressed entity on the next sweep after the stored description is cleared', async () => {
    researchPageProse = RESEARCH_PAGE_PROSE;
    await seedEntityWithStoredDescription(GOOD_STORED_DESCRIPTION);

    const afterFirstSweep = await runSweepAndMaterialize();
    expect(afterFirstSweep?.fullDescription).toBe(GOOD_STORED_DESCRIPTION);
    const hashAfterSuppression = await Observation.findOne({
      entityKey: SLUG,
      field: SOURCE_CONTENT_HASH_FIELD,
    }).lean();
    expect(hashAfterSuppression).toBeNull();

    await Observation.deleteMany({ entityKey: SLUG, field: 'fullDescription' });
    await ResearchEntity.updateOne({ slug: SLUG }, { $set: { fullDescription: '' } });

    const afterRepairSweep = await runSweepAndMaterialize();

    expect(afterRepairSweep?.fullDescription).toBe(RESEARCH_PAGE_PROSE);
  });
});
