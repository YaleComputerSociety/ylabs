import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { LaneBenchmark, LaneBenchmarkPage } from '../models/laneBenchmark';
import { LaneScorecardSnapshot } from '../models/laneScorecardSnapshot';
import {
  beginBenchmarkReplay,
  finishBenchmarkReplay,
  type CapturedPage,
} from '../scrapers/snapshotBenchmarkMode';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { currentCodeSha, runLaneDry, slugsForPlannedEntities } from './laneBenchmarkRun';
import { scoreLaneReplay, type BenchmarkLabel } from './laneScorecardCore';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'lane:scorecard';
export const CONFIRM_FLAG = '--confirm-lane-scorecard';

export function parseLaneScorecardArgs(argv: string[]): {
  dryRun: boolean;
  confirmed: boolean;
  benchmarkId?: string;
  output?: string;
} {
  const options: { dryRun: boolean; confirmed: boolean; benchmarkId?: string; output?: string } = {
    dryRun: true,
    confirmed: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg.startsWith('--benchmark='))
      options.benchmarkId = arg.slice('--benchmark='.length).trim();
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseLaneScorecardArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed)
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${options.dryRun ? 'dry-run' : 'apply'}`,
  );
  await initializeConnections();

  const benchmarks = (await LaneBenchmark.find(
    options.benchmarkId ? { benchmarkId: options.benchmarkId } : {},
  )
    .sort({ benchmarkId: 1 })
    .lean()) as unknown as Array<{
    benchmarkId: string;
    sourceName: string;
    only?: string[];
    limit?: number;
    labels?: BenchmarkLabel[];
  }>;
  if (options.benchmarkId && benchmarks.length === 0) {
    throw new Error(`No benchmark ${options.benchmarkId}`);
  }

  const codeSha = currentCodeSha();
  const databaseName = mongoose.connection.db?.databaseName ?? 'unknown';
  const results: Array<Record<string, unknown>> = [];
  for (const benchmark of benchmarks) {
    const pages = (await LaneBenchmarkPage.find({ benchmarkId: benchmark.benchmarkId })
      .select('sourceName requestKey payload fetchedAt')
      .lean()) as unknown as CapturedPage[];
    beginBenchmarkReplay(pages);
    let run;
    let replay;
    try {
      run = await runLaneDry({
        sourceName: benchmark.sourceName,
        only: benchmark.only ?? [],
        limit: benchmark.limit,
      });
    } finally {
      replay = finishBenchmarkReplay();
    }
    const score = scoreLaneReplay(
      run.observations,
      benchmark.labels ?? [],
      await slugsForPlannedEntities(run.observations),
    );
    const snapshot = {
      measuredAt: new Date(),
      environment: guard.environment,
      databaseName,
      benchmarkId: benchmark.benchmarkId,
      sourceName: benchmark.sourceName,
      codeSha,
      pagesServed: replay.pagesServed,
      pagesMissed: replay.pagesMissed,
      ...score,
    };
    if (!options.dryRun) await LaneScorecardSnapshot.create(snapshot);
    results.push({ ...snapshot, networkBlocks: replay.networkBlocks, truncated: run.truncated });
  }

  const report = {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    benchmarks: results.length,
    stored: options.dryRun ? 0 : results.length,
    results,
  };
  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
