import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  buildScrapeCanaryChildArgs,
  evaluateStorageHeadroom,
  formatSweepPreflightReport,
  measureClusterStorage,
  resolveSweepPreflightConfig,
  runSweepPreflight,
  type CanaryChildRunner,
} from '../scraperSweepPreflight';
import { parseScrapeCanaryArgs } from '../scrapeCanary';

const config = {
  clusterQuotaMb: 5120,
  minHeadroomMb: 1024,
  canaryLimit: 5,
  canaryTimeoutMs: 1000,
  canaryConcurrency: 4,
};

function outputOf(args: string[]): string {
  return args[args.indexOf('--output') + 1];
}

function sourceOf(args: string[]): string {
  return args[args.indexOf('--source') + 1];
}

describe('sweep preflight', () => {
  let mongod: MongoMemoryServer;
  let mongoUrl: string;
  const directories: string[] = [];

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    mongoUrl = mongod.getUri('Development');
    const connection = await mongoose.createConnection(mongoUrl).asPromise();
    await connection.useDb('Development').collection('observations').insertOne({ field: 'name' });
    await connection.useDb('Beta').collection('research_entities').insertOne({ name: 'x' });
    await connection.close();
  }, 120_000);

  afterAll(async () => {
    await mongod.stop();
  });

  afterEach(() => {
    for (const directory of directories.splice(0))
      fs.rmSync(directory, { recursive: true, force: true });
  });

  const tempDirectory = (): string => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ylabs-preflight-test-'));
    directories.push(directory);
    return directory;
  };

  it('defaults to the shared-tier quota and refuses nonsense overrides', () => {
    expect(resolveSweepPreflightConfig({})).toMatchObject({
      clusterQuotaMb: 5120,
      minHeadroomMb: 1024,
      canaryLimit: 5,
    });
    expect(
      resolveSweepPreflightConfig({ SCRAPER_SWEEP_MIN_HEADROOM_MB: '2048' }).minHeadroomMb,
    ).toBe(2048);
    expect(() => resolveSweepPreflightConfig({ SCRAPER_SWEEP_CLUSTER_QUOTA_MB: '-1' })).toThrow();
  });

  it('fails headroom below the floor and passes above it', () => {
    expect(evaluateStorageHeadroom({ usedMb: 4463 }, config)).toMatchObject({ ok: false });
    expect(evaluateStorageHeadroom({ usedMb: 3200 }, config)).toMatchObject({
      ok: true,
      headroomMb: 1920,
    });
  });

  it('measures every non-system database on the cluster, because they share one quota', async () => {
    const connection = await mongoose.createConnection(mongoUrl).asPromise();
    try {
      const storage = await measureClusterStorage(connection);
      const names = storage.databases.map((database) => database.name);
      expect(names).toEqual(expect.arrayContaining(['Beta', 'Development']));
      expect(names).not.toContain('admin');
      expect(storage.usedMb).toBeGreaterThan(0);
    } finally {
      await connection.close();
    }
  });

  it('runs one canary child per source and fails on a broken lane, a missing report, or no headroom', async () => {
    const outputDirectory = tempDirectory();
    const calls: string[][] = [];
    const runner: CanaryChildRunner = async (_command, args, options) => {
      calls.push(args);
      expect(options.timeoutMs).toBe(config.canaryTimeoutMs);
      const sourceName = sourceOf(args);
      if (sourceName === 'slow-lane') return { status: null, timedOut: true };
      if (sourceName === 'crashing-lane') return { status: 1 };
      const verdict = sourceName === 'broken-lane' ? 'failed' : 'passed';
      fs.writeFileSync(
        outputOf(args),
        JSON.stringify({
          sourceName,
          verdict,
          reason: `${verdict} fixture`,
          observationCount: verdict === 'passed' ? 3 : 0,
          limit: 5,
          entitiesObserved: 1,
          durationMs: 10,
          refusedWrites: [],
        }),
      );
      return { status: verdict === 'failed' ? 1 : 0 };
    };

    const report = await runSweepPreflight({
      mongoUrl,
      sourceNames: ['healthy-lane', 'broken-lane', 'slow-lane', 'crashing-lane'],
      outputDirectory,
      repoRoot: outputDirectory,
      childRunner: runner,
      config: { ...config, clusterQuotaMb: 0.001, minHeadroomMb: 1 },
    });

    expect(calls.map(sourceOf).sort()).toEqual([
      'broken-lane',
      'crashing-lane',
      'healthy-lane',
      'slow-lane',
    ]);
    expect(calls[0]).toEqual(buildScrapeCanaryChildArgs(sourceOf(calls[0]), 5, outputOf(calls[0])));
    expect(report.status).toBe('failed');
    expect(
      Object.fromEntries(report.canaries.map((canary) => [canary.sourceName, canary.verdict])),
    ).toEqual({
      'healthy-lane': 'passed',
      'broken-lane': 'failed',
      'slow-lane': 'inconclusive',
      'crashing-lane': 'failed',
    });
    expect(report.failures).toHaveLength(3);
    expect(report.failures[0]).toContain('storage headroom');
    expect(
      JSON.parse(fs.readFileSync(path.join(outputDirectory, 'preflight.json'), 'utf8')).status,
    ).toBe('failed');
    expect(formatSweepPreflightReport(report)).toContain('--skip-preflight');
  });

  it('passes when storage has headroom and no canary failed', async () => {
    const outputDirectory = tempDirectory();
    const runner: CanaryChildRunner = async (_command, args) => {
      fs.writeFileSync(
        outputOf(args),
        JSON.stringify({
          sourceName: sourceOf(args),
          verdict: 'inconclusive',
          reason: 'zero in bounded run',
          observationCount: 0,
        }),
      );
      return { status: 0 };
    };
    const report = await runSweepPreflight({
      mongoUrl,
      sourceNames: ['quiet-lane'],
      outputDirectory,
      repoRoot: outputDirectory,
      childRunner: runner,
      config,
    });
    expect(report.status).toBe('passed');
    expect(report.storage?.ok).toBe(true);
  });

  it('threads a force-llm sweep into each canary child, as the real child runs', async () => {
    const outputDirectory = tempDirectory();
    const calls: string[][] = [];
    const runner: CanaryChildRunner = async (_command, args) => {
      calls.push(args);
      return { status: 0 };
    };
    await runSweepPreflight({
      mongoUrl,
      sourceNames: ['llm-lane'],
      outputDirectory,
      repoRoot: outputDirectory,
      childRunner: runner,
      forceLlm: true,
      config,
    });
    const canaryArgs = calls[0].slice(calls[0].indexOf('scrape:canary') + 1);
    expect(parseScrapeCanaryArgs(canaryArgs)).toMatchObject({
      sourceName: 'llm-lane',
      limit: 5,
      forceLlm: true,
    });
  });

  it('fails closed when storage cannot be measured', async () => {
    const outputDirectory = tempDirectory();
    const report = await runSweepPreflight({
      mongoUrl,
      sourceNames: [],
      outputDirectory,
      repoRoot: outputDirectory,
      childRunner: async () => ({ status: 0 }),
      config,
      connect: async () => {
        throw new Error('not authorized on admin to execute command { listDatabases }');
      },
    });
    expect(report.status).toBe('failed');
    expect(report.failures[0]).toContain('could not be measured');
  });
});
