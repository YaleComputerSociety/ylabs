import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { appendObservations } from '../observationStore';
import {
  BBS_TRACKS,
  BbsResearchTrackScraper,
  bbsGraftObservations,
} from '../sources/bbsResearchTrackScraper';
import type { ScraperContext, ScraperResult } from '../types';

const SOURCE_NAME = 'bbs-research-track';
const SOURCE_ID = new mongoose.Types.ObjectId();
const OTHER_SOURCE_ID = new mongoose.Types.ObjectId();
const PROFILE_URL = 'https://medicine.yale.edu/bbs/profile/sample_pi/';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  await Observation.deleteMany({});
  await ScrapeRun.deleteMany({});
});

function track(slug: string) {
  const found = BBS_TRACKS.find((entry) => entry.slug === slug);
  if (!found) throw new Error(`no track ${slug}`);
  return found;
}

async function storeGraft(trackSlug: string, sourceId: mongoose.Types.ObjectId): Promise<void> {
  const run = await ScrapeRun.create({
    sourceId,
    sourceName: SOURCE_NAME,
    status: 'success',
    startedAt: new Date(),
  });
  await appendObservations(
    bbsGraftObservations(
      String(new mongoose.Types.ObjectId()),
      track(trackSlug).researchAreas,
      PROFILE_URL,
    ),
    {
      scrapeRunId: String(run._id),
      sourceId: String(sourceId),
      sourceName: SOURCE_NAME,
      sourceWeight: 0.65,
      dryRun: false,
    },
  );
}

function emptyTrackScraper(): BbsResearchTrackScraper {
  return new BbsResearchTrackScraper({
    fetchPage: async () => '<html><body><table></table></body></html>',
    entityFinder: async () => [],
  });
}

function contextFor(only: string[]): ScraperContext {
  return {
    scrapeRunId: String(new mongoose.Types.ObjectId()),
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.65,
    options: { dryRun: true, useCache: false, release: false, only },
    emit: async () => {},
    log: () => {},
  };
}

async function runEmptyTrack(trackSlug: string): Promise<ScraperResult> {
  return emptyTrackScraper().run(contextFor([trackSlug]));
}

describe('an empty BBS track against stored history', () => {
  it('fails the stage when this lane has grafted from the track before', async () => {
    await storeGraft('plantmolbio', SOURCE_ID);
    expect(await Observation.countDocuments({ sourceId: SOURCE_ID })).toBeGreaterThan(0);

    const result = await runEmptyTrack('plantmolbio');

    expect(result.partialFailures).toHaveLength(1);
    expect(result.partialFailures?.[0]).toContain('plantmolbio');
  });

  it('does not fail the stage when the only stored grafts came from another track', async () => {
    await storeGraft('immunology', SOURCE_ID);

    const result = await runEmptyTrack('plantmolbio');

    expect(result.partialFailures ?? []).toEqual([]);
  });

  it('does not fail the stage when the track topic was stored by another source', async () => {
    await storeGraft('plantmolbio', OTHER_SOURCE_ID);

    const result = await runEmptyTrack('plantmolbio');

    expect(result.partialFailures ?? []).toEqual([]);
  });

  it('does not repeat a previous run failure on the same scraper instance', async () => {
    await storeGraft('plantmolbio', SOURCE_ID);
    const scraper = emptyTrackScraper();

    expect((await scraper.run(contextFor(['plantmolbio']))).partialFailures).toHaveLength(1);
    expect((await scraper.run(contextFor(['immunology']))).partialFailures ?? []).toEqual([]);
  });
});
