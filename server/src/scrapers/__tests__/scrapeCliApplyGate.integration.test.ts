import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IScraper } from '../types';

const { FIXTURE_SOURCE, DATABASE_NAME } = vi.hoisted(() => ({
  FIXTURE_SOURCE: 'fixture-apply-gate',
  DATABASE_NAME: 'scrape_apply_gate_test',
}));

vi.mock('../../db/connections', async () => {
  const actual =
    await vi.importActual<typeof import('../../db/connections')>('../../db/connections');
  return {
    ...actual,
    connectScriptMongo: vi.fn(actual.connectScriptMongo),
  };
});

vi.mock('../registry', async () => {
  const { ScraperOrchestrator } =
    await vi.importActual<typeof import('../orchestrator')>('../orchestrator');
  const fixtureScraper: IScraper = {
    name: FIXTURE_SOURCE,
    displayName: 'Fixture apply gate',
    async run(ctx) {
      await ctx.emit({
        entityType: 'orgUnit',
        entityKey: 'fixture-apply-gate-unit',
        field: 'name',
        value: 'Fixture Apply Gate Unit',
        sourceUrl: 'https://fixture-apply-gate.example.edu/',
      });
      return { observationCount: 1, entitiesObserved: 1 };
    },
  };
  return {
    buildOrchestrator: () => {
      const orchestrator = new ScraperOrchestrator();
      orchestrator.register(fixtureScraper);
      return orchestrator;
    },
  };
});

import { connectScriptMongo } from '../../db/connections';
import { main } from '../cli';

describe(
  'scrape run writes only when its command line says --apply (#5842)',
  { timeout: 120000 },
  () => {
    let replSet: MongoMemoryReplSet;
    let client: MongoClient;
    let mongoUrl: string;
    let logLines: string[];
    const originalArgv = process.argv;

    const observationCount = () =>
      client
        .db(DATABASE_NAME)
        .collection('observations')
        .countDocuments({ sourceName: FIXTURE_SOURCE });

    const runCli = (...args: string[]) => {
      process.argv = ['node', 'src/scrapers/cli.ts', ...args];
      return main();
    };

    const bannerLines = () =>
      logLines.filter((line) => line.startsWith('WILL WRITE') || line.startsWith('DRY RUN'));

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      mongoUrl = replSet.getUri(DATABASE_NAME);
      client = await MongoClient.connect(replSet.getUri());
    });

    afterAll(async () => {
      await client?.close();
      await replSet?.stop();
    });

    beforeEach(async () => {
      vi.mocked(connectScriptMongo).mockClear();
      logLines = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logLines.push(args.map(String).join(' '));
      });
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.stubEnv('MONGODBURL', mongoUrl);
      vi.stubEnv('SCRAPER_ENV', 'development');
      vi.stubEnv('SCRAPER_DEVELOPMENT_DB_NAME', DATABASE_NAME);
      vi.stubEnv('ALLOW_NON_PROD_SCRAPER_WRITES', '');
      vi.stubEnv('DIRECTORY_REMOVAL_KEY', 'synthetic-apply-gate-key-0123456789');
      const db = client.db(DATABASE_NAME);
      for (const name of ['observations', 'scrape_runs', 'sources', 'scrape_job_locks']) {
        await db.collection(name).deleteMany({});
      }
      await db.collection('sources').insertOne({
        name: FIXTURE_SOURCE,
        displayName: 'Fixture apply gate',
        defaultWeight: 0.8,
        enabled: true,
      });
    });

    afterEach(() => {
      process.argv = originalArgv;
      process.exitCode = undefined;
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    it('refuses before connecting when only the environment permission is set', async () => {
      vi.stubEnv('ALLOW_NON_PROD_SCRAPER_WRITES', 'true');

      await expect(runCli('run', '--source', FIXTURE_SOURCE, '--release')).rejects.toThrow(
        /ALLOW_NON_PROD_SCRAPER_WRITES permission is granted, but the command line has no --apply/,
      );

      expect(connectScriptMongo).not.toHaveBeenCalled();
      expect(bannerLines()).toEqual([]);
      expect(await observationCount()).toBe(0);
    });

    it('refuses a materialize before connecting when only the environment permission is set', async () => {
      vi.stubEnv('ALLOW_NON_PROD_SCRAPER_WRITES', 'true');

      await expect(
        runCli('materialize', '--run', '0123456789abcdef01234567', '--confirm-materialize'),
      ).rejects.toThrow(/has no --apply/);

      expect(connectScriptMongo).not.toHaveBeenCalled();
    });

    it('refuses --apply before connecting when the environment grants no permission', async () => {
      await expect(
        runCli('run', '--source', FIXTURE_SOURCE, '--release', '--apply'),
      ).rejects.toThrow(/--apply requires the ALLOW_NON_PROD_SCRAPER_WRITES permission/);

      expect(connectScriptMongo).not.toHaveBeenCalled();
    });

    it('writes when the environment permission and --apply are both present', async () => {
      vi.stubEnv('ALLOW_NON_PROD_SCRAPER_WRITES', 'true');

      await runCli('run', '--source', FIXTURE_SOURCE, '--release', '--apply');

      expect(await observationCount()).toBe(1);
      expect(bannerLines()).toEqual([
        `WILL WRITE to ${DATABASE_NAME} (scrape run --apply with the ALLOW_NON_PROD_SCRAPER_WRITES permission)`,
      ]);
      expect(vi.mocked(console.log).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(connectScriptMongo).mock.invocationCallOrder[0],
      );
    });

    it('is a dry run when neither the permission nor --apply is present', async () => {
      await runCli('run', '--source', FIXTURE_SOURCE, '--release');

      expect(connectScriptMongo).toHaveBeenCalledTimes(1);
      expect(await observationCount()).toBe(0);
      expect(bannerLines()).toEqual([
        'DRY RUN: nothing will be written (no --apply); observations and entities stay untouched, only the run bookkeeping row is recorded',
      ]);
      expect(vi.mocked(console.log).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(connectScriptMongo).mock.invocationCallOrder[0],
      );
    });

    it('is a dry run under --dry-run even when the permission is set', async () => {
      vi.stubEnv('ALLOW_NON_PROD_SCRAPER_WRITES', 'true');

      await runCli('run', '--source', FIXTURE_SOURCE, '--release', '--dry-run');

      expect(await observationCount()).toBe(0);
      expect(bannerLines()).toEqual([
        'DRY RUN: nothing will be written (--dry-run); observations and entities stay untouched, only the run bookkeeping row is recorded',
      ]);
    });
  },
);
