/**
 * CLI entry point for scrapers.
 *
 * Usage:
 *   npx tsx server/src/scrapers/cli.ts list
 *   npx tsx server/src/scrapers/cli.ts run --source openalex [flags] [--output <path>]
 *   npx tsx server/src/scrapers/cli.ts cron --source openalex --release
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
 *   --auto-materialize   After successful run, immediately materialize observations
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { buildOrchestrator } from './registry';
import { materializeFromRun } from './entityMaterializer';
import { getScrapeRunReport } from './runReport';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import { resolveScraperEnvironment, summarizeMongoUrl } from './scraperEnvironment';
import { createCronRunnerDependencies, runScraperCron } from './cronRunner';
import { pruneSupersededObservations } from './observationRetention';
import { writeOptionalJsonOutput } from './scraperCliOutput';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  buildCronOutputPayload,
  buildMaterializeOutputPayload,
  buildScraperCliOutputPayload,
  buildScraperCliPreflight,
  parseArgs,
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
} from './cliHelpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export async function main(): Promise<void> {
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
  prune-observations [flags]                 Prune old superseded Observation rows

Run flags:
  --dry-run            Skip Observation writes (preview only)
  --use-cache          Cache external fetches in ScrapeSnapshot (dev)
  --release            Production mode
  --limit <n>          Cap entities processed
  --offset <n>         Skip first n ordered entities
  --only <keys>        Comma-separated source-specific keys/netids
  --since <date>       Restrict scrapers that support recency filters
  --discover-openalex-authors
                       For openalex, allow expensive name-only author discovery
  --max-openalex-pages-per-author <n>
                       For openalex, cap cursor pages per resolved author
  --manual-recipient-csv-dir <path>
                       For undergrad-fellowships-recipients, read <programKey>.csv files
  --ignore-work-planner
                       Bypass freshness skips for full audit/backfill runs
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

Environment guardrails:
  SCRAPER_ENV=development|beta|production
  Non-production runs default to --dry-run and disable --auto-materialize.
  Production writes require --release and CONFIRM_PROD_SCRAPE=true.
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
      mongoose.connection.db?.databaseName ||
      mongoose.connection.name ||
      summarizeMongoUrl(url);

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
      const { runId, result } = await orchestrator.run(sourceName, guard.options);
      console.log(`\nScrapeRun ${runId} finished:`);
      console.log(JSON.stringify(result, null, 2));

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
      const output = await writeOptionalJsonOutput({
        outputPath: flags.output,
        payload: buildScraperCliOutputPayload(report, {
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
      const result = await materializeFromRun(runId, { dryRun: guard.options.dryRun });
      console.log(JSON.stringify(result, null, 2));
      const report = await getScrapeRunReport(runId);
      let visibilityGate: unknown | undefined;
      if (!guard.options.dryRun && result.errors === 0) {
        const sourceName = (report as any).run?.sourceName;
        console.log(`\nRunning student visibility gate${sourceName ? ` for source ${sourceName}` : ''}...`);
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
