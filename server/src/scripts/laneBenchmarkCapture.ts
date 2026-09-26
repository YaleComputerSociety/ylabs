import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { LaneBenchmark, LaneBenchmarkPage } from '../models/laneBenchmark';
import { ResearchEntity } from '../models/researchEntity';
import { beginBenchmarkCapture, finishBenchmarkCapture } from '../scrapers/snapshotBenchmarkMode';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { liveFieldValueRefusals } from '../utils/researchEntityFieldValueRefusals';
import {
  assertBenchmarkableLane,
  currentCodeSha,
  runLaneDry,
  slugsForPlannedEntities,
} from './laneBenchmarkRun';
import type { BenchmarkLabel } from './laneScorecardCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'lane:benchmark-capture';
export const CONFIRM_FLAG = '--confirm-lane-benchmark-capture';
const BENCHMARK_ID = /^[a-z0-9][a-z0-9-]{2,80}$/;

export interface CaptureArgs {
  sourceName: string;
  benchmarkId: string;
  only: string[];
  limit?: number;
  dryRun: boolean;
  confirmed: boolean;
}

export function parseCaptureArgs(argv: string[]): CaptureArgs {
  const args: Partial<CaptureArgs> & { only: string[]; dryRun: boolean; confirmed: boolean } = {
    only: [],
    dryRun: true,
    confirmed: false,
  };
  for (const arg of argv) {
    if (arg === '--apply') args.dryRun = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === CONFIRM_FLAG) args.confirmed = true;
    else if (arg.startsWith('--source=')) args.sourceName = arg.slice('--source='.length).trim();
    else if (arg.startsWith('--id=')) args.benchmarkId = arg.slice('--id='.length).trim();
    else if (arg.startsWith('--only='))
      args.only = arg
        .slice('--only='.length)
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    else if (arg.startsWith('--limit=')) {
      const limit = Number(arg.slice('--limit='.length));
      if (!Number.isInteger(limit) || limit < 1)
        throw new Error('--limit must be a positive integer');
      args.limit = limit;
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (!args.sourceName) throw new Error(`${SCRIPT_NAME} requires --source=<lane>`);
  if (!args.benchmarkId || !BENCHMARK_ID.test(args.benchmarkId)) {
    throw new Error(
      `${SCRIPT_NAME} requires --id=<benchmark-id> of lowercase letters, digits and hyphens`,
    );
  }
  if (args.only.length === 0 && args.limit === undefined) {
    throw new Error(`${SCRIPT_NAME} requires --only or --limit, so the benchmark is a fixed scope`);
  }
  assertBenchmarkableLane(args.sourceName);
  return args as CaptureArgs;
}

async function freezeLabels(slugs: readonly string[]): Promise<BenchmarkLabel[]> {
  const rows = (await ResearchEntity.find({ slug: { $in: [...slugs] } })
    .select('slug fieldValueRefusals')
    .lean()) as unknown as Array<{ slug: string; fieldValueRefusals?: unknown }>;
  const labels: BenchmarkLabel[] = [];
  for (const row of rows) {
    const byField = row.fieldValueRefusals as Record<string, unknown> | undefined;
    for (const field of Object.keys(byField ?? {})) {
      for (const refusal of liveFieldValueRefusals(byField, field)) {
        labels.push({ entityKey: row.slug, field, valueKey: refusal.valueKey, rule: refusal.rule });
      }
    }
  }
  return labels;
}

async function main(): Promise<void> {
  const args = parseCaptureArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: !args.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!args.dryRun && !args.confirmed)
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${args.dryRun ? 'dry-run' : 'apply'}`,
  );
  await initializeConnections();

  if (await LaneBenchmark.exists({ benchmarkId: args.benchmarkId })) {
    throw new Error(
      `Benchmark ${args.benchmarkId} already exists; a benchmark is frozen once captured`,
    );
  }

  beginBenchmarkCapture();
  let pages;
  let run;
  try {
    run = await runLaneDry(args);
  } finally {
    pages = finishBenchmarkCapture();
  }
  if (run.truncated) throw new Error('The lane planned more values than the capture can hold');

  const slugById = await slugsForPlannedEntities(run.observations);
  const slugs = new Set<string>();
  for (const observation of run.observations) {
    if (observation.entityType !== 'researchEntity') continue;
    const slug =
      (typeof observation.entityKey === 'string' && observation.entityKey) ||
      slugById.get(String(observation.entityId ?? ''));
    if (slug) slugs.add(slug);
  }
  const labels = await freezeLabels([...slugs]);

  const report = {
    script: SCRIPT_NAME,
    mode: args.dryRun ? 'dry-run' : 'apply',
    benchmarkId: args.benchmarkId,
    sourceName: args.sourceName,
    pageCount: pages.length,
    plannedObservationCount: run.observations.length,
    researchEntitiesPlanned: slugs.size,
    labelCount: labels.length,
  };

  if (!args.dryRun) {
    if (pages.length === 0)
      throw new Error('The capture fetched no pages; refusing to store an empty benchmark');
    await LaneBenchmarkPage.insertMany(
      pages.map((page) => ({ ...page, benchmarkId: args.benchmarkId })),
      { ordered: true },
    );
    await LaneBenchmark.create({
      benchmarkId: args.benchmarkId,
      sourceName: args.sourceName,
      only: args.only,
      limit: args.limit,
      capturedAt: new Date(),
      environment: guard.environment,
      databaseName: mongoose.connection.db?.databaseName ?? 'unknown',
      codeSha: currentCodeSha(),
      pageCount: pages.length,
      plannedObservationCount: run.observations.length,
      labels,
    });
  }
  console.log(JSON.stringify(report, null, 2));
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
