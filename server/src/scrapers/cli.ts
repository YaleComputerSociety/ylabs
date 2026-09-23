/**
 * CLI entry point for scrapers.
 *
 * Usage:
 *   npx tsx server/src/scrapers/cli.ts list
 *   npx tsx server/src/scrapers/cli.ts run --source nih-reporter [flags] [--output <path>]
 *   npx tsx server/src/scrapers/cli.ts cron --source nih-reporter --release
 *   npx tsx server/src/scrapers/cli.ts materialize --run <runId> [--dry-run|--confirm-materialize] [--output <path>]
 *   npx tsx server/src/scrapers/cli.ts report --run <runId> [--output <path>]
 *   npx tsx server/src/scrapers/cli.ts prune-observations [--apply --confirm-observation-prune] [--output <path>]
 *
 * Flags for `run`:
 *   --dry-run       Don't write Observations (just log what would be inserted)
 *   --use-cache     Memoize external fetches in ScrapeSnapshot collection (dev only)
 *   --release       Production mode (cache off, errors surface)
 *   --limit <n>     Cap the number of entities the scraper processes
 *   --offset <n>    Skip the first n entities after source-specific ordering
 *   --only <keys>   Comma-separated source-specific keys/netids to process
 *   --since <date>  Restrict scrapers that support recency filters
 *   --ignore-work-planner  Bypass freshness skips for full audit/backfill runs
 *   --exhaustive     Process every eligible entity instead of source safety defaults
 *   --force-llm      Re-run paid LLM extraction even when source content is unchanged
 *   --logistics-production  Allow lab-microsite-undergrad-llm to emit corpus-wide
 *                    undergraduate logistics claims outside the staging allowlist.
 *                    Requires CONFIRM_LOGISTICS_ACQUISITION=true in the environment.
 *   --auto-materialize   After successful run, immediately materialize observations
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { buildOrchestrator } from './registry';
import { installScraperHostConcurrencyInterceptor } from './utils/hostConcurrencyLimiter';
import { materializeFromRun } from './entityMaterializer';
import { ScrapeRun } from '../models/scrapeRun';
import { getScrapeRunReport } from './runReport';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import {
  resolveScraperEnvironment,
  summarizeMongoUrl,
  type ScraperEnvironment,
} from './scraperEnvironment';
import { createCronRunnerDependencies, runScraperCron } from './cronRunner';
import {
  createScrapeJobLockOwnerId,
  findHeldScrapeJobLock,
  withScrapeJobLock,
} from './scrapeJobLock';
import { markSourceCrawled } from './sourceCrawlStamp';
import { pruneSupersededObservations } from './observationRetention';
import { writeOptionalJsonOutput } from './scraperCliOutput';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  buildCronOutputPayload,
  buildMaterializeOutputPayload,
  buildScraperCliOutputPayload,
  buildScraperCliPreflight,
  parseArgs,
  unmaterializedWriteRunWarning,
  type ScraperCliPreflight,
} from './cliHelpers';

export {
  buildCronOutputPayload,
  buildMaterializeOutputPayload,
  buildScraperCliOutputPayload,
  buildScraperCliPreflight,
  parseArgs,
  parseIntegerFlag,
  parseScraperOptions,
  unmaterializedWriteRunWarning,
} from './cliHelpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// What a guarded CLI write reports back to the lock: the reason the lock row
// records and the run it belongs to, so a CLI holder's provenance matches what
// `cronRunner` already stores.
interface ScrapeCliLockedOutcome {
  runId?: string;
  failed?: boolean;
}

// Every CLI write to a source runs inside that source's job lock, which is what
// `cronRunner` already did and the CLI did not, so two operators or two agents
// could write one source concurrently with nothing objecting (#2498).
//
// Refusing is reported rather than thrown so the caller can print an operator
// message and set an exit code; returning `true` means the work did not complete
// under an uncontested lock.
async function runUnderScrapeJobLock(input: {
  environment: ScraperEnvironment;
  sourceName: string;
  ownerLabel: string;
  refusal: string;
  run: () => Promise<ScrapeCliLockedOutcome>;
}): Promise<boolean> {
  const guarded = await withScrapeJobLock<ScrapeCliLockedOutcome>(
    {
      environment: input.environment,
      sourceName: input.sourceName,
      ownerId: createScrapeJobLockOwnerId(input.ownerLabel),
      label: 'scrape cli',
      describeRelease: (outcome) => ({
        releaseReason: outcome.failed ? 'failure' : 'success',
        lastRunId: outcome.runId,
      }),
    },
    input.run,
  );

  if (guarded.acquired) {
    if (!guarded.lockLost) return false;
    console.error(
      `LOCK LOST: the ${input.environment} lock for "${input.sourceName}" stopped belonging to this process mid-write, ` +
        'so another writer may have written the same source concurrently. ' +
        'Re-read the served output for this source before trusting it.',
    );
    return true;
  }

  console.error(
    `REFUSED: another writer holds the ${input.environment} lock for "${input.sourceName}". ` +
      `${input.refusal} ` +
      `${await describeScrapeJobLockHolder(input.environment, input.sourceName)} ` +
      'Wait for the holder to finish; a crashed holder releases automatically when its lease expires.',
  );
  return true;
}

// Names the holder an operator is waiting on, which is the first thing they need
// in order to choose between waiting and investigating. The row can legitimately
// be gone by now, and a failed read must not replace the refusal it annotates.
async function describeScrapeJobLockHolder(
  environment: ScraperEnvironment,
  sourceName: string,
): Promise<string> {
  try {
    const held = await findHeldScrapeJobLock({ environment, sourceName });
    if (!held) return 'The holder has since released it, so retrying now should succeed.';
    return `Holder ${sanitizeLogValue(held.ownerId ?? 'unidentified')}, lease expires ${
      held.leaseExpiresAt?.toISOString() ?? 'at an unrecorded time'
    }.`;
  } catch (error) {
    return `Could not read the holder: ${sanitizeLogValue(error)}.`;
  }
}

async function resolveScrapeRunSourceName(runId: string): Promise<string | undefined> {
  const run = await ScrapeRun.findById(runId).select('sourceName').lean();
  return (run as { sourceName?: string } | null)?.sourceName;
}

async function warnWhenSourceIsBeingWritten(
  environment: ScraperEnvironment,
  sourceName: string,
): Promise<void> {
  const held = await findHeldScrapeJobLock({ environment, sourceName });
  if (!held) return;
  console.warn(
    `WARNING: "${sourceName}" is being written right now by ${sanitizeLogValue(
      held.ownerId ?? 'an unidentified owner',
    )}. This dry run reads a moving corpus, so treat its counts as indicative only.`,
  );
}

export async function main(): Promise<void> {
  installScraperHostConcurrencyInterceptor();
  const { command, flags } = parseArgs(process.argv);

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`
ylabs scraper CLI

  list                                       List registered scrapers
  run --source <name> [flags]                Run a scraper
  cron --source <name> --release             Run a production cron-safe scraper job
  materialize --run <runId> [--output <path>]
                                             Materialize observations from a previous run
  report --run <runId> [--output <path>]     Print or save a QA report for a ScrapeRun
  prune-observations [flags]                 Prune old unreferenced superseded Observation rows

Run flags:
  --dry-run            Skip Observation writes (preview only)
  --use-cache          Cache external fetches in ScrapeSnapshot (dev)
  --release            Production mode
  --limit <n>          Cap entities processed
  --offset <n>         Skip first n ordered entities
  --only <keys>        Comma-separated source-specific keys/netids
  --since <date>       Restrict scrapers that support recency filters
  --manual-recipient-csv-dir <path>
                       For undergrad-fellowships-recipients, read <programKey>.csv files
  --ignore-work-planner
                       Bypass freshness skips for full audit/backfill runs
  --exhaustive         Process every eligible entity instead of source safety defaults
  --force-llm          Re-run paid LLM extraction even when source content is unchanged
  --source-concurrency <n>
                       Max targets a source fetches/extracts in parallel (default 5)
  --logistics-production
                       Allow lab-microsite-undergrad-llm to emit corpus-wide
                       undergraduate logistics claims outside the staging allowlist.
                       Requires CONFIRM_LOGISTICS_ACQUISITION=true in the environment.
  --explain            With --dry-run, write the planned observation VALUES into
                       the --output report so a batch can be audited. Requires
                       --dry-run and --output: values carry names, emails and
                       bios, so they never go to stdout.
  --explain-limit <n>  Cap the observation values --explain collects (default 500)
  --auto-materialize   Materialize immediately after a successful run
  --output <path>      Save the ScrapeRun report JSON

Cron flags:
  --force-disabled     Run a disabled source only for manual recovery
  --output <path>      Save the cron result and ScrapeRun report JSON

Materialize flags:
  --dry-run            Preview materialization without writing derived records
  --confirm-materialize
                       Required when standalone materialize writes derived records.
  --output <path>      Save the materialize result, visibility gate, and run report JSON

Prune flags:
  --apply              Delete matching rows. Omit for dry-run.
  --confirm-observation-prune
                       Required with --apply to delete superseded rows.
  --older-than-days <n>
                       Only target superseded observations older than n days (default 30)
  --keep-runs <n>      Keep observations from the latest n runs per source (default 3)
  --source <name>      Restrict pruning to one source
  --output <path>      Save the prune report JSON
  Durable Observation references are always preserved.

Environment guardrails:
  SCRAPER_ENV=development|beta|production
  Non-production runs default to --dry-run and disable --auto-materialize.
  Production writes require --release and CONFIRM_PROD_SCRAPE=true.

Concurrency:
  A writing "run" or "materialize" takes that source's ScrapeJobLock and is
  REFUSED with a nonzero exit while another writer holds it. The lock is keyed
  per source, so different sources still run in parallel. A --dry-run does not
  contend for the lock and only warns when a writer holds the source.
`);
    return;
  }

  const orchestrator = buildOrchestrator();

  if (command === 'list') {
    console.log('Registered scrapers:');
    for (const s of orchestrator.list()) {
      console.log(`  ${s.name.padEnd(30)} ${s.displayName}`);
    }
    return;
  }

  const url = process.env.MONGODBURL;
  if (!url) {
    console.error('ERROR: MONGODBURL not set in environment');
    process.exit(1);
  }

  const preflight = buildScraperCliPreflight(command, flags, url);

  await mongoose.connect(url);

  try {
    const connectedDbLabel = (): string =>
      mongoose.connection.db?.databaseName || mongoose.connection.name || summarizeMongoUrl(url);

    if (command === 'run') {
      if (preflight.command !== 'run') throw new Error('Invalid run preflight state.');
      const runPreflight = preflight as Extract<ScraperCliPreflight, { command: 'run' }>;
      const { sourceName, guard } = runPreflight;
      for (const warning of guard.warnings) console.warn(`WARNING: ${warning}`);
      console.log(`Scraper environment: ${guard.environment}; Mongo target: ${guard.dbLabel}`);
      console.log(
        `Running scraper "${sourceName}" with options:`,
        JSON.stringify(guard.options, null, 2),
      );
      const performRun = async (): Promise<ScrapeCliLockedOutcome> => {
        const { runId, result, explainedObservations, explainTruncated } = await orchestrator.run(
          sourceName,
          guard.options,
        );
        console.log(`\nScrapeRun ${runId} finished:`);
        console.log(JSON.stringify(result, null, 2));

        if (!guard.options.dryRun) {
          await markSourceCrawled(sourceName, new Date());
        }

        if (guard.autoMaterialize && !guard.options.dryRun) {
          console.log(`\nMaterializing observations from run ${runId}...`);
          const matResult = await materializeFromRun(runId, { dryRun: false });
          console.log(JSON.stringify(matResult, null, 2));
          if (matResult.errors === 0) {
            console.log(`\nRunning student visibility gate for source ${sourceName}...`);
            console.log(
              JSON.stringify(
                await runStudentVisibilityGate({
                  collection: 'all',
                  mode: 'apply',
                  sourceName,
                }),
                null,
                2,
              ),
            );
          }
        }
        const report = await getScrapeRunReport(runId);
        const deferredMaterialization = unmaterializedWriteRunWarning({
          runId,
          dryRun: Boolean(guard.options.dryRun),
          autoMaterialize: guard.autoMaterialize,
          observationCount: report.observations.total,
        });
        if (deferredMaterialization) console.warn(`\nWARNING: ${deferredMaterialization}`);
        const explainedReport = explainedObservations
          ? {
              ...report,
              dryRunPreview: {
                ...(report.dryRunPreview ?? {}),
                observations: explainedObservations,
                explainedObservationCount: explainedObservations.length,
                explainTruncated: explainTruncated === true,
              },
            }
          : report;
        const output = await writeOptionalJsonOutput({
          outputPath: flags.output,
          payload: buildScraperCliOutputPayload(explainedReport, {
            command: 'run',
            environment: guard.environment,
            db: connectedDbLabel(),
            options: {
              sourceName,
              ...guard.options,
              autoMaterialize: guard.autoMaterialize,
              output: typeof flags.output === 'string' ? flags.output : undefined,
            },
          }),
          label: 'ScrapeRun report',
        });
        if (!output.saved) {
          console.log(`\nRun report for ${runId}:`);
          console.log(JSON.stringify(report, null, 2));
        }
        const runStatus = (report as { run?: { status?: string } }).run?.status;
        return { runId, failed: runStatus === 'failure' };
      };

      // A dry run writes no Observations, so it does not contend for the lock.
      // It still reports a live holder, because a plan or an --explain audit read
      // while another writer changes the same source is not reproducible, and that
      // silent race is what makes an unfenced CLI expensive (#2498).
      if (guard.options.dryRun) {
        await warnWhenSourceIsBeingWritten(guard.environment, sourceName);
        await performRun();
        return;
      }

      const runRefusal = await runUnderScrapeJobLock({
        environment: guard.environment,
        sourceName,
        ownerLabel: 'scrape-cli-run',
        refusal:
          'Two concurrent writers on one source interleave their writes, so this run did not start.',
        run: performRun,
      });
      if (runRefusal) process.exitCode = 1;
      return;
    }

    if (command === 'cron') {
      if (preflight.command !== 'cron') throw new Error('Invalid cron preflight state.');
      const cronPreflight = preflight as Extract<ScraperCliPreflight, { command: 'cron' }>;
      const { sourceName, guard } = cronPreflight;
      for (const warning of guard.warnings) console.warn(`WARNING: ${warning}`);
      console.log(`Scraper environment: ${guard.environment}; Mongo target: ${guard.dbLabel}`);
      const result = await runScraperCron(
        {
          sourceName,
          environment: guard.environment,
          options: guard.options,
          forceDisabled: cronPreflight.forceDisabled,
        },
        createCronRunnerDependencies(orchestrator),
      );

      const { report, ...summary } = result as any;
      console.log(`\nCron scrape result for "${sourceName}":`);
      console.log(JSON.stringify(summary, null, 2));
      const cronOutput = await writeOptionalJsonOutput({
        outputPath: flags.output,
        payload: buildScraperCliOutputPayload(buildCronOutputPayload(result), {
          command: 'cron',
          environment: guard.environment,
          db: connectedDbLabel(),
          options: {
            sourceName,
            ...guard.options,
            forceDisabled: cronPreflight.forceDisabled,
            output: typeof flags.output === 'string' ? flags.output : undefined,
          },
        }),
        label: 'cron scrape report',
      });
      if (report) {
        if (!cronOutput.saved) {
          console.log(
            `\nRun report for ${result.status === 'completed' ? result.runId : sourceName}:`,
          );
          console.log(JSON.stringify(report, null, 2));
        }
      }
      if (result.exitCode !== 0) process.exitCode = result.exitCode;
      return;
    }

    if (command === 'materialize') {
      if (preflight.command !== 'materialize') {
        throw new Error('Invalid materialize preflight state.');
      }
      const materializePreflight = preflight as Extract<
        ScraperCliPreflight,
        { command: 'materialize' }
      >;
      const { runId, confirmMaterialize, guard } = materializePreflight;
      console.log(`Materializing observations from run ${runId}...`);
      for (const warning of guard.warnings) console.warn(`WARNING: ${warning}`);
      console.log(`Scraper environment: ${guard.environment}; Mongo target: ${guard.dbLabel}`);
      const performMaterialize = async (): Promise<ScrapeCliLockedOutcome> => {
        const result = await materializeFromRun(runId, { dryRun: guard.options.dryRun });
        console.log(JSON.stringify(result, null, 2));
        const report = await getScrapeRunReport(runId);
        let visibilityGate: unknown | undefined;
        if (!guard.options.dryRun && result.errors === 0) {
          const sourceName = (report as any).run?.sourceName;
          console.log(
            `\nRunning student visibility gate${sourceName ? ` for source ${sourceName}` : ''}...`,
          );
          visibilityGate = await runStudentVisibilityGate({
            collection: 'all',
            mode: 'apply',
            sourceName,
          });
          console.log(JSON.stringify(visibilityGate, null, 2));
        }
        const output = await writeOptionalJsonOutput({
          outputPath: flags.output,
          payload: buildScraperCliOutputPayload(
            buildMaterializeOutputPayload({
              runId,
              materialization: result,
              report,
              visibilityGate,
            }),
            {
              command: 'materialize',
              environment: guard.environment,
              db: connectedDbLabel(),
              options: {
                runId,
                ...guard.options,
                confirmMaterialize,
                output: typeof flags.output === 'string' ? flags.output : undefined,
              },
            },
          ),
          label: 'materialize report',
        });
        if (!output.saved) {
          console.log(`\nRun report for ${runId}:`);
          console.log(JSON.stringify(report, null, 2));
        }
        return { runId, failed: result.errors > 0 };
      };

      // Guarding `run` alone would leave a hole: a standalone materialize writes
      // entities for the run's source, so it has to take that source's lock too.
      // The lock is keyed per source, so the source has to be resolved from the
      // run first (#2498). Only the source name is needed, so this must not build
      // the run report: `performMaterialize` builds it anyway, and for an
      // exhaustive run that means loading every Observation of the run twice.
      const materializeSourceName = await resolveScrapeRunSourceName(runId);

      // A dry run writes nothing, so it does not contend for the lock. It still
      // reports a live holder, for the same reason `run --dry-run` does: a plan
      // read while another writer changes the same source is not reproducible.
      if (guard.options.dryRun) {
        if (materializeSourceName) {
          await warnWhenSourceIsBeingWritten(guard.environment, materializeSourceName);
        }
        await performMaterialize();
        return;
      }

      if (!materializeSourceName) {
        console.warn(
          `WARNING: could not resolve the source for run ${runId}, so this materialize is unlocked and may interleave with a concurrent scrape.`,
        );
        await performMaterialize();
        return;
      }

      const materializeRefusal = await runUnderScrapeJobLock({
        environment: guard.environment,
        sourceName: materializeSourceName,
        ownerLabel: 'scrape-cli-materialize',
        refusal:
          'Materializing while that source is being written would interleave entity writes, so this did not start.',
        run: performMaterialize,
      });
      if (materializeRefusal) process.exitCode = 1;
      return;
    }

    if (command === 'report') {
      const runId = flags.run as string;
      if (!runId) {
        console.error('ERROR: --run <runId> is required');
        process.exit(1);
      }
      const report = await getScrapeRunReport(runId);
      const output = await writeOptionalJsonOutput({
        outputPath: flags.output,
        payload: buildScraperCliOutputPayload(report, {
          command: 'report',
          environment: resolveScraperEnvironment(),
          db: connectedDbLabel(),
          options: {
            runId,
            output: typeof flags.output === 'string' ? flags.output : undefined,
          },
        }),
        label: 'ScrapeRun report',
      });
      if (!output.saved) {
        console.log(JSON.stringify(report, null, 2));
      }
      return;
    }

    if (command === 'prune-observations') {
      if (preflight.command !== 'prune-observations') {
        throw new Error('Invalid prune preflight state.');
      }
      const prunePreflight = preflight as Extract<
        ScraperCliPreflight,
        { command: 'prune-observations' }
      >;
      const { olderThanDays, keepRuns, sourceName, confirmObservationPrune, guard } =
        prunePreflight;
      for (const warning of guard.warnings) console.warn(`WARNING: ${warning}`);
      console.log(`Scraper environment: ${guard.environment}; Mongo target: ${guard.dbLabel}`);
      const result = await pruneSupersededObservations({
        olderThanDays,
        keepRuns,
        sourceName,
        apply: guard.apply,
      });
      if (!result.projectionNeutral) {
        console.warn(
          'WARNING: the materializer currently projects superseded rows (C4_LOSSLESS_INGEST), so these candidates are not dead storage and deletion is refused.',
        );
      }
      const output = await writeOptionalJsonOutput({
        outputPath: flags.output,
        payload: buildScraperCliOutputPayload(result, {
          command: 'prune-observations',
          environment: guard.environment,
          db: connectedDbLabel(),
          options: {
            olderThanDays,
            keepRuns,
            sourceName,
            apply: guard.apply,
            confirmObservationPrune,
            output: typeof flags.output === 'string' ? flags.output : undefined,
          },
        }),
        label: 'prune-observations report',
      });
      if (!output.saved) {
        console.log(JSON.stringify(result, null, 2));
      }
      return;
    }

    console.error(`Unknown command: ${command}. Use "help" for usage.`);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(sanitizeLogValue(err));
    process.exit(1);
  });
}
