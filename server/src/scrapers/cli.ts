/**
 * CLI entry point for scrapers.
 *
 * Usage:
 *   npx tsx server/src/scrapers/cli.ts list
 *   npx tsx server/src/scrapers/cli.ts run --source openalex [flags]
 *   npx tsx server/src/scrapers/cli.ts materialize --run <runId>
 *   npx tsx server/src/scrapers/cli.ts report --run <runId>
 *
 * Flags for `run`:
 *   --dry-run       Don't write Observations (just log what would be inserted)
 *   --use-cache     Memoize external fetches in ScrapeSnapshot collection (dev only)
 *   --release       Production mode (cache off, errors surface)
 *   --limit <n>     Cap the number of entities the scraper processes
 *   --auto-materialize   After successful run, immediately materialize observations
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { buildOrchestrator } from './registry';
import { materializeFromRun } from './entityMaterializer';
import { getScrapeRunReport } from './runReport';
import { applyScraperEnvironmentGuards } from './scraperEnvironment';
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

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv);

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`
ylabs scraper CLI

  list                                       List registered scrapers
  run --source <name> [flags]                Run a scraper
  materialize --run <runId>                  Materialize observations from a previous run
  report --run <runId>                       Print a QA report for a ScrapeRun

Run flags:
  --dry-run            Skip Observation writes (preview only)
  --use-cache          Cache external fetches in ScrapeSnapshot (dev)
  --release            Production mode
  --limit <n>          Cap entities processed
  --auto-materialize   Materialize immediately after a successful run

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
      const options: ScraperOptions = {
        dryRun: !!flags['dry-run'],
        useCache: !!flags['use-cache'] && !flags.release,
        release: !!flags.release,
        limit: flags.limit ? parseInt(String(flags.limit), 10) : undefined,
      };
      const guard = applyScraperEnvironmentGuards({
        command: 'run',
        options,
        autoMaterialize: !!flags['auto-materialize'],
        mongoUrl: url,
      });
      for (const warning of guard.warnings) console.warn(`WARNING: ${warning}`);
      console.log(
        `Scraper environment: ${guard.environment}; Mongo target: ${guard.dbLabel}`,
      );
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
      }
      console.log(`\nRun report for ${runId}:`);
      console.log(JSON.stringify(await getScrapeRunReport(runId), null, 2));
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
      console.log(
        `Scraper environment: ${guard.environment}; Mongo target: ${guard.dbLabel}`,
      );
      const result = await materializeFromRun(runId, { dryRun: guard.options.dryRun });
      console.log(JSON.stringify(result, null, 2));
      console.log(`\nRun report for ${runId}:`);
      console.log(JSON.stringify(await getScrapeRunReport(runId), null, 2));
      return;
    }

    if (command === 'report') {
      const runId = flags.run as string;
      if (!runId) {
        console.error('ERROR: --run <runId> is required');
        process.exit(1);
      }
      console.log(JSON.stringify(await getScrapeRunReport(runId), null, 2));
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
