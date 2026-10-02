import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meili = vi.hoisted(() => ({
  search: vi.fn(),
  getEmbedders: vi.fn(),
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: vi.fn(async () => ({
    search: meili.search,
    getEmbedders: meili.getEmbedders,
  })),
}));

vi.mock('../../utils/errorTracking', () => ({
  captureServerError: vi.fn(),
}));

import apiRouter from '../../routes';
import { errorHandler } from '../../middleware/errorHandler';
import { ResearchEntity } from '../../models/researchEntity';
import { mongoOptions } from '../../db/connections';

const DATABASE = 'search_answers_503_when_meilisearch_is_unreachable_test';
const FAST_ANSWER_MS = 2000;

const SERVABLE_SHORT =
  'Studies how coastal wetland sediments store carbon across tidal and seasonal cycles.';
const SERVABLE_FULL =
  'The lab studies how coastal wetland sediments store carbon across tidal and seasonal cycles, combining field coring, isotope tracing, and long-term plot experiments to estimate how sea-level rise changes burial rates.';

let memoryServer: MongoMemoryServer | undefined;
let server: Server | undefined;
let baseUrl = '';

const unreachable = () =>
  Object.assign(new Error('fetch failed'), {
    name: 'MeilisearchRequestError',
    cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:7700'), {
      code: 'ECONNREFUSED',
    }),
  });

const search = async (body: Record<string, unknown>) => {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/api/research/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  return {
    status: response.status,
    retryAfter: response.headers.get('retry-after'),
    payload,
    elapsedMs: Date.now() - startedAt,
  };
};

describe('a research search while Meilisearch is unreachable', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri(DATABASE), mongoOptions);
    await ResearchEntity.collection.insertMany(
      Array.from({ length: 3 }, (_unused, index) => ({
        schemaVersion: 1,
        slug: `synthetic-wetland-carbon-lab-${index + 1}`,
        name: `Synthetic Wetland Carbon Lab ${index + 1}`,
        kind: 'lab',
        entityType: 'LAB',
        shortDescription: SERVABLE_SHORT,
        fullDescription: SERVABLE_FULL,
        departments: ['Earth and Planetary Sciences'],
        schools: ['Faculty of Arts and Sciences'],
        researchAreas: ['carbon cycling'],
        archived: false,
        studentVisibilityTier: 'student_ready',
      })),
    );

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
    meili.search.mockReset();
    meili.search.mockRejectedValue(unreachable());
    meili.getEmbedders.mockReset();
    meili.getEmbedders.mockRejectedValue(unreachable());
  });

  it.each([
    ['an empty browse', { q: '' }],
    [
      'a browse with two filters',
      {
        q: '',
        filters: {
          departments: ['Earth and Planetary Sciences'],
          school: ['Faculty of Arts and Sciences'],
        },
      },
    ],
    ['a text search', { q: 'wetland carbon' }],
  ])(
    'answers %s with a fast 503 and a retry hint instead of reading the corpus',
    async (_label, body) => {
      const corpusReads = vi.spyOn(ResearchEntity, 'find');

      const answer = await search(body);

      expect(answer.status).toBe(503);
      expect(Number(answer.retryAfter)).toBeGreaterThan(0);
      expect(answer.payload).toEqual({ error: 'Service temporarily unavailable' });
      expect(answer.elapsedMs).toBeLessThan(FAST_ANSWER_MS);
      expect(corpusReads).not.toHaveBeenCalled();
    },
    20000,
  );

  it('still serves the corpus once Meilisearch answers again', async () => {
    const stored = await ResearchEntity.find({}).select({ _id: 1 }).lean();
    meili.getEmbedders.mockResolvedValue({});
    meili.search.mockResolvedValue({
      hits: stored.map((row) => ({ id: String(row._id) })),
      estimatedTotalHits: stored.length,
      totalHits: stored.length,
      facetDistribution: {},
    });

    const answer = await search({ q: '' });

    expect(answer.status).toBe(200);
    expect(answer.payload.estimatedTotalHits).toBe(3);
  }, 20000);
});
