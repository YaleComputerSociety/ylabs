import fs from 'fs';
import path from 'path';
import {
  resolveScraperEnvironment,
  resolveMongoDatabaseName,
} from '../scrapers/scraperEnvironment';
import {
  weeklySweepModes,
  type WeeklySweepCorpusSnapshotStatus,
  type WeeklySweepMode,
  type WeeklySweepRunStatus,
  type WeeklySweepStageFailureKind,
  weeklySweepStageFailureKinds,
} from '../models/storedVocabularies';
import { DEVELOPMENT_DATABASE_NAME } from './databaseCopyPairs';
import {
  buildPruneDeadObservationsChildArgs,
  type ScraperSweepMode,
  type SweepSearchIndexOutcome,
  type SweepThrottleRetrySummary,
} from './runScraperSweep';
import type { SweepCodeFreshness } from './sweepCodeFreshness';
import { FAILURE_TAIL_MAX_CHARS } from './scraperSweepLogging';
import type { StageCountRegression, StageUnscoredBenchmark } from './sweepStageJudgement';

export const WEEKLY_SWEEP_MODES = weeklySweepModes;

export type { WeeklySweepMode };

const WEEKLY_SWEEP_CONFIRMATIONS: Record<WeeklySweepMode, string> = {
  'development-full': '--confirm-development-full-sweep',
  'fellowship-development-full': '--confirm-fellowship-sweep',
};

export const WEEKLY_SWEEP_REQUIRED_SECRETS = [
  'MONGODBURL',
  'OPENAI_API_KEY',
  'YALIES_API_KEY',
] as const;

export const WEEKLY_SWEEP_FORBIDDEN_VARIABLES = [
  'BETA_MONGODBURL',
  'PRODUCTION_MONGODBURL',
  'PROD_MONGODBURL',
  'DEVELOPMENT_MONGODBURL',
  'MONGODBURL_MIGRATION',
] as const;

export const WEEKLY_SWEEP_SUMMARY_MARKER = 'WEEKLY_SWEEP_SUMMARY';

export interface WeeklySweepArgs {
  dryRun: boolean;
  confirmed: boolean;
  modes: WeeklySweepMode[];
}

export const WEEKLY_SWEEP_CONFIRM_FLAG = '--confirm-weekly-development-sweep';

function parseWeeklySweepMode(raw: string | undefined): WeeklySweepMode {
  const mode = WEEKLY_SWEEP_MODES.find((candidate) => candidate === raw);
  if (!mode) {
    throw new Error(
      `--mode must be one of ${WEEKLY_SWEEP_MODES.join(', ')}; got ${raw ?? '(missing)'}`,
    );
  }
  return mode;
}

export function parseWeeklySweepArgs(argv: string[]): WeeklySweepArgs {
  const args = { dryRun: false, confirmed: false };
  const requested = new Set<WeeklySweepMode>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === WEEKLY_SWEEP_CONFIRM_FLAG) {
      args.confirmed = true;
    } else if (arg === '--mode') {
      requested.add(parseWeeklySweepMode(argv[++index]));
    } else if (arg.startsWith('--mode=')) {
      requested.add(parseWeeklySweepMode(arg.slice('--mode='.length)));
    } else {
      throw new Error(`Unknown weekly sweep argument: ${arg}`);
    }
  }
  const modes =
    requested.size > 0
      ? WEEKLY_SWEEP_MODES.filter((mode) => requested.has(mode))
      : [...WEEKLY_SWEEP_MODES];
  if (!args.dryRun && !args.confirmed) {
    throw new Error(
      `The weekly sweep writes Development: pass ${WEEKLY_SWEEP_CONFIRM_FLAG}, or --dry-run to run only its preflight`,
    );
  }
  return { ...args, modes };
}

export function weeklySweepEnvironmentProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];
  for (const name of WEEKLY_SWEEP_REQUIRED_SECRETS) {
    if (!String(env[name] ?? '').trim()) problems.push(`${name} is required and is not set`);
  }
  for (const name of WEEKLY_SWEEP_FORBIDDEN_VARIABLES) {
    if (String(env[name] ?? '').trim()) {
      problems.push(
        `${name} is set; the weekly sweep holds Development credentials only, so remove it from this service`,
      );
    }
  }
  const environment = resolveScraperEnvironment(env);
  if (environment !== 'development') {
    problems.push(`SCRAPER_ENV must resolve to development; resolved ${environment}`);
  }
  const database = resolveMongoDatabaseName(env.MONGODBURL);
  if (env.MONGODBURL && database !== DEVELOPMENT_DATABASE_NAME) {
    problems.push(
      `MONGODBURL must name database ${DEVELOPMENT_DATABASE_NAME}; resolved ${database ?? 'none'}`,
    );
  }
  return problems;
}

export function weeklySweepChildEnvironment(
  env: NodeJS.ProcessEnv,
  tmpDir: string,
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    SCRAPER_ENV: 'development',
    CONFIRM_PROD_SCRAPE: 'false',
    ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
    TMPDIR: tmpDir,
  };
  delete childEnv.MEILISEARCH_INDEX_PREFIX;
  return childEnv;
}

export function buildWeeklySweepArgs(mode: WeeklySweepMode): string[] {
  return [
    '--cwd',
    'server',
    'scrape:sweep',
    `--mode=${mode}`,
    WEEKLY_SWEEP_CONFIRMATIONS[mode],
    '--restart',
  ];
}

export function buildSnapshotCacheDropArgs(artifactPath: string): string[] {
  return [...buildPruneDeadObservationsChildArgs(artifactPath), '--drop-snapshot-cache'];
}

export function findSweepSummaryPath(tmpDir: string, mode: ScraperSweepMode): string | null {
  if (!fs.existsSync(tmpDir)) return null;
  const prefix = `ylabs-${mode}-sweep-`;
  const candidates = fs
    .readdirSync(tmpDir)
    .filter((entry) => entry.startsWith(prefix))
    .sort()
    .map((entry) => path.join(tmpDir, entry, 'summary.json'))
    .filter((candidate) => fs.existsSync(candidate));
  return candidates.at(-1) ?? null;
}

export interface WeeklySweepModeOutcome {
  mode: WeeklySweepMode;
  exitCode: number | null;
  summaryFound: boolean;
  summary?: unknown;
}

export function weeklySweepExitCode(outcomes: WeeklySweepModeOutcome[]): number {
  return outcomes.every((outcome) => outcome.exitCode === 0 && outcome.summaryFound) ? 0 : 1;
}

export function formatWeeklySweepSummaryLine(mode: WeeklySweepMode, summary: unknown): string {
  return `${WEEKLY_SWEEP_SUMMARY_MARKER} ${JSON.stringify({ mode, summary })}`;
}

export function buildCorpusSnapshotArgs(): string[] {
  return ['--cwd', 'server', 'corpus:snapshot', '--environment', 'development'];
}

export const RENDER_CRON_RUN_LIMIT_MS = 12 * 60 * 60 * 1000;

export const WEEKLY_SWEEP_ERROR_TEXT_LIMIT = 500;

export function capWeeklySweepErrorText(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  return text.length > WEEKLY_SWEEP_ERROR_TEXT_LIMIT
    ? `${text.slice(0, WEEKLY_SWEEP_ERROR_TEXT_LIMIT - 3)}...`
    : text;
}

export function capWeeklySweepFailureTail(text: string | undefined | null): string | undefined {
  if (!text) return undefined;
  return text.length > FAILURE_TAIL_MAX_CHARS
    ? `...${text.slice(-(FAILURE_TAIL_MAX_CHARS - 3))}`
    : text;
}

export const WEEKLY_SWEEP_STAGE_LIST_LIMIT = 50;

export interface WeeklySweepStorageReading {
  ok: boolean;
  usedMb: number;
  quotaMb: number;
  headroomMb: number;
  minHeadroomMb: number;
}

export function weeklySweepStorageReading(
  verdict: WeeklySweepStorageReading,
): WeeklySweepStorageReading {
  return {
    ok: verdict.ok,
    usedMb: Math.round(verdict.usedMb),
    quotaMb: Math.round(verdict.quotaMb),
    headroomMb: Math.round(verdict.headroomMb),
    minHeadroomMb: Math.round(verdict.minHeadroomMb),
  };
}

export interface WeeklySweepPreflightRecord {
  ok: boolean;
  heldLockSources: string[];
  storageBefore?: WeeklySweepStorageReading;
  storageAfter?: WeeklySweepStorageReading;
  snapshotCacheDropped: boolean;
  refusal?: string;
  codeFreshness?: SweepCodeFreshness;
}

export interface WeeklySweepCorpusSnapshotRecord {
  status: WeeklySweepCorpusSnapshotStatus;
  exitCode?: number | null;
}

export interface WeeklySweepModeRecord {
  mode: WeeklySweepMode;
  exitCode: number | null;
  summaryFound: boolean;
  codeSha?: string | null;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  sourceCount: number;
  succeeded: number;
  failed: number;
  notRun: number;
  producedNothing: number;
  postRunStatus?: 'succeeded' | 'failed';
  postRunDurationMs?: number;
  throttleRecovered: number;
  throttleExhausted: number;
}

export interface WeeklySweepSourceRecord {
  mode: WeeklySweepMode;
  sourceName: string;
  phase: string;
  status: string;
  exitCode?: number;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  observationCount?: number;
  entitiesObserved?: number;
  fetchAttempts?: number;
  fetchFailed?: number;
  fetchBlocked?: number;
  throttleRecovered?: number;
  throttleExhausted?: number;
  materializationErrors?: number;
  error?: string;
  failureTail?: string;
}

export interface WeeklySweepStageRecord {
  mode: WeeklySweepMode;
  name: string;
  status: string;
  exitCode?: number;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
  error?: string;
  failureKind?: WeeklySweepStageFailureKind;
  failureTail?: string;
  counts?: Record<string, number>;
  regressions?: StageCountRegression[];
  unscored?: StageUnscoredBenchmark[];
}

export interface WeeklySweepPhaseRecord {
  mode: WeeklySweepMode;
  phase: string;
  startedAt?: Date;
  finishedAt?: Date;
  durationMs?: number;
}

export interface WeeklySweepCodeDriftRecord {
  mode: WeeklySweepMode;
  stage: string;
  startedSha: string;
  currentSha: string;
  message: string;
}

export interface WeeklySweepRunRecord {
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  renderLimit: { limitMs: number; withinLimit: boolean; headroomMs: number };
  environment: 'development';
  databaseName: string;
  codeSha: string | null;
  status: WeeklySweepRunStatus;
  exitCode: number;
  requestedModes: WeeklySweepMode[];
  preflight: WeeklySweepPreflightRecord;
  modes: WeeklySweepModeRecord[];
  sources: WeeklySweepSourceRecord[];
  stages: WeeklySweepStageRecord[];
  phases: WeeklySweepPhaseRecord[];
  codeDrift: WeeklySweepCodeDriftRecord[];
  refusals: string[];
  throttleRetry: SweepThrottleRetrySummary;
  corpusSnapshot: WeeklySweepCorpusSnapshotRecord;
  searchIndex?: SweepSearchIndexOutcome;
  error?: string;
}

type RecordLike = Record<string, unknown>;

const asRecord = (value: unknown): RecordLike =>
  value && typeof value === 'object' ? (value as RecordLike) : {};

const asArray = (value: unknown): RecordLike[] => (Array.isArray(value) ? value.map(asRecord) : []);

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const countOf = (value: unknown): number => optionalNumber(value) ?? 0;

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const optionalDate = (value: unknown): Date | undefined => {
  if (typeof value !== 'string' || !value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function timingOf(
  value: RecordLike,
): Pick<WeeklySweepStageRecord, 'startedAt' | 'finishedAt' | 'durationMs'> {
  return {
    startedAt: optionalDate(value.startedAt),
    finishedAt: optionalDate(value.finishedAt),
    durationMs: optionalNumber(value.durationMs),
  };
}

function summaryThrottleRetry(summary: RecordLike): SweepThrottleRetrySummary {
  const throttle = asRecord(summary.throttleRetry);
  return {
    recovered: countOf(throttle.recovered),
    exhausted: countOf(throttle.exhausted),
    exhaustedSources: Array.isArray(throttle.exhaustedSources)
      ? throttle.exhaustedSources.map(String)
      : [],
  };
}

function modeRecord(outcome: WeeklySweepModeOutcome): WeeklySweepModeRecord {
  const summary = asRecord(outcome.summary);
  const postRun = asRecord(summary.postRun);
  const throttle = summaryThrottleRetry(summary);
  const postRunStatus =
    postRun.status === 'succeeded' || postRun.status === 'failed' ? postRun.status : undefined;
  const startedAt = optionalDate(summary.startedAt);
  const finishedAt = optionalDate(summary.finishedAt);
  return withoutUndefined({
    mode: outcome.mode,
    exitCode: outcome.exitCode,
    summaryFound: outcome.summaryFound,
    codeSha: optionalString(summary.codeSha),
    startedAt,
    finishedAt,
    durationMs:
      startedAt && finishedAt ? Math.max(0, finishedAt.getTime() - startedAt.getTime()) : undefined,
    sourceCount: countOf(summary.sourceCount),
    succeeded: countOf(summary.succeeded),
    failed: countOf(summary.failed),
    notRun: countOf(summary.notRun),
    producedNothing: countOf(summary.producedNothing),
    postRunStatus,
    postRunDurationMs: optionalNumber(postRun.durationMs),
    throttleRecovered: throttle.recovered,
    throttleExhausted: throttle.exhausted,
  });
}

function sourceRecords(outcome: WeeklySweepModeOutcome): WeeklySweepSourceRecord[] {
  return asArray(asRecord(outcome.summary).rows).map((row) =>
    withoutUndefined({
      mode: outcome.mode,
      sourceName: String(row.sourceName ?? ''),
      phase: String(row.phase ?? ''),
      status: String(row.status ?? ''),
      exitCode: optionalNumber(row.exitCode),
      ...timingOf(row),
      observationCount: optionalNumber(row.observationCount),
      entitiesObserved: optionalNumber(row.entitiesObserved),
      fetchAttempts: optionalNumber(row.fetchAttempts),
      fetchFailed: optionalNumber(row.fetchFailed),
      fetchBlocked: optionalNumber(row.fetchBlocked),
      throttleRecovered: optionalNumber(row.throttleRecovered),
      throttleExhausted: optionalNumber(row.throttleExhausted),
      materializationErrors: optionalNumber(row.materializationErrors),
      error: capWeeklySweepErrorText(optionalString(row.error)),
      failureTail: capWeeklySweepFailureTail(optionalString(row.failureTail)),
    }),
  );
}

function stageFailureKind(value: unknown): WeeklySweepStageFailureKind | undefined {
  return weeklySweepStageFailureKinds.find((kind) => kind === value);
}

function stageCounts(value: unknown): Record<string, number> | undefined {
  const entries = Object.entries(asRecord(value))
    .filter(([, count]) => optionalNumber(count) !== undefined)
    .slice(0, WEEKLY_SWEEP_STAGE_LIST_LIMIT) as Array<[string, number]>;
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function stageRegressions(value: unknown): StageCountRegression[] | undefined {
  const regressions = asArray(value)
    .filter(
      (entry) =>
        optionalNumber(entry.previous) !== undefined && optionalNumber(entry.current) !== undefined,
    )
    .slice(0, WEEKLY_SWEEP_STAGE_LIST_LIMIT)
    .map((entry) => ({
      name: capWeeklySweepErrorText(String(entry.name ?? '')) ?? '',
      previous: entry.previous as number,
      current: entry.current as number,
    }));
  return regressions.length > 0 ? regressions : undefined;
}

function stageUnscored(value: unknown): StageUnscoredBenchmark[] | undefined {
  const unscored = asArray(value)
    .slice(0, WEEKLY_SWEEP_STAGE_LIST_LIMIT)
    .map((entry) => ({
      benchmarkId: String(entry.benchmarkId ?? ''),
      reason: capWeeklySweepErrorText(String(entry.reason ?? '')) ?? '',
    }));
  return unscored.length > 0 ? unscored : undefined;
}

function stageRecords(outcome: WeeklySweepModeOutcome): WeeklySweepStageRecord[] {
  return asArray(asRecord(asRecord(outcome.summary).postRun).stages).map((stage) =>
    withoutUndefined({
      mode: outcome.mode,
      name: String(stage.name ?? ''),
      status: String(stage.status ?? ''),
      exitCode: optionalNumber(stage.exitCode),
      ...timingOf(stage),
      error: capWeeklySweepErrorText(optionalString(stage.error)),
      failureKind: stageFailureKind(stage.failureKind),
      failureTail: capWeeklySweepFailureTail(optionalString(stage.failureTail)),
      counts: stageCounts(stage.counts),
      regressions: stageRegressions(stage.regressions),
      unscored: stageUnscored(stage.unscored),
    }),
  );
}

function phaseRecords(outcome: WeeklySweepModeOutcome): WeeklySweepPhaseRecord[] {
  return asArray(asRecord(outcome.summary).phases).map((phase) =>
    withoutUndefined({ mode: outcome.mode, phase: String(phase.phase ?? ''), ...timingOf(phase) }),
  );
}

function codeDriftRecords(outcome: WeeklySweepModeOutcome): WeeklySweepCodeDriftRecord[] {
  return asArray(asRecord(outcome.summary).codeDrift).map((drift) => ({
    mode: outcome.mode,
    stage: String(drift.stage ?? ''),
    startedSha: String(drift.startedSha ?? ''),
    currentSha: String(drift.currentSha ?? ''),
    message: capWeeklySweepErrorText(String(drift.message ?? '')) ?? '',
  }));
}

export function totalWeeklyThrottleRetry(
  outcomes: WeeklySweepModeOutcome[],
): SweepThrottleRetrySummary {
  const totals: SweepThrottleRetrySummary = { recovered: 0, exhausted: 0, exhaustedSources: [] };
  for (const outcome of outcomes) {
    const throttle = summaryThrottleRetry(asRecord(outcome.summary));
    totals.recovered += throttle.recovered;
    totals.exhausted += throttle.exhausted;
    for (const source of throttle.exhaustedSources) {
      if (!totals.exhaustedSources.includes(source)) totals.exhaustedSources.push(source);
    }
  }
  return totals;
}

export function weeklySweepRunStatus(
  preflightOk: boolean,
  exitCode: number,
  error?: string,
): WeeklySweepRunStatus {
  if (!preflightOk && !error) return 'refused';
  return exitCode === 0 && !error ? 'succeeded' : 'failed';
}

export interface WeeklySweepRunStartRecord {
  startedAt: Date;
  environment: 'development';
  databaseName: string;
  codeSha: string | null;
  requestedModes: WeeklySweepMode[];
  status: 'running';
}

export function buildWeeklySweepRunStartRecord(input: {
  startedAt: Date;
  databaseName: string;
  codeSha: string | null;
  requestedModes: WeeklySweepMode[];
}): WeeklySweepRunStartRecord {
  return { ...input, environment: 'development', status: 'running' };
}

export interface WeeklySweepRunRecordInput {
  startedAt: Date;
  finishedAt: Date;
  databaseName: string;
  codeSha: string | null;
  exitCode: number;
  requestedModes: WeeklySweepMode[];
  preflight: WeeklySweepPreflightRecord;
  outcomes: WeeklySweepModeOutcome[];
  corpusSnapshot: WeeklySweepCorpusSnapshotRecord;
  searchIndex?: SweepSearchIndexOutcome;
  error?: string;
}

export function buildWeeklySweepRunRecord(input: WeeklySweepRunRecordInput): WeeklySweepRunRecord {
  const durationMs = Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime());
  const codeDrift = input.outcomes.flatMap(codeDriftRecords);
  const error = capWeeklySweepErrorText(input.error);
  const preflight = withoutUndefined({
    ...input.preflight,
    refusal: capWeeklySweepErrorText(input.preflight.refusal),
  });
  return withoutUndefined({
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs,
    renderLimit: {
      limitMs: RENDER_CRON_RUN_LIMIT_MS,
      withinLimit: durationMs <= RENDER_CRON_RUN_LIMIT_MS,
      headroomMs: RENDER_CRON_RUN_LIMIT_MS - durationMs,
    },
    environment: 'development' as const,
    databaseName: input.databaseName,
    codeSha: input.codeSha,
    status: weeklySweepRunStatus(input.preflight.ok, input.exitCode, error),
    exitCode: input.exitCode,
    requestedModes: input.requestedModes,
    preflight,
    modes: input.outcomes.map(modeRecord),
    sources: input.outcomes.flatMap(sourceRecords),
    stages: input.outcomes.flatMap(stageRecords),
    phases: input.outcomes.flatMap(phaseRecords),
    codeDrift,
    refusals: [
      ...(preflight.refusal ? [preflight.refusal] : []),
      ...codeDrift.map((drift) => drift.message),
    ],
    throttleRetry: totalWeeklyThrottleRetry(input.outcomes),
    corpusSnapshot: input.corpusSnapshot,
    searchIndex: input.searchIndex,
    error,
  });
}

export function codeFreshnessRefusalPreflight(
  codeFreshness: SweepCodeFreshness,
): WeeklySweepPreflightRecord {
  return {
    ok: false,
    heldLockSources: [],
    snapshotCacheDropped: false,
    refusal: codeFreshness.refusal ?? 'the sweep code is not current beta',
    codeFreshness,
  };
}

export const WEEKLY_SWEEP_REFUSED_MARKER = 'WEEKLY_SWEEP_REFUSED';

export function formatWeeklySweepRefusalLine(codeFreshness: SweepCodeFreshness): string {
  return `${WEEKLY_SWEEP_REFUSED_MARKER} ${JSON.stringify(codeFreshness)}`;
}
