import fs from 'fs';
import path from 'path';
import {
  resolveScraperEnvironment,
  resolveMongoDatabaseName,
} from '../scrapers/scraperEnvironment';
import { DEVELOPMENT_DATABASE_NAME } from './databaseCopyPairs';
import { buildPruneDeadObservationsChildArgs, type ScraperSweepMode } from './runScraperSweep';

export const WEEKLY_SWEEP_MODES = ['development-full', 'fellowship-development-full'] as const;

export type WeeklySweepMode = (typeof WEEKLY_SWEEP_MODES)[number];

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
}

export const WEEKLY_SWEEP_CONFIRM_FLAG = '--confirm-weekly-development-sweep';

export function parseWeeklySweepArgs(argv: string[]): WeeklySweepArgs {
  const args: WeeklySweepArgs = { dryRun: false, confirmed: false };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === WEEKLY_SWEEP_CONFIRM_FLAG) {
      args.confirmed = true;
    } else {
      throw new Error(`Unknown weekly sweep argument: ${arg}`);
    }
  }
  if (!args.dryRun && !args.confirmed) {
    throw new Error(
      `The weekly sweep writes Development: pass ${WEEKLY_SWEEP_CONFIRM_FLAG}, or --dry-run to run only its preflight`,
    );
  }
  return args;
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
  summaryPath: string | null;
}

export function weeklySweepExitCode(outcomes: WeeklySweepModeOutcome[]): number {
  return outcomes.every((outcome) => outcome.exitCode === 0 && outcome.summaryPath) ? 0 : 1;
}

export function formatWeeklySweepSummaryLine(mode: WeeklySweepMode, summary: unknown): string {
  return `${WEEKLY_SWEEP_SUMMARY_MARKER} ${JSON.stringify({ mode, summary })}`;
}
