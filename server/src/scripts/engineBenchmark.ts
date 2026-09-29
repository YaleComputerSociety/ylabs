import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { EngineBenchmark } from '../models/engineBenchmark';
import { EngineBenchmarkSnapshot } from '../models/engineBenchmarkSnapshot';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  diffEngineReplays,
  diffEngineSnapshots,
  engineOutputFingerprint,
  scoreEngineReplay,
  type EngineBenchmarkLabel,
  type EngineReplayScore,
  type ReplayedRow,
} from './engineBenchmarkCore';
import {
  captureEngineBenchmark,
  currentCodeSha,
  ENGINE_BENCHMARK_STAGE,
  replayEngineBenchmark,
} from './engineBenchmarkRun';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'engine:benchmark';
export const CONFIRM_FLAG = '--confirm-engine-benchmark';
const DEFAULT_BENCHMARK_ID = 'engine-known-defect-arms';
const DEFAULT_PER_SCOPE_LIMIT = 20;

export interface EngineBenchmarkArgs {
  dryRun: boolean;
  confirmed: boolean;
  capture: boolean;
  benchmarkId: string;
  perScopeLimit: number;
  replays: number;
  output?: string;
}

export function parseEngineBenchmarkArgs(argv: string[]): EngineBenchmarkArgs {
  const options: EngineBenchmarkArgs = {
    dryRun: true,
    confirmed: false,
    capture: false,
    benchmarkId: DEFAULT_BENCHMARK_ID,
    perScopeLimit: DEFAULT_PER_SCOPE_LIMIT,
    replays: 1,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.dryRun = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === CONFIRM_FLAG) options.confirmed = true;
    else if (arg === '--capture') options.capture = true;
    else if (arg.startsWith('--benchmark=')) {
      options.benchmarkId = arg.slice('--benchmark='.length).trim();
      if (!options.benchmarkId) throw new Error('--benchmark needs a benchmark id');
    } else if (arg.startsWith('--per-scope-limit=')) {
      options.perScopeLimit = Number(arg.slice('--per-scope-limit='.length));
      if (!Number.isInteger(options.perScopeLimit) || options.perScopeLimit < 1)
        throw new Error('--per-scope-limit must be a positive integer');
    } else if (arg.startsWith('--replays=')) {
      options.replays = Number(arg.slice('--replays='.length));
      if (!Number.isInteger(options.replays) || options.replays < 1)
        throw new Error('--replays must be a positive integer');
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (options.capture && options.dryRun) {
    throw new Error(`${SCRIPT_NAME} --capture writes the frozen input, so it requires --apply`);
  }
  return options;
}

/**
 * Whether a fingerprint change can be read as a code change at all.
 *
 * A row whose input the capture did not fully freeze, or a quarantine set that moved
 * between capture and replay, means the input moved too, so the change is unattributable.
 * Reported as a frozen-input leak rather than as a regression (#3591), because a
 * measurement that calls an input change a regression is worse than none: it trains the
 * reader to ignore it.
 */
export function fingerprintChangeIsAttributable(snapshot: {
  rowsWithIncompleteInput: number;
  invalidatedRunSetChanged: boolean;
}): boolean {
  return snapshot.rowsWithIncompleteInput === 0 && !snapshot.invalidatedRunSetChanged;
}

async function main(): Promise<void> {
  const options = parseEngineBenchmarkArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: !options.dryRun,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  if (!options.dryRun && !options.confirmed)
    throw new Error(`${SCRIPT_NAME} apply requires ${CONFIRM_FLAG}`);
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${
      options.dryRun ? 'dry-run' : 'apply'
    }${options.capture ? '; capturing frozen input' : ''}`,
  );
  await initializeConnections();

  const capture = options.capture
    ? await captureEngineBenchmark({
        benchmarkId: options.benchmarkId,
        perScopeLimit: options.perScopeLimit,
      })
    : undefined;

  const benchmark = (await EngineBenchmark.findOne({ benchmarkId: options.benchmarkId })
    .select('labels')
    .lean()) as { labels?: EngineBenchmarkLabel[] } | null;
  // Reported rather than thrown, because this stage runs inside the Development sweep and
  // an environment where no operator has captured a benchmark yet has nothing wrong with
  // it. Failing the whole sweep on a missing fixture would make the sweep's own signal
  // worse than the measurement is worth.
  if (!benchmark) {
    console.log(
      JSON.stringify(
        {
          script: SCRIPT_NAME,
          mode: options.dryRun ? 'dry-run' : 'apply',
          stored: 0,
          unscored: [
            {
              benchmarkId: options.benchmarkId,
              reason: `no frozen engine benchmark exists; capture one with ${SCRIPT_NAME} --capture --apply ${CONFIRM_FLAG}`,
            },
          ],
        },
        null,
        2,
      ),
    );
    await mongoose.disconnect();
    return;
  }

  const previousSnapshot = await EngineBenchmarkSnapshot.findOne({
    benchmarkId: options.benchmarkId,
    stage: ENGINE_BENCHMARK_STAGE,
  })
    .sort({ measuredAt: -1 })
    .lean();

  const replays: ReplayedRow[][] = [];
  let invalidatedRunSetChanged = false;
  let cardSynthesisRequested = 0;
  for (let i = 0; i < options.replays; i += 1) {
    const replay = await replayEngineBenchmark(options.benchmarkId);
    replays.push(replay.rows);
    invalidatedRunSetChanged = invalidatedRunSetChanged || replay.invalidatedRunSetChanged;
    cardSynthesisRequested = replay.cardSynthesisRequested;
  }

  const rows = replays[0];
  const score = scoreEngineReplay(rows, benchmark.labels ?? []);
  const fingerprints = [...new Set(replays.map(engineOutputFingerprint))];
  const previousFingerprint = (previousSnapshot as any)?.outputFingerprint as string | undefined;
  const delta = diffEngineSnapshots(
    score,
    previousSnapshot
      ? {
          byField: ((previousSnapshot as any).byField ?? []) as EngineReplayScore['byField'],
          gateTiers: ((previousSnapshot as any).gateTiers ?? []) as EngineReplayScore['gateTiers'],
        }
      : null,
  );

  const snapshot = {
    measuredAt: new Date(),
    environment: guard.environment,
    databaseName: mongoose.connection.db?.databaseName ?? 'unknown',
    benchmarkId: options.benchmarkId,
    stage: ENGINE_BENCHMARK_STAGE,
    codeSha: currentCodeSha(),
    ...score,
    invalidatedRunSetChanged,
    previousFingerprint,
    fingerprintChanged: previousFingerprint
      ? previousFingerprint !== score.outputFingerprint
      : undefined,
    cardSynthesisRequested,
    byFieldDelta: delta.byField,
    gateTierDelta: delta.gateTiers,
  };
  // A replay that does not agree with itself cannot be compared to a later one, so storing it
  // would put a row in the trend that no future run can be measured against. Refused rather than
  // stored-and-flagged: #3418 and #2513 are both cases where a row nobody could interpret was
  // read as a signal anyway.
  const reproducible = fingerprints.length === 1;
  if (!options.dryRun && reproducible) await EngineBenchmarkSnapshot.create(snapshot);

  const report = {
    script: SCRIPT_NAME,
    mode: options.dryRun ? 'dry-run' : 'apply',
    stored: options.dryRun || !reproducible ? 0 : 1,
    ...(capture ? { capture } : {}),
    replays: options.replays,
    distinctFingerprints: fingerprints.length,
    fingerprintChangeIsAttributable: fingerprintChangeIsAttributable(snapshot),
    ...(reproducible ? {} : { notStored: 'the replays disagreed, so this run is not comparable' }),
    ...(fingerprints.length > 1
      ? { replayDisagreement: diffEngineReplays(replays[0], replays[1]) }
      : {}),
    // Said out loud in the report as well as stored, because the failure this closes was a reader
    // seeing a moved fingerprint and a reassuring per-field count (#3871).
    valuesLostSincePreviousSnapshot: delta.byField
      .filter((field) => field.valuesDelta < 0)
      .map((field) => ({ field: field.field, valuesDelta: field.valuesDelta })),
    snapshot,
  };
  console.log(JSON.stringify(report, null, 2));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  await mongoose.disconnect();
  if (fingerprints.length > 1) {
    console.error(
      `${options.replays} replays of unchanged code gave ${fingerprints.length} fingerprints, so the engine reads something the benchmark did not freeze`,
    );
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
