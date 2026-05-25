/**
 * CLI entry point for scrapers.
 *
 * Usage:
 *   npx tsx server/src/scrapers/cli.ts list
 *   npx tsx server/src/scrapers/cli.ts run --source openalex [flags]
 *   npx tsx server/src/scrapers/cli.ts cron --source openalex --release
 *   npx tsx server/src/scrapers/cli.ts materialize --run <runId>
 *   npx tsx server/src/scrapers/cli.ts report --run <runId> [--output <path>]
 *   npx tsx server/src/scrapers/cli.ts prune-observations [--apply]
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
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { buildOrchestrator } from './registry';
import { materializeFromRun } from './entityMaterializer';
import { getScrapeRunReport } from './runReport';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import {
  applyObservationPruneEnvironmentGuards,
  applyScraperEnvironmentGuards,
} from './scraperEnvironment';
import { createCronRunnerDependencies, runScraperCron } from './cronRunner';
import { pruneSupersededObservations } from './observationRetention';
import type { ScraperOptions } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function parseArgs(argv: string[]): { command: string; flags: Record<string, string | boolean> } {
  const command = argv[2] || 'help';
  const flags: Record<string, string | boolean> = {};
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return { command, flags };
}

function parseScraperOptions(flags: Record<string, string | boolean>): ScraperOptions {
  const options: ScraperOptions = {
    dryRun: !!flags['dry-run'],
    useCache: !!flags['use-cache'] && !flags.release,
    release: !!flags.release,
    limit: flags.limit ? parseInt(String(flags.limit), 10) : undefined,
    offset: flags.offset ? parseInt(String(flags.offset), 10) : undefined,
    only:
      typeof flags.only === 'string'
        ? flags.only
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    discoverOpenAlexAuthors: !!flags['discover-openalex-authors'],
    maxOpenAlexPagesPerAuthor: flags['max-openalex-pages-per-author']
      ? parseInt(String(flags['max-openalex-pages-per-author']), 10)
      : undefined,
    manualRecipientCsvDir:
      typeof flags['manual-recipient-csv-dir'] === 'string'
        ? flags['manual-recipient-csv-dir']
        : undefined,
    ignoreWorkPlanner: !!flags['ignore-work-planner'],
    since: flags.since ? new Date(String(flags.since)) : undefined,
  };

  if (flags.since && Number.isNaN(options.since?.getTime())) {
    throw new Error('--since must be a valid date');
  }

  return options;
}

function parseIntegerFlag(
  flags: Record<string, string | boolean>,
  name: string,
  fallback: number,
  options: { min: number },
): number {
  if (flags[name] === undefined) return fallback;
  const value = Number(String(flags[name]));
  if (!Number.isFinite(value) || value < options.min) {
    throw new Error(`--${name} must be a number greater than or equal to ${options.min}`);
  }
  return Math.floor(value);
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv);

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`
ylabs scraper CLI

  list                                       List registered scrapers
  run --source <name> [flags]                Run a scraper
  cron --source <name> --release             Run a production cron-safe scraper job
  materialize --run <runId>                  Materialize observations from a previous run
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

Cron flags:
  --force-disabled     Run a disabled source only for manual recovery
  --output <path>      Save the ScrapeRun report JSON

Prune flags:
  --apply              Delete matching rows. Omit for dry-run.
  --older-than-days <n>
                       Only target superseded observations older than n days (default 30)
  --keep-runs <n>      Keep observations from the latest n runs per source (default 3)
  --source <name>      Restrict pruning to one source

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

  await mongoose.connect(url);

  try {
    if (command === 'run') {
      const sourceName = flags.source as string;
      if (!sourceName) {
        console.error('ERROR: --source <name> is required');
        process.exit(1);
      }
      const options = parseScraperOptions(flags);
      const guard = applyScraperEnvironmentGuards({
        command: 'run',
        options,
        autoMaterialize: !!flags['auto-materialize'],
        mongoUrl: url,
      });
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
      console.log(`\nRun report for ${runId}:`);
      console.log(JSON.stringify(await getScrapeRunReport(runId), null, 2));
      return;
    }

    if (command === 'cron') {
      const sourceName = flags.source as string;
      if (!sourceName) {
        console.error('ERROR: --source <name> is required');
        process.exit(1);
      }
      const options = parseScraperOptions(flags);
      const guard = applyScraperEnvironmentGuards({
        command: 'cron',
        options,
        autoMaterialize: true,
        mongoUrl: url,
      });
      for (const warning of guard.warnings) console.warn(`WARNING: ${warning}`);
      console.log(`Scraper environment: ${guard.environment}; Mongo target: ${guard.dbLabel}`);
      const result = await runScraperCron(
        {
          sourceName,
          environment: guard.environment,
          options: guard.options,
          forceDisabled: !!flags['force-disabled'],
        },
        createCronRunnerDependencies(orchestrator),
      );

      const { report, ...summary } = result as any;
      console.log(`\nCron scrape result for "${sourceName}":`);
      console.log(JSON.stringify(summary, null, 2));
      if (report) {
        if (typeof flags.output === 'string' && flags.output.trim()) {
          const outputPath = path.resolve(flags.output);
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
          console.log(`Saved ScrapeRun report to ${outputPath}`);
        } else {
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
      const runId = flags.run as string;
      if (!runId) {
        console.error('ERROR: --run <runId> is required');
        process.exit(1);
      }
      console.log(`Materializing observations from run ${runId}...`);
      const guard = applyScraperEnvironmentGuards({
        command: 'materialize',
        options: {
          dryRun: !!flags['dry-run'],
          useCache: false,
          release: !!flags.release,
        },
        autoMaterialize: false,
        mongoUrl: url,
      });
      for (const warning of guard.warnings) console.warn(`WARNING: ${warning}`);
      console.log(`Scraper environment: ${guard.environment}; Mongo target: ${guard.dbLabel}`);
      const result = await materializeFromRun(runId, { dryRun: guard.options.dryRun });
      console.log(JSON.stringify(result, null, 2));
      console.log(`\nRun report for ${runId}:`);
      const report = await getScrapeRunReport(runId);
      if (!guard.options.dryRun && result.errors === 0) {
        const sourceName = (report as any).run?.sourceName;
        console.log(`\nRunning student visibility gate${sourceName ? ` for source ${sourceName}` : ''}...`);
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
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (command === 'report') {
      const runId = flags.run as string;
      if (!runId) {
        console.error('ERROR: --run <runId> is required');
        process.exit(1);
      }
      const report = JSON.stringify(await getScrapeRunReport(runId), null, 2);
      if (typeof flags.output === 'string' && flags.output.trim()) {
        const outputPath = path.resolve(flags.output);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, `${report}\n`, 'utf8');
        console.log(`Saved ScrapeRun report to ${outputPath}`);
      } else {
        console.log(report);
      }
      return;
    }

    if (command === 'prune-observations') {
      const olderThanDays = parseIntegerFlag(flags, 'older-than-days', 30, { min: 1 });
      const keepRuns = parseIntegerFlag(flags, 'keep-runs', 3, { min: 0 });
      const guard = applyObservationPruneEnvironmentGuards({
        apply: !!flags.apply,
        mongoUrl: url,
      });
      for (const warning of guard.warnings) console.warn(`WARNING: ${warning}`);
      console.log(`Scraper environment: ${guard.environment}; Mongo target: ${guard.dbLabel}`);
      const result = await pruneSupersededObservations({
        olderThanDays,
        keepRuns,
        sourceName: typeof flags.source === 'string' ? flags.source : undefined,
        apply: guard.apply,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.error(`Unknown command: ${command}. Use "help" for usage.`);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
