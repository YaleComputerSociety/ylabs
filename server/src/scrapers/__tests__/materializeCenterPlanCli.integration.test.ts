import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const orchestratorStub = vi.hoisted(() => ({
  run: vi.fn(async (..._args: unknown[]): Promise<unknown> => {
    throw new Error('the stub orchestrator was asked to run a scrape');
  }),
}));

vi.mock('../registry', () => ({
  buildOrchestrator: () => ({ list: () => [], run: orchestratorStub.run }),
}));

import { main } from '../cli';
import { CENTER_PLAN_HELD_BACK_EXIT_CODE } from '../centerPlanGuard';

const DATABASE_NAME = 'scrape_center_plan_cli_test';
const ROW_SLUG = 'center-fixture-plan-cli';

describe(
  'scrape materialize holds a Development center roster apply to an approved plan (#6348)',
  { timeout: 120000 },
  () => {
    let replSet: MongoMemoryReplSet;
    let client: MongoClient;
    let mongoUrl: string;
    let runId: ObjectId;
    let sourceId: ObjectId;
    let outputDir: string;
    let errors: string[];
    const originalArgv = process.argv;

    const db = () => client.db(DATABASE_NAME);
    const storedRow = () => db().collection('research_entities').findOne({ slug: ROW_SLUG });

    const materialize = (...args: string[]) => {
      process.argv = [
        'node',
        'src/scrapers/cli.ts',
        'materialize',
        '--run',
        String(runId),
        ...args,
      ];
      return main();
    };
    const apply = (...extraArgs: string[]) =>
      materialize('--apply', '--confirm-materialize', ...extraArgs);

    const seedRun = async (sourceName: string, withCenterRosterHealth: boolean) => {
      const observedAt = new Date('2026-01-01T00:00:00Z');
      await db().collection('sources').insertOne({
        _id: sourceId,
        name: sourceName,
        displayName: 'Fixture center plan source',
        defaultWeight: 0.8,
        enabled: true,
      });
      await db().collection('scrape_runs').insertOne({
        _id: runId,
        sourceId,
        sourceName,
        status: 'success',
        triggeredBy: 'cli',
        startedAt: observedAt,
      });
      const observation = (entityType: string, field: string, value: unknown) => ({
        entityType,
        entityKey: ROW_SLUG,
        field,
        value,
        sourceId,
        sourceName,
        scrapeRunId: runId,
        confidence: 0.9,
        observedAt,
        superseded: false,
      });
      await db()
        .collection('observations')
        .insertMany([
          observation('researchEntity', 'name', 'Fixture Plan Center Renamed'),
          ...(withCenterRosterHealth
            ? [
                observation('centerRosterHealth', 'centerRosterHealth', {
                  centerKey: 'fixture-plan-cli',
                  entityKey: ROW_SLUG,
                  status: 'ok',
                  complete: true,
                  discoveredCount: 1,
                  members: [{ memberKey: `${ROW_SLUG}:fixture-member`, role: 'core-faculty' }],
                  read: {
                    pagesRead: 1,
                    readMode: 'html',
                    cacheAllowed: false,
                    stopReason: 'not-paginated',
                    readAt: observedAt.toISOString(),
                  },
                }),
              ]
            : []),
        ]);
    };

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
      errors = [];
      orchestratorStub.run.mockClear();
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        errors.push(args.map(String).join(' '));
      });
      vi.stubEnv('MONGODBURL', mongoUrl);
      vi.stubEnv('SCRAPER_ENV', 'development');
      vi.stubEnv('SCRAPER_DEVELOPMENT_DB_NAME', DATABASE_NAME);
      vi.stubEnv('ALLOW_NON_PROD_SCRAPER_WRITES', 'true');
      vi.stubEnv('DIRECTORY_REMOVAL_KEY', 'synthetic-center-plan-key-0123456789');
      for (const collection of await db().collections()) await collection.deleteMany({});
      outputDir = await mkdtemp(path.join(tmpdir(), 'center-plan-cli-'));
      sourceId = new ObjectId();
      runId = new ObjectId();
      await db().collection('research_entities').insertOne({
        slug: ROW_SLUG,
        name: 'Fixture Plan Center',
        kind: 'center',
        archived: false,
      });
    });

    afterEach(async () => {
      process.argv = originalArgv;
      process.exitCode = undefined;
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      await rm(outputDir, { recursive: true, force: true });
    });

    it('refuses a center roster apply without --expect-center-plan before writing', async () => {
      await seedRun('centers-institutes-index', true);
      const before = await storedRow();

      await apply();
      expect(process.exitCode).toBe(1);
      expect(errors.join('\n')).toContain('--expect-center-plan');
      expect(await storedRow()).toEqual(before);

      process.exitCode = undefined;
      await apply('--skip-center-roster-retirement');
      expect(process.exitCode).toBe(1);
      expect(await storedRow()).toEqual(before);
    });

    it('applies a center roster run held to the plan its dry run wrote', async () => {
      await seedRun('centers-institutes-index', true);
      const planPath = path.join(outputDir, 'plan.json');

      await materialize('--dry-run', '--output', planPath);
      const plan = JSON.parse(await readFile(planPath, 'utf8'));
      expect(plan.centerPlan).toMatchObject({ mode: 'plan', runId: String(runId) });

      await apply('--expect-center-plan', planPath);
      expect(process.exitCode).toBeUndefined();
      expect((await storedRow())?.name).toBe('Fixture Plan Center Renamed');
    });

    it('exits with the held-back code when a center diverged from the approved plan', async () => {
      await seedRun('centers-institutes-index', true);
      const planPath = path.join(outputDir, 'plan.json');
      await materialize('--dry-run', '--output', planPath);
      const plan = JSON.parse(await readFile(planPath, 'utf8'));
      const [retirement] = plan.centerPlan.centers[0].retirement;
      expect(retirement.digest.verdict).toBe('nothing-to-retire');
      retirement.digest = {
        ...retirement.digest,
        verdict: 'retire',
        retiredEdgeIds: [String(new ObjectId())],
      };
      const divergedPath = path.join(outputDir, 'diverged.json');
      await writeFile(divergedPath, JSON.stringify(plan));

      await apply('--expect-center-plan', divergedPath);

      expect(process.exitCode).toBe(CENTER_PLAN_HELD_BACK_EXIT_CODE);
      expect(errors.join('\n')).toContain('1 plan-diverged center(s)');
      expect((await storedRow())?.name).toBe('Fixture Plan Center Renamed');
    });

    it('refuses a Development scrape run --auto-materialize of a center roster source before it runs', async () => {
      process.argv = [
        'node',
        'src/scrapers/cli.ts',
        'run',
        '--source',
        'centers-institutes-index',
        '--apply',
        '--auto-materialize',
      ];

      await main();

      expect(process.exitCode).toBe(1);
      expect(errors.join('\n')).toContain('--expect-center-plan');
      expect(orchestratorStub.run).not.toHaveBeenCalled();
      expect(await db().collection('scrape_runs').countDocuments()).toBe(0);
    });

    it('leaves a run with no center roster read unguarded, dry run and apply alike', async () => {
      await seedRun('fixture-dept-faculty-roster', false);
      const dryRunPath = path.join(outputDir, 'dry-run.json');

      await materialize('--dry-run', '--output', dryRunPath);
      expect(JSON.parse(await readFile(dryRunPath, 'utf8'))).not.toHaveProperty('centerPlan');

      await apply();
      expect(process.exitCode).not.toBe(1);
      expect(errors.join('\n')).not.toContain('--expect-center-plan');
      expect((await storedRow())?.name).toBe('Fixture Plan Center Renamed');
    });
  },
);
