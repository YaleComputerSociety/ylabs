/**
 * #3452 end to end for the YSE lane, against a real store: a lab withdrawn on a dead
 * link stops serving the websiteUrl this lane asserted while it still believed the
 * link. Runs go through `YseFacultyDirectoryScraper.run` -> `appendObservations` ->
 * `materializeEntity` -> `reconcileFieldRetractions` with only the network stubbed.
 */
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
import { ScrapeRun } from '../../models/scrapeRun';
import { fieldValueRefusalKey } from '../../utils/researchEntityFieldValueRefusals';
import { materializeEntity } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import { reconcileFieldRetractions } from '../fieldRetraction';
import { YseFacultyDirectoryScraper } from '../sources/yseFacultyDirectoryScraper';
import type { ObservationInput, ScraperContext } from '../types';
import { loadLabUrlEvidenceBySlug, type LabUrlEvidence } from '../utils/labUrlEvidence';

const SOURCE_NAME = 'yse-faculty-directory';
const SOURCE_ID = new mongoose.Types.ObjectId();
const DIRECTORY_URL = 'https://environment.yale.edu/directory/faculty';
const PROFILE_URL = 'https://environment.yale.edu/directory/faculty/jordan-rivers';
const ENTITY_KEY = 'yse-faculty-jordan-rivers';
const LAB_URL = 'https://riverslab.example.org/';

const DIRECTORY_HTML = `<html><body><main><li><article class="profile__item">
  <div class="profile__segment--name"><h2><a href="/directory/faculty/jordan-rivers">Jordan Rivers</a></h2></div>
</article></li></main></body></html>`;

function profileHtml(options: { bare: boolean }): string {
  const areas = options.bare
    ? ''
    : `<div class="profile__info"><div class="eyebrow">Areas of Expertise</div>
        <div class="term-tree-list"><ul class="term">
          <li><a href="/experts-guide/water-resources">Water Resources</a></li>
        </ul></div></div>`;
  const description = options.bare
    ? ''
    : `<div class="wysiwyg"><p>Professor Rivers studies wetland carbon dynamics and coastal restoration across changing climates.</p></div>`;
  return `<html><body><main class="main-content">
  <section class="profile flexhero">
    <h1>Jordan Rivers</h1>
    <div class="intro-text profile__position"><p><span class="semijoin">Professor of Wetland Ecology</span></p></div>
    <aside>
      <div class="profile__info"><div class="eyebrow">Contact</div>
        <p><a href="mailto:jordan.rivers@yale.edu">jordan.rivers@yale.edu</a></p></div>
      ${areas}
      <div class="profile__info"><div class="eyebrow">Links</div>
        <ul><li><a href="https://riverslab.example.org" rel="nofollow">Lab Website</a></li></ul></div>
    </aside>
  </section>
  <div class="grid-container"><div class="cell medium-8">${description}</div></div>
</main></body></html>`;
}

type LinkState = 'live' | 'dead' | 'refused';

async function runLane(
  link: LinkState,
  options: { bare?: boolean } = {},
): Promise<ObservationInput[]> {
  const html = profileHtml({ bare: options.bare === true });
  const fetcher = async (url: string) => {
    if (url === DIRECTORY_URL) return DIRECTORY_HTML;
    if (url === PROFILE_URL) return html;
    throw new Error(`unexpected url ${url}`);
  };
  const refusedEvidence = () =>
    new Map<string, LabUrlEvidence>([
      [
        ENTITY_KEY,
        {
          fieldValueRefusals: {
            websiteUrl: [
              {
                valueKey: fieldValueRefusalKey('websiteUrl', LAB_URL),
                rule: 'wrong_owner',
                refusedBy: 'research-entity:refuse-field-value',
                refusedAt: new Date('2026-09-24T00:00:00Z'),
              },
            ],
          },
        },
      ],
    ]);
  const evidence = async (slugs: string[]) =>
    link === 'refused' ? refusedEvidence() : loadLabUrlEvidenceBySlug(slugs);
  const prober = async (url: string) => link === 'dead' && url === LAB_URL;
  const scraper = new YseFacultyDirectoryScraper(fetcher, evidence, prober);

  const run = await ScrapeRun.create({
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    status: 'success',
    startedAt: new Date(),
  });
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: String(run._id),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    options: { dryRun: false, useCache: false, release: false },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => {},
  };
  await scraper.run(ctx);
  const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
  if (entityObs.length > 0) {
    await appendObservations(entityObs, {
      scrapeRunId: String(run._id),
      sourceId: String(SOURCE_ID),
      sourceName: SOURCE_NAME,
      sourceWeight: 0.8,
      dryRun: false,
    });
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});
  }
  return entityObs;
}

const storedRow = () =>
  ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{
    entityType?: string;
    kind?: string;
    name?: string;
    websiteUrl?: unknown;
  }>();

const liveWebsiteUrlObservations = () =>
  Observation.find({
    entityType: 'researchEntity',
    entityKey: ENTITY_KEY,
    field: 'websiteUrl',
    superseded: { $ne: true },
  }).lean();

const deadProbe = async () => ({ positivelyDead: true });

describe('a YSE lab withdrawn on a dead link stops serving its websiteUrl (#3452)', () => {
  let replSet: MongoMemoryReplSet;
  const originalFlag = process.env.SCRAPER_FIELD_RETRACTION;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 120000);

  afterAll(async () => {
    process.env.SCRAPER_FIELD_RETRACTION = originalFlag;
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    process.env.SCRAPER_FIELD_RETRACTION = 'true';
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    await ScrapeRun.deleteMany({});
  });

  it('retracts the stale websiteUrl after two dead reads, and a rematerialization keeps it gone', async () => {
    await runLane('live');
    expect((await storedRow())?.entityType).toBe('LAB');
    expect((await storedRow())?.websiteUrl).toBe(LAB_URL);

    const deadRead = await runLane('dead');
    expect(deadRead.find((o) => o.field === 'slug')?.assertsNoValueFor).toEqual(['websiteUrl']);
    await runLane('dead');
    const before = await storedRow();
    expect(before?.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(before?.websiteUrl).toBe(LAB_URL);

    const result = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      probeValue: deadProbe,
    });
    expect(result.outcome).toBe('reconciled');
    expect(result.counts.retractedObservations).toBe(1);

    const after = await storedRow();
    expect(after?.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(after?.name).toBe('Jordan Rivers Faculty Research');
    expect(after?.websiteUrl).toBeUndefined();
    expect(await liveWebsiteUrlObservations()).toHaveLength(0);

    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});
    expect((await storedRow())?.websiteUrl).toBeUndefined();
  }, 120000);

  it('waits for a second dead read before retracting', async () => {
    await runLane('live');
    await runLane('dead');
    const result = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      probeValue: deadProbe,
    });
    expect(result.counts.retractedObservations).toBe(0);
    expect((await storedRow())?.websiteUrl).toBe(LAB_URL);
  }, 120000);

  it('retracts nothing when the link is refused rather than dead (#2647)', async () => {
    await runLane('live');
    const refusedRead = await runLane('refused');
    expect(refusedRead.some((o) => o.assertsNoValueFor)).toBe(false);
    await runLane('refused');
    const result = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      probeValue: deadProbe,
    });
    expect(result.counts.retractedObservations).toBe(0);
    expect(await liveWebsiteUrlObservations()).toHaveLength(1);
  }, 120000);

  it('withholds the retraction when the reconcile-time probe finds the site still answers', async () => {
    await runLane('live');
    await runLane('dead');
    await runLane('dead');
    const result = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      probeValue: async () => ({ positivelyDead: false }),
    });
    expect(result.counts.soleHolderValueWithheld).toBe(1);
    expect((await storedRow())?.websiteUrl).toBe(LAB_URL);
    expect(await liveWebsiteUrlObservations()).toHaveLength(1);
  }, 120000);

  it('also retracts for a bare profile whose dead lab link was its only content', async () => {
    await runLane('live', { bare: true });
    expect((await storedRow())?.websiteUrl).toBe(LAB_URL);
    await runLane('dead', { bare: true });
    await runLane('dead', { bare: true });
    const result = await reconcileFieldRetractions({
      sourceName: SOURCE_NAME,
      probeValue: deadProbe,
    });
    expect(result.counts.retractedObservations).toBe(1);
    const after = await storedRow();
    expect(after?.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(after?.websiteUrl).toBeUndefined();
  }, 120000);
});
