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
 *   --db-review     During dry-run, compare emitted evidence against current DB coverage
 *   --use-cache     Memoize external fetches in ScrapeSnapshot collection (dev only)
 *   --release       Production mode (cache off, errors surface)
 *   --limit <n>     Cap the number of entities the scraper processes
 *   --offset <n>    Skip the first n entities after source-specific ordering
 *   --only <keys>   Comma-separated source-specific keys/netids to process
 *   --only-file <path>
 *                  Load `only` keys from a student visibility repair target report
 *   --target-bucket <name>
 *                  Bucket inside --only-file to use
 *   --batch <n>    One-based batch number for --only-file targets
 *   --batch-size <n>
 *                  Number of --only-file targets per batch (default 50)
 *   --since <date>  Restrict scrapers that support recency filters
 *   --ignore-work-planner  Bypass freshness skips for full audit/backfill runs
 *   --auto-materialize   After successful run, immediately materialize observations
 *   --visibility-gate-mode <dry-run|apply>
 *                  Gate mode after --auto-materialize (default apply)
 *   --allow-visibility-demotions
 *                  Allow source-scoped public-to-held gate demotions after materialization
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
      const equalsIndex = a.indexOf('=');
      if (equalsIndex > 2) {
        flags[a.slice(2, equalsIndex)] = a.slice(equalsIndex + 1);
        continue;
      }
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

export function parseScraperOptions(flags: Record<string, string | boolean>): ScraperOptions {
  const options: ScraperOptions = {
    dryRun: !!flags['dry-run'],
    useCache: !!flags['use-cache'] && !flags.release,
    release: !!flags.release,
    dbReview: !!flags['db-review'],
    limit: flags.limit ? parseInt(String(flags.limit), 10) : undefined,
    offset: flags.offset ? parseInt(String(flags.offset), 10) : undefined,
    only:
      typeof flags.only === 'string'
        ? flags.only
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    onlyFile: typeof flags['only-file'] === 'string' ? flags['only-file'] : undefined,
    targetBucket: typeof flags['target-bucket'] === 'string' ? flags['target-bucket'] : undefined,
    batch: flags.batch ? parseInt(String(flags.batch), 10) : undefined,
    batchSize: flags['batch-size'] ? parseInt(String(flags['batch-size']), 10) : undefined,
    visibilityGateMode:
      flags['visibility-gate-mode'] === 'dry-run' || flags['visibility-gate-mode'] === 'apply'
        ? flags['visibility-gate-mode']
        : undefined,
    allowVisibilityDemotions: !!flags['allow-visibility-demotions'],
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
  if (
    flags['visibility-gate-mode'] !== undefined &&
    flags['visibility-gate-mode'] !== 'dry-run' &&
    flags['visibility-gate-mode'] !== 'apply'
  ) {
    throw new Error('--visibility-gate-mode must be either dry-run or apply');
  }

  return options;
}

interface TargetReportBucket {
  slugs?: unknown;
}

export function selectOnlyFromTargetReport(
  report: Record<string, unknown>,
  options: { targetBucket: string; batch: number; batchSize: number },
): string[] {
  if (!Number.isFinite(options.batch) || options.batch < 1) {
    throw new Error('--batch must be a number greater than or equal to 1');
  }
  if (!Number.isFinite(options.batchSize) || options.batchSize < 1) {
    throw new Error('--batch-size must be a number greater than or equal to 1');
  }
  const bucket = (report[options.targetBucket] ||
    (report.buckets as Record<string, unknown> | undefined)?.[options.targetBucket]) as
    | TargetReportBucket
    | undefined;
  if (!bucket) {
    throw new Error(`Target bucket "${options.targetBucket}" was not found in --only-file report`);
  }
  if (!Array.isArray(bucket.slugs)) {
    throw new Error(`Target bucket "${options.targetBucket}" must include a slugs array`);
  }
  const slugs = bucket.slugs
    .filter((slug): slug is string => typeof slug === 'string')
    .map((slug) => slug.trim())
    .filter(Boolean);
  const start = (Math.floor(options.batch) - 1) * Math.floor(options.batchSize);
  return slugs.slice(start, start + Math.floor(options.batchSize));
}

async function loadOnlyFromTargetFile(flags: Record<string, string | boolean>): Promise<string[] | undefined> {
  if (flags['only-file'] === undefined) return undefined;
  if (typeof flags['only-file'] !== 'string' || !flags['only-file'].trim()) {
    throw new Error('--only-file requires a JSON report path');
  }
  if (typeof flags['target-bucket'] !== 'string' || !flags['target-bucket'].trim()) {
    throw new Error('--target-bucket is required when using --only-file');
  }
  const batch = parseIntegerFlag(flags, 'batch', 1, { min: 1 });
  const batchSize = parseIntegerFlag(flags, 'batch-size', 50, { min: 1 });
  const onlyFile = flags['only-file'];
  const targetBucket = flags['target-bucket'];
  const filePath = path.resolve(onlyFile);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error: any) {
    throw new Error(`Unable to read --only-file ${filePath}: ${error?.message || String(error)}`);
  }
  let report: Record<string, unknown>;
  try {
    report = JSON.parse(raw) as Record<string, unknown>;
  } catch (error: any) {
    throw new Error(`Unable to parse --only-file ${filePath} as JSON: ${error?.message || String(error)}`);
  }
  return selectOnlyFromTargetReport(report, {
    targetBucket: targetBucket.trim(),
    batch,
    batchSize,
  });
}

async function applyTargetFileOptions(
  options: ScraperOptions,
  flags: Record<string, string | boolean>,
): Promise<ScraperOptions> {
  const only = await loadOnlyFromTargetFile(flags);
  if (!only) return options;
  return { ...options, only };
}

function publicToHeldDemotionCount(report: Awaited<ReturnType<typeof runStudentVisibilityGate>>): number {
  const transitions = report.changedTierSummary?.byTransition || {};
  return Object.entries(transitions).reduce((count, [transition, value]) => {
    if (
      /^student_ready->(operator_review|suppressed)$/.test(transition) ||
      /^limited_but_safe->(operator_review|suppressed)$/.test(transition)
    ) {
      return count + value;
    }
    return count;
  }, 0);
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
  --db-review          During dry-run, report evidence-coverage impact against current DB rows
  --use-cache          Cache external fetches in ScrapeSnapshot (dev)
  --release            Production mode
  --limit <n>          Cap entities processed
  --offset <n>         Skip first n ordered entities
  --only <keys>        Comma-separated source-specific keys/netids
  --only-file <path>   Load --only keys from a repair target JSON report
  --target-bucket <name>
                       Bucket inside --only-file to use
  --batch <n>          One-based batch number for --only-file targets
  --batch-size <n>     Number of --only-file targets per batch (default 50)
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
  --visibility-gate-mode <dry-run|apply>
                       Gate mode after --auto-materialize; use dry-run for repair batches
  --allow-visibility-demotions
                       Allow source-scoped public-to-held gate demotions after materialization

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
      const options = await applyTargetFileOptions(parseScraperOptions(flags), flags);
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
          const visibilityGateMode = guard.options.visibilityGateMode || 'apply';
          console.log(`\nRunning student visibility gate for source ${sourceName} (${visibilityGateMode})...`);
          const gateDryRun = await runStudentVisibilityGate({
            collection: 'all',
            mode: 'dry-run',
            sourceName,
          });
          const demotionCount = publicToHeldDemotionCount(gateDryRun);
          if (
            visibilityGateMode === 'apply' &&
            demotionCount > 0 &&
            !guard.options.allowVisibilityDemotions
          ) {
            throw new Error(
              `Refusing to apply student visibility gate for source ${sourceName}: dry-run found ${demotionCount} public-to-held demotion(s). Re-run with --visibility-gate-mode=dry-run to inspect or --allow-visibility-demotions to apply intentionally.`,
            );
          }
          const gateReport =
            visibilityGateMode === 'apply'
              ? await runStudentVisibilityGate({
                  collection: 'all',
                  mode: 'apply',
                  sourceName,
                })
              : gateDryRun;
          console.log(JSON.stringify(gateReport, null, 2));
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
      const options = await applyTargetFileOptions(parseScraperOptions(flags), flags);
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

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
