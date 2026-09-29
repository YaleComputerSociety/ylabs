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
  hostSlotBroker?: string;
  pageReuse?: string;
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
  let researchSweepSources: typeof import('../runScraperSweep').RESEARCH_SWEEP_SOURCES;
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
    researchSweepSources = sweep.RESEARCH_SWEEP_SOURCES;
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
  });

  afterAll(async () => {
    await mongoose.disconnect().catch(() => {});
    await mongod?.stop();
    for (const key of SWEEP_ENV_KEYS) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const directory of outputDirectories)
      fs.rmSync(directory, { recursive: true, force: true });
    outputDirectories.clear();
    for (const checkpointPath of checkpointPaths) fs.rmSync(checkpointPath, { force: true });
    checkpointPaths.clear();
  });

  const makeChildRunner = (failingSources: Set<string>) => {
    const calls: RecordedChild[] = [];
    const runner = async (
      _command: string,
      args: string[],
      options: { logPath?: string; env?: NodeJS.ProcessEnv },
    ): Promise<{ status: number | null }> => {
      const hostSlotBroker = options.env?.SCRAPER_HOST_SLOT_BROKER;
      const pageReuse = options.env?.SCRAPER_SWEEP_PAGE_REUSE;
      calls.push({
        args,
        ...(options.logPath ? { logPath: options.logPath } : {}),
        ...(hostSlotBroker ? { hostSlotBroker } : {}),
        ...(pageReuse ? { pageReuse } : {}),
      });
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
            // The grant-shell port stage refuses a report that is not an apply, so the
            // stub answers its contract too (#3909).
            portDelta: {},
            byReason: {},
            urlIdentityDedupeDelta: {
              plannedGroups: 0,
              appliedGroups: 0,
              archivedEntities: 0,
            },
            // The profile-link-health stage refuses an artifact that does not say
            // whether the run finished, so the stub has to answer that too (#3303).
            result: {
              decisiveVerdicts: 0,
              statusesWritten: 0,
              coverage: {
                linksDue: 0,
                attempted: 0,
                probed: 0,
                hostsPlanned: 0,
                hostsCompleted: 0,
                linksUnreached: 0,
                linksStillDue: 0,
                complete: true,
              },
            },
            // The dead-website stage declares a result contract that requires `completed`,
            // so this shared stub has to satisfy it or the stage fails loud. That it does
            // fail loud without these keys is the contract working (#2050, #3309).
            plannedClears: 0,
            completed: true,
            // The stale-run reap stage refuses a report that is not a scoped apply run, so
            // the stub answers its contract too (#3841).
            mode: 'apply',
            heartbeatStaleOnly: true,
            startedBefore: '2026-01-01T00:00:00.000Z',
            running: 0,
            planned: 0,
            closed: 0,
            changedSinceRead: 0,
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

  it('checkpoints a failed development sweep, resumes only the unfinished source, prunes between phases, and clears the checkpoint when it finally succeeds', async () => {
    const mode = 'development-full' as const;
    fs.rmSync(checkpointFor(mode), { force: true });
    const options = {
      mode,
      confirmations: new Set(['--confirm-development-full-sweep']),
      forceLlm: true,
      pruneBetweenPhases: true,
      skipPreflight: true,
    };

    const failed = makeChildRunner(new Set(['nih-reporter']));
    const firstSummary = await runScraperSweep(options, { childRunner: failed.runner });
    trackRun(mode, firstSummary.outputDirectory);

    const brokerPaths = [
      ...new Set(
        failed.calls
          .filter((call) => sourceNameFromArgs(call.args))
          .map((call) => call.hostSlotBroker),
      ),
    ];
    expect(brokerPaths).toHaveLength(1);
    expect(brokerPaths[0]).toMatch(/ylabs-host-slots-\d+\.sock$/);
    expect(fs.existsSync(brokerPaths[0]!)).toBe(false);

    expect(firstSummary.failed).toBe(1);
    expect(firstSummary.rows.find((row) => row.sourceName === 'nih-reporter')?.status).toBe(
      'failed',
    );

    const sourceCalls = failed.calls.filter((call) => sourceNameFromArgs(call.args));
    expect(sourceCalls.length).toBe(firstSummary.sourceCount);
    for (const call of sourceCalls) expect(call.args).toContain('--force-llm');
    for (const call of sourceCalls) expect(call.pageReuse).toBe('1');
    expect(firstSummary.pageReuse).toMatchObject({
      hosts: ['medicine.yale.edu', 'ysph.yale.edu'],
      lookups: 0,
      maxBytes: 1024 * 1024 * 1024,
    });

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
    expect((firstSummary.postRun?.stages || []).map((stage) => stage.name)).toContain(
      'dead-data-prune',
    );

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
      resumed.calls
        .filter((call) => sourceNameFromArgs(call.args))
        .map((call) => sourceNameFromArgs(call.args)),
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
  }, 180_000);

  it('resumes after a source is removed from the list without re-running any done source (#3570)', async () => {
    const mode = 'development-full' as const;
    fs.rmSync(checkpointFor(mode), { force: true });
    const options = {
      mode,
      confirmations: new Set(['--confirm-development-full-sweep']),
      skipPreflight: true,
    };
    const lastSource = researchSweepSources[researchSweepSources.length - 1].name;
    const removedSource = researchSweepSources[0].name;

    const failed = makeChildRunner(new Set([lastSource]));
    const firstSummary = await runScraperSweep(options, {
      childRunner: failed.runner,
      sweepSources: researchSweepSources,
    });
    trackRun(mode, firstSummary.outputDirectory);
    expect(firstSummary.failed).toBe(1);

    const checkpoint = readSweepCheckpoint(checkpointFor(mode));
    const secondSource = researchSweepSources[1].name;
    const recordedPath = checkpoint?.steps[`source:${secondSource}`]?.artifactPath;
    expect(recordedPath).toBe(path.join(firstSummary.outputDirectory, `02-${secondSource}.json`));

    const resumed = makeChildRunner(new Set());
    const secondSummary = await runScraperSweep(options, {
      childRunner: resumed.runner,
      sweepSources: researchSweepSources.filter((source) => source.name !== removedSource),
    });
    trackRun(mode, secondSummary.outputDirectory);

    expect(
      resumed.calls
        .filter((call) => sourceNameFromArgs(call.args))
        .map((call) => sourceNameFromArgs(call.args)),
    ).toEqual([lastSource]);
    expect(secondSummary.failed).toBe(0);
    expect(secondSummary.rows.find((row) => row.sourceName === secondSource)?.artifactPath).toBe(
      recordedPath,
    );
    expect(fs.existsSync(path.join(firstSummary.outputDirectory, `01-${secondSource}.json`))).toBe(
      false,
    );
  }, 180_000);

  const runSweepFailingLastSource = async () => {
    const mode = 'development-full' as const;
    fs.rmSync(checkpointFor(mode), { force: true });
    const options = {
      mode,
      confirmations: new Set(['--confirm-development-full-sweep']),
      skipPreflight: true,
    };
    const lastSource = researchSweepSources[researchSweepSources.length - 1].name;
    const failed = makeChildRunner(new Set([lastSource]));
    const summary = await runScraperSweep(options, {
      childRunner: failed.runner,
      sweepSources: researchSweepSources,
    });
    trackRun(mode, summary.outputDirectory);
    expect(summary.failed).toBe(1);
    return { mode, options, lastSource };
  };

  const resumedSourceNames = (calls: RecordedChild[]): string[] =>
    calls.map((call) => sourceNameFromArgs(call.args)).filter((name): name is string => !!name);

  it('resumes a checkpoint that recorded no artifact paths by the derived artifact name (#3570)', async () => {
    const { mode, options, lastSource } = await runSweepFailingLastSource();
    const raw = JSON.parse(fs.readFileSync(checkpointFor(mode), 'utf8'));
    for (const step of Object.values(raw.steps) as Array<Record<string, unknown>>) {
      delete step.artifactPath;
    }
    fs.writeFileSync(checkpointFor(mode), JSON.stringify(raw));

    const resumed = makeChildRunner(new Set());
    const summary = await runScraperSweep(options, {
      childRunner: resumed.runner,
      sweepSources: researchSweepSources,
    });
    trackRun(mode, summary.outputDirectory);

    expect(resumedSourceNames(resumed.calls)).toEqual([lastSource]);
    expect(summary.failed).toBe(0);
  }, 180_000);

  it('re-runs a done source whose recorded artifact is missing instead of trusting it (#3570)', async () => {
    const { mode, options, lastSource } = await runSweepFailingLastSource();
    const missingSource = researchSweepSources[1].name;
    const checkpoint = readSweepCheckpoint(checkpointFor(mode));
    fs.rmSync(checkpoint!.steps[`source:${missingSource}`].artifactPath!, { force: true });

    const resumed = makeChildRunner(new Set());
    const summary = await runScraperSweep(options, {
      childRunner: resumed.runner,
      sweepSources: researchSweepSources.filter(
        (source) => source.name !== researchSweepSources[0].name,
      ),
    });
    trackRun(mode, summary.outputDirectory);

    expect(new Set(resumedSourceNames(resumed.calls))).toEqual(
      new Set([missingSource, lastSource]),
    );
    expect(summary.failed).toBe(0);
  }, 180_000);

  it('stops a development-full sweep before any source runs when its preflight canary fails', async () => {
    const mode = 'development-full' as const;
    fs.rmSync(checkpointFor(mode), { force: true });
    const canaried: string[] = [];
    const scraped: string[] = [];
    const canaryBrokers = new Set<string | undefined>();
    const runner = async (
      _command: string,
      args: string[],
      options: { env?: NodeJS.ProcessEnv },
    ): Promise<{ status: number | null }> => {
      const sourceName = sourceNameFromArgs(args) ?? '';
      if (commandFromArgs(args) === 'scrape:canary') {
        canaried.push(sourceName);
        canaryBrokers.add(options.env?.SCRAPER_HOST_SLOT_BROKER);
        const verdict = sourceName === 'nih-reporter' ? 'failed' : 'passed';
        fs.writeFileSync(
          outputPathFromArgs(args)!,
          JSON.stringify({
            sourceName,
            verdict,
            reason: verdict === 'failed' ? 'the lane threw: fixture outage' : 'emitted 3',
            observationCount: verdict === 'failed' ? 0 : 3,
          }),
        );
        return { status: verdict === 'failed' ? 1 : 0 };
      }
      scraped.push(sourceName);
      return { status: 0 };
    };
    const options = {
      mode,
      confirmations: new Set(['--confirm-development-full-sweep']),
    };

    await expect(runScraperSweep(options, { childRunner: runner })).rejects.toThrow(
      /sweep preflight failed before any source ran/,
    );

    expect(canaried.length).toBeGreaterThan(10);
    expect(canaried).toContain('nih-reporter');
    expect(scraped).toEqual([]);
    const [canaryBroker] = [...canaryBrokers];
    expect(canaryBrokers.size).toBe(1);
    expect(canaryBroker).toMatch(/ylabs-host-slots-\d+\.sock$/);
    expect(fs.existsSync(canaryBroker!)).toBe(false);
    const checkpoint = readSweepCheckpoint(checkpointFor(mode));
    expect(checkpoint).toBeDefined();
    const outputDirectory = checkpoint!.outputDirectory;
    trackRun(mode, outputDirectory);
    const preflight = JSON.parse(
      fs.readFileSync(path.join(outputDirectory, 'preflight.json'), 'utf8'),
    );
    expect(preflight.status).toBe('failed');
    expect(preflight.storage.ok).toBe(true);
    expect(preflight.failures).toEqual(['canary nih-reporter: the lane threw: fixture outage']);
  }, 180_000);

  it('resumes the fellowship sweep from its own checkpoint and runs the gated fellowship prune stage', async () => {
    const mode = 'fellowship-development-full' as const;
    fs.rmSync(checkpointFor(mode), { force: true });
    const options = {
      mode,
      confirmations: new Set(['--confirm-fellowship-sweep']),
      pruneBetweenPhases: true,
    };

    const failed = makeChildRunner(new Set(['yale-reu-programs']));
    const firstSummary = await runScraperSweep(
      { ...options, noPageReuse: true },
      { childRunner: failed.runner },
    );
    trackRun(mode, firstSummary.outputDirectory);
    const fellowshipSourceCalls = failed.calls.filter((call) => sourceNameFromArgs(call.args));
    for (const call of fellowshipSourceCalls) expect(call.pageReuse).toBe('0');
    expect(firstSummary.pageReuse).toBeUndefined();

    expect(firstSummary.failed).toBe(1);
    expect((firstSummary.postRun?.stages || []).map((stage) => stage.name)).toContain(
      'dead-data-prune',
    );
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
  }, 180_000);
  // A sweep runs the code in its checkout, and nothing used to pin it. On the Development full
  // sweep of 2026-09-28 the checkout fast-forwarded six times mid-run and the 24 source stages
  // split across two different commits, while `summary.json` recorded no commit at all, so the
  // artifacts could not have revealed either fact. Stage results were therefore unattributable,
  // and a stage could apply a defect the checkout predated (#3476 follow-up).
  it('records the commit its stages ran and refuses a stage once the checkout moves', async () => {
    const mode = 'development-full' as const;
    fs.rmSync(checkpointFor(mode), { force: true });
    const options = {
      mode,
      confirmations: new Set(['--confirm-development-full-sweep']),
      pruneBetweenPhases: false,
      skipPreflight: true,
    };

    const started = 'a'.repeat(7) + '1'.repeat(33);
    const moved = 'b'.repeat(7) + '2'.repeat(33);
    const spawned = makeChildRunner(new Set());
    let spawns = 0;
    const summary = await runScraperSweep(options, {
      childRunner: async (command, args, childOptions) => {
        spawns++;
        return spawned.runner(command, args, childOptions);
      },
      // Moves the checkout after the first stage has been spawned, which is what a peer's `git
      // pull` does to a running sweep.
      readHeadSha: () => (spawns === 0 ? started : moved),
    });
    trackRun(mode, summary.outputDirectory);

    expect(summary.codeSha).toBe(started);
    expect(summary.codeDrift?.length ?? 0).toBeGreaterThan(0);
    expect(summary.codeDrift?.[0]?.startedSha).toBe(started);
    expect(summary.codeDrift?.[0]?.currentSha).toBe(moved);
    // Fails closed: exactly one stage ran, and every later one was refused without doing work.
    expect(spawns).toBe(1);
    expect(summary.failed).toBeGreaterThan(0);
    // Recoverable rather than lost: the checkpoint survives so a resume re-runs the refused
    // stages once the checkout is back on the commit the run started.
    expect(fs.existsSync(checkpointFor(mode))).toBe(true);

    const onStartedCheckout = await runScraperSweep(options, {
      childRunner: spawned.runner,
      readHeadSha: () => started,
    });

    expect(onStartedCheckout.codeSha).toBe(started);
    expect(onStartedCheckout.failed).toBe(0);
    expect(onStartedCheckout.codeDrift).toEqual(summary.codeDrift);
    expect(fs.existsSync(checkpointFor(mode))).toBe(false);
  }, 180_000);

  it('starts a new sweep instead of resuming a checkpoint recorded at another commit (#3989)', async () => {
    const mode = 'development-full' as const;
    fs.rmSync(checkpointFor(mode), { force: true });
    const options = {
      mode,
      confirmations: new Set(['--confirm-development-full-sweep']),
      pruneBetweenPhases: false,
      skipPreflight: true,
    };

    const started = 'c'.repeat(7) + '3'.repeat(33);
    const moved = 'd'.repeat(7) + '4'.repeat(33);
    const spawned = makeChildRunner(new Set());
    let spawns = 0;
    const interrupted = await runScraperSweep(options, {
      childRunner: async (command, args, childOptions) => {
        spawns++;
        return spawned.runner(command, args, childOptions);
      },
      readHeadSha: () => (spawns === 0 ? started : moved),
    });
    trackRun(mode, interrupted.outputDirectory);
    expect(interrupted.codeSha).toBe(started);
    expect(fs.existsSync(checkpointFor(mode))).toBe(true);

    let newSweepSpawns = 0;
    const onMovedCheckout = await runScraperSweep(options, {
      childRunner: async (command, args, childOptions) => {
        newSweepSpawns++;
        return spawned.runner(command, args, childOptions);
      },
      readHeadSha: () => moved,
    });
    trackRun(mode, onMovedCheckout.outputDirectory);

    expect(onMovedCheckout.codeSha).toBe(moved);
    expect(newSweepSpawns).toBeGreaterThan(spawns);
    expect(onMovedCheckout.codeDrift ?? []).toEqual([]);
    expect(onMovedCheckout.failed).toBe(0);
  }, 180_000);
});
