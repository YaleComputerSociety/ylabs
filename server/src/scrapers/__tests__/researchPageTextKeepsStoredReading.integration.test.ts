import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ResearchPageTextScraper } from '../sources/researchPageTextScraper';
import type { CandidateDescriptionLab } from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';
import { HttpStatusError } from '../utils/httpFetch';
import { RESEARCH_PAGE_TEXT_FIELD, RESEARCH_PAGE_TEXT_SOURCE } from '../utils/researchPageText';

const HOME = 'https://tidepool-lab.example.org/';
const PARTNER = 'https://www.partner-site.example.org/kelp/';
const ENTITY_ID = new mongoose.Types.ObjectId();

const row: CandidateDescriptionLab = {
  _id: String(ENTITY_ID),
  slug: 'synthetic-tidepool-lab',
  name: 'Synthetic Tidepool Lab',
  websiteUrl: HOME,
  sourceUrls: [HOME, PARTNER],
  entityType: 'LAB',
};

const body = `<html><body><h1>Research</h1><p>We study how kelp forests recover after marine heatwaves along the coast, and the group shares its survey data openly with the community.</p></body></html>`;

const storedReading = (urls: string[], superseded = false) => ({
  entityType: 'researchEntity',
  entityId: ENTITY_ID,
  field: RESEARCH_PAGE_TEXT_FIELD,
  sourceName: RESEARCH_PAGE_TEXT_SOURCE,
  superseded,
  observedAt: new Date('2026-11-11T12:00:00Z'),
  value: urls.map((url) => ({ url, text: 'Stored research text.' })),
});

async function runWithPartnerThrottled() {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: RESEARCH_PAGE_TEXT_SOURCE,
    sourceWeight: 0.85,
    options: { dryRun: false, useCache: false, release: false },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => undefined,
  };
  const lane = new ResearchPageTextScraper({
    fetchPage: async (url: string) => {
      if (url === PARTNER) throw new HttpStatusError(429);
      return url === HOME ? { url, html: body } : null;
    },
    rowFinder: async () => [row],
    storedHashLoader: async () => 'stored-hash',
    citerCountsLoader: async () => new Map(),
  });
  await lane.run(ctx);
  return emitted;
}

let server: MongoMemoryServer;
const observations = () => mongoose.connection.db!.collection('observations');

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(), { autoIndex: false });
});

afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});

beforeEach(async () => {
  await observations().deleteMany({});
});

describe('research-page-text reads the stored reading it keeps', () => {
  it('keeps the stored reading when it drew on the throttled host, matched across www', async () => {
    await observations().insertOne(storedReading([HOME, 'https://partner-site.example.org/kelp/']));

    expect(await runWithPartnerThrottled()).toEqual([]);
  });

  it('stores a new reading when the current stored one never drew on the throttled host', async () => {
    await observations().insertMany([storedReading([HOME, PARTNER], true), storedReading([HOME])]);

    const emitted = await runWithPartnerThrottled();

    expect(emitted.some((observation) => observation.field === RESEARCH_PAGE_TEXT_FIELD)).toBe(
      true,
    );
  });
});
