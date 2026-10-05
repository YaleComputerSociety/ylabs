import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meili = vi.hoisted(() => ({
  search: vi.fn(),
  getEmbedders: vi.fn(),
  searchSimilarDocuments: vi.fn(),
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliSearchIndex: vi.fn(async () => ({
    search: meili.search,
    getEmbedders: meili.getEmbedders,
    searchSimilarDocuments: meili.searchSimilarDocuments,
  })),
}));

vi.mock('../../utils/errorTracking', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/errorTracking')>()),
  captureServerError: vi.fn(),
  captureServerWarning: vi.fn(),
}));

import apiRouter from '../../routes';
import { errorHandler } from '../../middleware/errorHandler';
import { ResearchEntity } from '../../models/researchEntity';
import { mongoOptions } from '../../db/connections';
import {
  MEILISEARCH_UNAVAILABLE_COOLDOWN_MS,
  resetMeiliAvailability,
} from '../../utils/meiliAvailability';
import {
  RESEARCH_ENTITY_SEARCH_EMBEDDER_UNKNOWN_CACHE_TTL_MS,
  invalidateResearchEntitySearchEmbedderCache,
} from '../researchEntitySearchIndexService';

const DATABASE = 'meilisearch_stall_fails_fast_after_first_timeout_test';
const SLUG = 'synthetic-tidal-sediment-lab';

const SERVABLE_SHORT =
  'Studies how coastal wetland sediments store carbon across tidal and seasonal cycles.';
const SERVABLE_FULL =
  'The lab studies how coastal wetland sediments store carbon across tidal and seasonal cycles, combining field coring, isotope tracing, and long-term plot experiments to estimate how sea-level rise changes burial rates.';

let memoryServer: MongoMemoryServer | undefined;
let server: Server | undefined;
let baseUrl = '';

const timedOut = () =>
  Object.assign(new Error('Request to http://127.0.0.1:7700/indexes has failed'), {
    name: 'MeilisearchRequestError',
    cause: Object.assign(new Error('request timed out after 5000ms'), {
      name: 'MeilisearchRequestTimeOutError',
    }),
  });

const getDetail = async () => {
  const response = await fetch(`${baseUrl}/api/research/${SLUG}`);
  return { status: response.status, payload: (await response.json()) as Record<string, any> };
};

const textSearch = async () => {
  const response = await fetch(`${baseUrl}/api/research/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: 'wetland carbon' }),
  });
  return { status: response.status };
};

const meiliCallCount = () =>
  meili.search.mock.calls.length +
  meili.getEmbedders.mock.calls.length +
  meili.searchSimilarDocuments.mock.calls.length;

describe('requests while Meilisearch is timing out', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri(DATABASE), mongoOptions);
    await ResearchEntity.collection.insertOne({
      schemaVersion: 1,
      slug: SLUG,
      name: 'Synthetic Tidal Sediment Lab',
      kind: 'lab',
      entityType: 'LAB',
      shortDescription: SERVABLE_SHORT,
      fullDescription: SERVABLE_FULL,
      departments: ['Earth and Planetary Sciences'],
      schools: ['Faculty of Arts and Sciences'],
      researchAreas: ['carbon cycling'],
      archived: false,
      studentVisibilityTier: 'student_ready',
    });

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    app.use(errorHandler);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    resetMeiliAvailability();
    invalidateResearchEntitySearchEmbedderCache();
    for (const call of Object.values(meili)) {
      call.mockReset();
      call.mockRejectedValue(timedOut());
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks Meilisearch once for three detail pages, then serves them without the rail', async () => {
    const answers = [await getDetail(), await getDetail(), await getDetail()];

    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);
    for (const answer of answers) expect(answer.payload.similarResearchEntities ?? []).toEqual([]);
    expect(meili.getEmbedders).toHaveBeenCalledTimes(1);
    expect(meiliCallCount()).toBe(1);
  }, 20000);

  it('answers later text searches with a 503 without calling Meilisearch again', async () => {
    const answers = [await textSearch(), await textSearch(), await textSearch()];

    expect(answers.map((answer) => answer.status)).toEqual([503, 503, 503]);
    expect(meiliCallCount()).toBe(1);
  }, 20000);

  it('asks Meilisearch again once the cooldown has passed, and serves the rail', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-03T12:00:00Z') });
    await getDetail();
    expect(meiliCallCount()).toBe(1);

    const stored = await ResearchEntity.findOne({ slug: SLUG }).lean();
    const twin = await ResearchEntity.create({
      schemaVersion: 1,
      slug: 'synthetic-salt-marsh-lab',
      name: 'Synthetic Salt Marsh Lab',
      kind: 'lab',
      entityType: 'LAB',
      shortDescription: SERVABLE_SHORT,
      fullDescription: SERVABLE_FULL,
      departments: ['Earth and Planetary Sciences'],
      archived: false,
      studentVisibilityTier: 'student_ready',
    });
    meili.getEmbedders.mockReset();
    meili.getEmbedders.mockResolvedValue({ default: { source: 'openAi' } });
    meili.searchSimilarDocuments.mockReset();
    meili.searchSimilarDocuments.mockResolvedValue({
      hits: [{ id: String(twin._id), slug: twin.slug, _rankingScore: 0.9 }],
    });

    vi.setSystemTime(
      Date.now() +
        Math.max(
          MEILISEARCH_UNAVAILABLE_COOLDOWN_MS,
          RESEARCH_ENTITY_SEARCH_EMBEDDER_UNKNOWN_CACHE_TTL_MS,
        ) +
        1,
    );
    const recovered = await getDetail();

    expect(stored).toBeTruthy();
    expect(meili.getEmbedders).toHaveBeenCalledTimes(1);
    expect(meili.searchSimilarDocuments).toHaveBeenCalledTimes(1);
    expect(recovered.status).toBe(200);
    expect(
      (recovered.payload.similarResearchEntities ?? []).map((entity: any) => entity.slug),
    ).toEqual(['synthetic-salt-marsh-lab']);
    await ResearchEntity.deleteOne({ _id: twin._id });
  }, 20000);
});
