import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasActiveAdminGrant: vi.fn(async () => true),
}));

vi.mock('../../services/adminGrantService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/adminGrantService')>()),
  hasActiveAdminGrant: mocks.hasActiveAdminGrant,
}));

import router from '../analytics';
import { EngineBenchmarkSnapshot } from '../../models/engineBenchmarkSnapshot';
import { SWEEP_ENGINE_BENCHMARK_ID } from '../../services/engineBenchmarkTrendCore';

const route = (router as any).stack
  .map((layer: any) => layer.route)
  .find((candidate: any) => candidate?.path === '/lane-benchmarks');

const dispatch = () =>
  new Promise<any>((resolve, reject) => {
    const request = { query: {}, params: {}, user: { netId: 'test123' } };
    const response = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        resolve(this);
        return this;
      },
    } as any;
    const step = (index: number) => {
      void route.stack[index].handle(request, response, (error?: unknown) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        step(index + 1);
      });
    };
    step(0);
  });

const snapshot = (overrides: Record<string, unknown>) => ({
  environment: 'test',
  databaseName: 'lane_benchmarks_engine_route_test',
  benchmarkId: SWEEP_ENGINE_BENCHMARK_ID,
  stage: 'resolve-and-gate',
  rowsReplayed: 12,
  rowsWithIncompleteInput: 0,
  invalidatedRunSetChanged: false,
  resolved: 40,
  cleared: 2,
  knownWrong: 1,
  labelsMatched: 3,
  labelCount: 4,
  outputFingerprint: 'fingerprint-a',
  ...overrides,
});

describe('GET /api/analytics/lane-benchmarks engine benchmarks (#4605)', () => {
  let memoryServer: MongoMemoryServer | undefined;

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('lane_benchmarks_engine_route_test'));
    await EngineBenchmarkSnapshot.create([
      snapshot({ measuredAt: new Date('2026-09-01T00:00:00.000Z'), codeSha: 'aaa' }),
      snapshot({
        measuredAt: new Date('2026-09-02T00:00:00.000Z'),
        codeSha: 'bbb',
        resolved: 44,
        outputFingerprint: 'fingerprint-b',
      }),
      snapshot({
        benchmarkId: 'engine-synthetic-leak',
        measuredAt: new Date('2026-09-01T00:00:00.000Z'),
        codeSha: 'aaa',
      }),
      snapshot({
        benchmarkId: 'engine-synthetic-leak',
        measuredAt: new Date('2026-09-03T00:00:00.000Z'),
        codeSha: 'ccc',
        rowsWithIncompleteInput: 1,
        outputFingerprint: 'fingerprint-c',
      }),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('serves the sweep engine benchmark as its latest replay and counts the one-off probe it leaves off', async () => {
    const res = await dispatch();

    expect(res.statusCode).toBe(200);
    expect(res.body.benchmarks).toEqual([]);
    expect(res.body.engine.measurementCollection).toBe('engine_benchmark_snapshots');
    expect(res.body.engine.benchmarks).toHaveLength(1);
    expect(res.body.engine.benchmarks[0]).toMatchObject({
      benchmarkId: SWEEP_ENGINE_BENCHMARK_ID,
      stage: 'resolve-and-gate',
      runs: 2,
      change: 'code-changed',
      latest: { codeSha: 'bbb', resolved: 44, outputFingerprint: 'fingerprint-b' },
      previous: { codeSha: 'aaa', resolved: 40 },
    });
    expect(res.body.engine.oneOffBenchmarkCount).toBe(1);
  });
});
