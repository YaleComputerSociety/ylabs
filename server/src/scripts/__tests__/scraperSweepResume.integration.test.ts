import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const SWEEP_ENV_KEYS = [
  'SCRAPER_ENV',
  'MONGODBURL',
  'ALLOW_NON_PROD_SCRAPER_WRITES',
  'MEILISEARCH_HOST',
  'MEILISEARCH_INDEX_PREFIX',
] as const;

interface RecordedChild {
  args: string[];
  logPath?: string;
}

function outputPathFromArgs(args: string[]): string | undefined {
  const inlineIndex = args.findIndex((arg) => arg.startsWith('--output='));
  if (inlineIndex >= 0) return args[inlineIndex].slice('--output='.length);
  const flagIndex = args.indexOf('--output');
  return flagIndex >= 0 ? args[flagIndex + 1] : undefined;
}

function sourceNameFromArgs(args: string[]): string | undefined {
  const index = args.indexOf('--source');
  return index >= 0 ? args[index + 1] : undefined;
}

function commandFromArgs(args: string[]): string | undefined {
  const cwdIndex = args.indexOf('--cwd');
  return cwdIndex >= 0 ? args[cwdIndex + 2] : args[0];
}

describe('scraper sweep resume, logging, and gated prune end to end', () => {
  let mongod: MongoMemoryServer;
  let mongoUrl: string;
  let runScraperSweep: typeof import('../runScraperSweep').runScraperSweep;
  let checkpointPathForMode: typeof import('../scraperSweepCheckpoint').checkpointPathForMode;
  let readSweepCheckpoint: typeof import('../scraperSweepCheckpoint').readSweepCheckpoint;
  const previousEnv = new Map<string, string | undefined>();
  const outputDirectories = new Set<string>();
  const checkpointPaths = new Set<string>();

  beforeAll(async () => {
    for (const key of SWEEP_ENV_KEYS) previousEnv.set(key, process.env[key]);
    mongod = await MongoMemoryServer.create();
    mongoUrl = mongod.getUri('Development');
    process.env.SCRAPER_ENV = 'development';
    process.env.MONGODBURL = mongoUrl;
    process.env.ALLOW_NON_PROD_SCRAPER_WRITES = 'true';
    process.env.MEILISEARCH_HOST = 'http://127.0.0.1:7700';
    process.env.MEILISEARCH_INDEX_PREFIX = '';

    const sweep = await import('../runScraperSweep');
    const checkpointModule = await import('../scraperSweepCheckpoint');
    runScraperSweep = sweep.runScraperSweep;
    checkpointPathForMode = checkpointModule.checkpointPathForMode;
    readSweepCheckpoint = checkpointModule.readSweepCheckpoint;

    const { buildOrchestrator } = await import('../../scrapers/registry');
    const registeredNames = buildOrchestrator()
      .list()
      .map((source) => source.name);
    await mongoose.connect(mongoUrl);
    await mongoose.connection.db!.collection('sources').insertMany(
      registeredNames.map((name) => ({
        name,
        displayName: name,
        defaultWeight: 0.5,
        enabled: true,
      })),
    );
    await mongoose.disconnect();
  }, 180_000);

  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    await mongod.stop();
    for (const key of SWEEP_ENV_KEYS) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const directory of outputDirectories) fs.rmSync(directory, { recursive: true, force: true });
    outputDirectories.clear();
    for (const checkpointPath of checkpointPaths) fs.rmSync(checkpointPath, { force: true });
    checkpointPaths.clear();
  });

  const makeChildRunner = (failingSources: Set<string>) => {
    const calls: RecordedChild[] = [];
    const runner = async (
      _command: string,
      args: string[],
      options: { logPath?: string },
    ): Promise<{ status: number | null }> => {
      calls.push({ args, ...(options.logPath ? { logPath: options.logPath } : {}) });
      const sourceName = sourceNameFromArgs(args);
      const failing = Boolean(sourceName && failingSources.has(sourceName));
      if (options.logPath) {
        fs.mkdirSync(path.dirname(options.logPath), { recursive: true });
        fs.appendFileSync(
          options.logPath,
          failing
            ? `fetching ${sourceName}\nECONNRESET while fetching ${sourceName}\nscrape aborted for ${sourceName}\n`
            : `fetching ${sourceName ?? commandFromArgs(args)}\ndone\n`,
        );
      }
      if (failing) return { status: 1 };
      const outputPath = outputPathFromArgs(args);
      if (outputPath) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(
          outputPath,
          `${JSON.stringify({
            run: { id: `run-${sourceName ?? commandFromArgs(args)}`, status: 'success' },
            observations: { total: 2, entitiesObserved: 1 },
            materialization: { created: 1, errors: 0 },
            mergeDelta: {},
            byReason: {},
          })}\n`,
        );
      }
      return { status: 0 };
    };
    return { runner, calls };
  };

  const sweepRepoRoot = path.resolve(__dirname, '../../../..');

  const trackRun = (mode: string, outputDirectory: string) => {
    outputDirectories.add(outputDirectory);
    checkpointPaths.add(checkpointPathForMode(mode, os.tmpdir(), sweepRepoRoot));
  };

  const checkpointFor = (mode: string): string =>
    checkpointPathForMode(mode, os.tmpdir(), sweepRepoRoot);

  it(
    'checkpoints a failed development sweep, resumes only the unfinished source, prunes between phases, and clears the checkpoint when it finally succeeds',
    async () => {
      const mode = 'development-full' as const;
      fs.rmSync(checkpointFor(mode), { force: true });
      const options = {
        mode,
        confirmations: new Set(['--confirm-development-full-sweep']),
        forceLlm: true,
        pruneBetweenPhases: true,
      };

      const failed = makeChildRunner(new Set(['nih-reporter']));
      const firstSummary = await runScraperSweep(options, { childRunner: failed.runner });
      trackRun(mode, firstSummary.outputDirectory);

      expect(firstSummary.failed).toBe(1);
      expect(
        firstSummary.rows.find((row) => row.sourceName === 'nih-reporter')?.status,
      ).toBe('failed');

      const sourceCalls = failed.calls.filter((call) => sourceNameFromArgs(call.args));
      expect(sourceCalls.length).toBe(firstSummary.sourceCount);
      for (const call of sourceCalls) expect(call.args).toContain('--force-llm');

      const pruneCalls = failed.calls.filter(
        (call) => commandFromArgs(call.args) === 'observations:prune-dead',
      );
      expect(pruneCalls.length).toBeGreaterThan(1);
      for (const call of pruneCalls) {
        expect(call.args).toContain('--apply');
        expect(call.args).toContain('--confirm-prune-dead-observations');
      }
      expect(
        pruneCalls.some((call) =>
          (outputPathFromArgs(call.args) || '').includes('prune-between-identity.json'),
        ),
      ).toBe(true);
      expect(
        (firstSummary.postRun?.stages || []).map((stage) => stage.name),
      ).toContain('dead-data-prune');

      const checkpoint = readSweepCheckpoint(checkpointFor(mode));
      expect(checkpoint?.outputDirectory).toBe(firstSummary.outputDirectory);
      expect(checkpoint?.steps['source:yale-directory']?.status).toBe('done');
      expect(checkpoint?.steps['source:nih-reporter']?.status).toBe('failed');
      expect(checkpoint?.steps['prune:identity']?.status).toBe('done');

      const runnerLog = fs.readFileSync(
        path.join(firstSummary.outputDirectory, 'runner.log'),
        'utf8',
      );
      expect(runnerLog).toContain('[done] source:yale-directory');
      expect(runnerLog).toContain('[failed] source:nih-reporter');
      const errorsLog = fs.readFileSync(
        path.join(firstSummary.outputDirectory, 'errors.log'),
        'utf8',
      );
      expect(errorsLog).toContain('[failed] source:nih-reporter exitCode=1');
      expect(errorsLog).toContain('scrape aborted for nih-reporter');

      const resumed = makeChildRunner(new Set());
      const secondSummary = await runScraperSweep(options, { childRunner: resumed.runner });
      trackRun(mode, secondSummary.outputDirectory);

      expect(secondSummary.outputDirectory).toBe(firstSummary.outputDirectory);
      expect(
        resumed.calls.filter((call) => sourceNameFromArgs(call.args)).map((call) =>
          sourceNameFromArgs(call.args),
        ),
      ).toEqual(['nih-reporter']);
      expect(secondSummary.failed).toBe(0);
      expect(secondSummary.notRun).toBe(0);
      expect(secondSummary.succeeded).toBe(secondSummary.sourceCount);
      expect(secondSummary.postRun?.status).toBe('succeeded');
      expect(
        resumed.calls.some((call) =>
          (commandFromArgs(call.args) || '').includes('meili:rebuild-research-entities'),
        ),
      ).toBe(true);
      expect(fs.existsSync(checkpointFor(mode))).toBe(false);

      const restarted = makeChildRunner(new Set());
      const thirdSummary = await runScraperSweep(
        { ...options, restart: true },
        { childRunner: restarted.runner },
      );
      trackRun(mode, thirdSummary.outputDirectory);
      expect(thirdSummary.outputDirectory).not.toBe(firstSummary.outputDirectory);
      expect(restarted.calls.filter((call) => sourceNameFromArgs(call.args)).length).toBe(
        thirdSummary.sourceCount,
      );
    },
    180_000,
  );

  it(
    'resumes the fellowship sweep from its own checkpoint and runs the gated fellowship prune stage',
    async () => {
      const mode = 'fellowship-development-full' as const;
      fs.rmSync(checkpointFor(mode), { force: true });
      const options = {
        mode,
        confirmations: new Set(['--confirm-fellowship-sweep']),
        pruneBetweenPhases: true,
      };

      const failed = makeChildRunner(new Set(['yale-reu-programs']));
      const firstSummary = await runScraperSweep(options, { childRunner: failed.runner });
      trackRun(mode, firstSummary.outputDirectory);

      expect(firstSummary.failed).toBe(1);
      expect(
        (firstSummary.postRun?.stages || []).map((stage) => stage.name),
      ).toContain('dead-data-prune');
      expect(fs.existsSync(checkpointFor(mode))).toBe(true);
      expect(
        fs.readFileSync(path.join(firstSummary.outputDirectory, 'errors.log'), 'utf8'),
      ).toContain('source:yale-reu-programs');

      const resumed = makeChildRunner(new Set());
      const secondSummary = await runScraperSweep(options, { childRunner: resumed.runner });
      trackRun(mode, secondSummary.outputDirectory);

      expect(
        resumed.calls
          .filter((call) => sourceNameFromArgs(call.args))
          .map((call) => sourceNameFromArgs(call.args)),
      ).toEqual(['yale-reu-programs']);
      expect(secondSummary.failed).toBe(0);
      expect(secondSummary.postRun?.status).toBe('succeeded');
      expect(fs.existsSync(checkpointFor(mode))).toBe(false);
    },
    180_000,
  );
});
