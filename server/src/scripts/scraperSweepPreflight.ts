import fs from 'fs';
import path from 'path';
import type { Connection } from 'mongoose';
import { runWithBoundedConcurrency } from '../scrapers/utils/boundedConcurrency';
import {
  DEFAULT_SCRAPER_CANARY_LIMIT,
  isScraperCanaryReport,
  type ScraperCanaryReport,
} from '../scrapers/scraperCanary';
import { sanitizeLogValue } from '../utils/logSanitizer';

export const DEFAULT_CLUSTER_QUOTA_MB = 5120;
export const DEFAULT_MIN_STORAGE_HEADROOM_MB = 1024;
export const DEFAULT_CANARY_TIMEOUT_MS = 150_000;
export const DEFAULT_CANARY_CONCURRENCY = 8;

const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);
const BYTES_PER_MB = 1024 * 1024;

export interface SweepPreflightConfig {
  clusterQuotaMb: number;
  minHeadroomMb: number;
  canaryLimit: number;
  canaryTimeoutMs: number;
  canaryConcurrency: number;
}

function positiveNumber(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number; received ${raw}`);
  }
  return value;
}

export function resolveSweepPreflightConfig(
  env: NodeJS.ProcessEnv = process.env,
): SweepPreflightConfig {
  return {
    clusterQuotaMb: positiveNumber(
      env.SCRAPER_SWEEP_CLUSTER_QUOTA_MB,
      DEFAULT_CLUSTER_QUOTA_MB,
      'SCRAPER_SWEEP_CLUSTER_QUOTA_MB',
    ),
    minHeadroomMb: positiveNumber(
      env.SCRAPER_SWEEP_MIN_HEADROOM_MB,
      DEFAULT_MIN_STORAGE_HEADROOM_MB,
      'SCRAPER_SWEEP_MIN_HEADROOM_MB',
    ),
    canaryLimit: Math.floor(
      positiveNumber(
        env.SCRAPER_SWEEP_CANARY_LIMIT,
        DEFAULT_SCRAPER_CANARY_LIMIT,
        'SCRAPER_SWEEP_CANARY_LIMIT',
      ),
    ),
    canaryTimeoutMs: positiveNumber(
      env.SCRAPER_SWEEP_CANARY_TIMEOUT_MS,
      DEFAULT_CANARY_TIMEOUT_MS,
      'SCRAPER_SWEEP_CANARY_TIMEOUT_MS',
    ),
    canaryConcurrency: Math.floor(
      positiveNumber(
        env.SCRAPER_SWEEP_CANARY_CONCURRENCY,
        DEFAULT_CANARY_CONCURRENCY,
        'SCRAPER_SWEEP_CANARY_CONCURRENCY',
      ),
    ),
  };
}

export interface DatabaseStorage {
  name: string;
  dataSizeMb: number;
  indexSizeMb: number;
}

export interface ClusterStorage {
  databases: DatabaseStorage[];
  usedMb: number;
}

export async function measureClusterStorage(connection: Connection): Promise<ClusterStorage> {
  const db = connection.db;
  if (!db) throw new Error('the MongoDB connection is not open');
  const listed = await db.admin().listDatabases({ nameOnly: true });
  const names = listed.databases
    .map((database) => database.name)
    .filter((name) => !SYSTEM_DATABASES.has(name))
    .sort();
  const databases: DatabaseStorage[] = [];
  for (const name of names) {
    const stats = await connection.useDb(name, { useCache: false }).db!.command({ dbStats: 1 });
    databases.push({
      name,
      dataSizeMb: Number(stats.dataSize ?? 0) / BYTES_PER_MB,
      indexSizeMb: Number(stats.indexSize ?? 0) / BYTES_PER_MB,
    });
  }
  const usedMb = databases.reduce((sum, entry) => sum + entry.dataSizeMb + entry.indexSizeMb, 0);
  return { databases, usedMb };
}

export interface StorageHeadroomVerdict {
  ok: boolean;
  usedMb: number;
  quotaMb: number;
  headroomMb: number;
  minHeadroomMb: number;
  message: string;
}

export function evaluateStorageHeadroom(
  storage: Pick<ClusterStorage, 'usedMb'>,
  config: Pick<SweepPreflightConfig, 'clusterQuotaMb' | 'minHeadroomMb'>,
): StorageHeadroomVerdict {
  const headroomMb = config.clusterQuotaMb - storage.usedMb;
  const ok = headroomMb >= config.minHeadroomMb;
  const figures = `${Math.round(storage.usedMb)} MB of ${Math.round(config.clusterQuotaMb)} MB used (dataSize plus indexSize across every database on the cluster), ${Math.round(headroomMb)} MB free`;
  return {
    ok,
    usedMb: storage.usedMb,
    quotaMb: config.clusterQuotaMb,
    headroomMb,
    minHeadroomMb: config.minHeadroomMb,
    message: ok
      ? `${figures}; at least ${config.minHeadroomMb} MB required`
      : `${figures}, below the ${config.minHeadroomMb} MB a sweep needs; free space (observations:prune-dead, or drop scrape_snapshots) before sweeping (#3536)`,
  };
}

export interface CanaryChildResult {
  status: number | null;
  error?: Error;
  timedOut?: boolean;
}

export type CanaryChildRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; logPath: string; timeoutMs: number },
) => Promise<CanaryChildResult>;

export interface SweepCanaryOutcome {
  sourceName: string;
  verdict: ScraperCanaryReport['verdict'];
  reason: string;
  artifactPath: string;
  logPath: string;
  observationCount?: number;
  durationMs?: number;
}

export function buildScrapeCanaryChildArgs(
  sourceName: string,
  limit: number,
  artifactPath: string,
  options: { forceLlm?: boolean } = {},
): string[] {
  return [
    '--cwd',
    'server',
    'scrape:canary',
    '--source',
    sourceName,
    '--limit',
    String(limit),
    '--output',
    artifactPath,
    ...(options.forceLlm ? ['--force-llm'] : []),
  ];
}

function readCanaryReport(artifactPath: string): ScraperCanaryReport | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    return isScraperCanaryReport(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function classifyCanaryChild(
  sourceName: string,
  child: CanaryChildResult,
  report: ScraperCanaryReport | undefined,
  paths: { artifactPath: string; logPath: string },
  timeoutMs: number,
): SweepCanaryOutcome {
  const base = { sourceName, ...paths };
  if (child.timedOut) {
    return {
      ...base,
      verdict: 'inconclusive',
      reason: `did not finish within ${Math.round(timeoutMs / 1000)} s; a lane that ignores --limit cannot be canaried in bounded time`,
    };
  }
  if (report && report.sourceName === sourceName) {
    return {
      ...base,
      verdict: report.verdict,
      reason: report.reason,
      observationCount: report.observationCount,
      durationMs: report.durationMs,
    };
  }
  const cause = child.error
    ? sanitizeLogValue(child.error)
    : `the canary exited with status ${child.status} and wrote no readable report`;
  return { ...base, verdict: 'failed', reason: `${cause}; read ${paths.logPath}` };
}

export async function runSweepCanaries(input: {
  sourceNames: string[];
  outputDirectory: string;
  repoRoot: string;
  config: Pick<SweepPreflightConfig, 'canaryLimit' | 'canaryTimeoutMs' | 'canaryConcurrency'>;
  childRunner: CanaryChildRunner;
  forceLlm?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<SweepCanaryOutcome[]> {
  const directory = path.join(input.outputDirectory, 'preflight');
  fs.mkdirSync(directory, { recursive: true });
  const outcomes = new Array<SweepCanaryOutcome>(input.sourceNames.length);
  const entries = input.sourceNames.map((sourceName, index) => ({ sourceName, index }));
  await runWithBoundedConcurrency(
    entries,
    input.config.canaryConcurrency,
    async ({ sourceName, index }) => {
      const artifactPath = path.join(directory, `canary-${sourceName}.json`);
      const logPath = `${artifactPath}.log`;
      fs.rmSync(artifactPath, { force: true });
      const child = await input.childRunner(
        'yarn',
        buildScrapeCanaryChildArgs(sourceName, input.config.canaryLimit, artifactPath, {
          forceLlm: input.forceLlm,
        }),
        {
          cwd: input.repoRoot,
          env: input.env ?? process.env,
          logPath,
          timeoutMs: input.config.canaryTimeoutMs,
        },
      );
      outcomes[index] = classifyCanaryChild(
        sourceName,
        child,
        child.timedOut ? undefined : readCanaryReport(artifactPath),
        { artifactPath, logPath },
        input.config.canaryTimeoutMs,
      );
    },
  );
  return outcomes;
}

export interface SweepPreflightReport {
  status: 'passed' | 'failed';
  startedAt: string;
  finishedAt: string;
  storage?: StorageHeadroomVerdict & { databases: DatabaseStorage[] };
  storageError?: string;
  canaries: SweepCanaryOutcome[];
  failures: string[];
}

export function summarizeSweepPreflight(input: {
  startedAt: Date;
  finishedAt: Date;
  storage?: ClusterStorage;
  storageVerdict?: StorageHeadroomVerdict;
  storageError?: string;
  canaries: SweepCanaryOutcome[];
}): SweepPreflightReport {
  const failures: string[] = [];
  if (input.storageError) {
    failures.push(`storage headroom could not be measured: ${input.storageError}`);
  } else if (input.storageVerdict && !input.storageVerdict.ok) {
    failures.push(`storage headroom: ${input.storageVerdict.message}`);
  }
  for (const canary of input.canaries) {
    if (canary.verdict === 'failed') failures.push(`canary ${canary.sourceName}: ${canary.reason}`);
  }
  return {
    status: failures.length === 0 ? 'passed' : 'failed',
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    ...(input.storageVerdict && input.storage
      ? { storage: { ...input.storageVerdict, databases: input.storage.databases } }
      : {}),
    ...(input.storageError ? { storageError: input.storageError } : {}),
    canaries: input.canaries,
    failures,
  };
}

export function formatSweepPreflightReport(report: SweepPreflightReport): string {
  const lines = [`Sweep preflight ${report.status}`];
  if (report.storage)
    lines.push(`  storage: ${report.storage.ok ? 'ok' : 'FAILED'} - ${report.storage.message}`);
  if (report.storageError) lines.push(`  storage: FAILED - ${report.storageError}`);
  for (const canary of report.canaries) {
    lines.push(`  canary ${canary.sourceName}: ${canary.verdict} - ${canary.reason}`);
  }
  if (report.failures.length > 0) {
    lines.push(
      `${report.failures.length} preflight failure(s); fix them, or pass --skip-preflight to sweep anyway.`,
    );
  }
  return lines.join('\n');
}

export async function runSweepPreflight(input: {
  mongoUrl: string;
  sourceNames: string[];
  outputDirectory: string;
  repoRoot: string;
  childRunner: CanaryChildRunner;
  forceLlm?: boolean;
  config?: SweepPreflightConfig;
  now?: () => Date;
  connect?: (mongoUrl: string) => Promise<Connection>;
}): Promise<SweepPreflightReport> {
  const now = input.now ?? (() => new Date());
  const config = input.config ?? resolveSweepPreflightConfig();
  const startedAt = now();
  const connect =
    input.connect ??
    (async (mongoUrl: string) => {
      const { default: mongoose } = await import('mongoose');
      return mongoose.createConnection(mongoUrl).asPromise();
    });

  let storage: ClusterStorage | undefined;
  let storageVerdict: StorageHeadroomVerdict | undefined;
  let storageError: string | undefined;
  try {
    const connection = await connect(input.mongoUrl);
    try {
      storage = await measureClusterStorage(connection);
      storageVerdict = evaluateStorageHeadroom(storage, config);
    } finally {
      await connection.close();
    }
  } catch (error) {
    storageError = sanitizeLogValue(error instanceof Error ? error.message : error);
  }

  const canaries = await runSweepCanaries({
    sourceNames: input.sourceNames,
    outputDirectory: input.outputDirectory,
    repoRoot: input.repoRoot,
    config,
    childRunner: input.childRunner,
    forceLlm: input.forceLlm,
  });

  const report = summarizeSweepPreflight({
    startedAt,
    finishedAt: now(),
    storage,
    storageVerdict,
    storageError,
    canaries,
  });
  fs.writeFileSync(
    path.join(input.outputDirectory, 'preflight.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}
