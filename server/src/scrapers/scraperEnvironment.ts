/**
 * Environment guardrails for scraper CLI runs.
 *
 * MONGODBURL decides where data goes, but it should not be the only safety
 * boundary. These helpers make the intended scraper environment explicit.
 */
import type { ScraperOptions } from './types';
import { c4LosslessIngestDeclared } from './observationStore';
import { operatorEnvironmentForDatabaseName } from '../scripts/operatorDatabaseEnvironment';

export type ScraperEnvironment = 'development' | 'beta' | 'production' | 'test';

export interface ScraperCommandGuardResult {
  environment: ScraperEnvironment;
  options: ScraperOptions;
  autoMaterialize: boolean;
  warnings: string[];
  dbLabel: string;
  writes: boolean;
  banner: string;
}

export interface ObservationPruneGuardResult {
  environment: ScraperEnvironment;
  apply: boolean;
  warnings: string[];
  dbLabel: string;
}

export function resolveScraperEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ScraperEnvironment {
  const raw = String(env.SCRAPER_ENV || env.APP_ENV || env.NODE_ENV || 'development')
    .trim()
    .toLowerCase();

  if (raw === 'prod' || raw === 'production') return 'production';
  if (raw === 'beta' || raw === 'staging') return 'beta';
  if (raw === 'test' || raw === 'ci') return 'test';
  return 'development';
}

export function summarizeMongoUrl(mongoUrl: string | undefined): string {
  if (!mongoUrl) return 'missing';
  try {
    const parsed = new URL(mongoUrl);
    const db = parsed.pathname.replace(/^\//, '') || '(no db name)';
    return `${parsed.hostname}/${db}`;
  } catch {
    const withoutQuery = mongoUrl.split('?')[0];
    return withoutQuery.replace(/\/\/.*@/, '//***@');
  }
}

export function resolveMongoDatabaseName(mongoUrl: string | undefined): string | undefined {
  if (!mongoUrl) return undefined;
  try {
    const parsed = new URL(mongoUrl);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    return databaseName || undefined;
  } catch {
    return undefined;
  }
}

function declaredDatabaseNameOverride(
  environment: ScraperEnvironment,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (environment === 'development') return env.SCRAPER_DEVELOPMENT_DB_NAME || undefined;
  if (environment === 'beta') return env.SCRAPER_BETA_DB_NAME || undefined;
  if (environment === 'production') return env.SCRAPER_PRODUCTION_DB_NAME || undefined;
  return undefined;
}

function guardedEnvironments(environment: ScraperEnvironment): boolean {
  return environment === 'development' || environment === 'beta' || environment === 'production';
}

export function assertScraperEnvironmentMatchesMongoTarget(args: {
  environment: ScraperEnvironment;
  mongoUrl?: string;
  env?: NodeJS.ProcessEnv;
}): void {
  const env = args.env || process.env;
  const mongoUrl = args.mongoUrl ?? env.MONGODBURL;
  if (!mongoUrl) return;
  if (!guardedEnvironments(args.environment)) return;

  const declared = declaredDatabaseNameOverride(args.environment, env);
  const actual = resolveMongoDatabaseName(mongoUrl);

  if (!actual) {
    throw new Error(
      `SCRAPER_ENV=${args.environment} requires MONGODBURL to include an explicit database name.`,
    );
  }

  if (declared) {
    if (actual !== declared) {
      throw new Error(
        `SCRAPER_ENV=${args.environment} requires Mongo database "${declared}", but MONGODBURL resolves to "${actual}".`,
      );
    }
    return;
  }

  if (operatorEnvironmentForDatabaseName(actual) !== args.environment) {
    throw new Error(`SCRAPER_ENV=${args.environment} does not match Mongo database "${actual}".`);
  }
}

export function isPromotionOnlyEnvironment(environment: ScraperEnvironment): boolean {
  return environment === 'beta' || environment === 'production';
}

export function promotionOnlyScraperWriteRefusal(environment: ScraperEnvironment): string {
  return (
    `SCRAPER_ENV=${environment} refuses scraper writes: sweeps and scrapes write only to Development, ` +
    'and Beta and Production receive data only through promotion. ' +
    'Run the scrape against Development, then promote with yarn beta:refresh-from-development:plan and :apply, ' +
    'and yarn --cwd server production:promote-beta-copy (docs/data-refresh-runbook.md).'
  );
}

export const SCRAPER_WRITE_PERMISSION_ENV = 'ALLOW_NON_PROD_SCRAPER_WRITES';

export function scraperWritePermissionWithoutApplyRefusal(
  command: 'run' | 'materialize' | 'report',
  databaseLabel: string,
): string {
  return (
    `REFUSED: the ${SCRAPER_WRITE_PERMISSION_ENV} permission is granted, but the command line has no --apply. ` +
    `The environment permission alone no longer writes (#5842). ` +
    `Add --apply to write to ${databaseLabel}, or --dry-run to preview scrape ${command} without writing.`
  );
}

export function scraperApplyWithoutWritePermissionRefusal(
  command: 'run' | 'materialize' | 'report',
): string {
  return (
    `REFUSED: scrape ${command} --apply requires the ${SCRAPER_WRITE_PERMISSION_ENV} permission in the environment. ` +
    'Launch it through "node scripts/run-data-profile.mjs development --write -- ...", ' +
    'or drop --apply for a dry run.'
  );
}

function scraperRunBanner(input: {
  command: 'run' | 'materialize' | 'report';
  writes: boolean;
  databaseLabel: string;
  dryRunReason: string;
  useCache: boolean;
}): string {
  if (input.writes) {
    return `WILL WRITE to ${input.databaseLabel} (scrape ${input.command} --apply with the ${SCRAPER_WRITE_PERMISSION_ENV} permission)`;
  }
  const recordedRows = input.useCache
    ? 'the run bookkeeping row and --use-cache fetch snapshots are'
    : 'the run bookkeeping row is';
  const bookkeeping =
    input.command === 'run'
      ? `; observations and entities stay untouched, only ${recordedRows} recorded`
      : '';
  return `DRY RUN: nothing will be written (${input.dryRunReason})${bookkeeping}`;
}

export function applyScraperEnvironmentGuards(args: {
  command: 'run' | 'materialize' | 'report';
  options: ScraperOptions;
  autoMaterialize: boolean;
  apply: boolean;
  mongoUrl?: string;
  env?: NodeJS.ProcessEnv;
}): ScraperCommandGuardResult {
  const env = args.env || process.env;
  const environment = resolveScraperEnvironment(env);
  assertScraperEnvironmentMatchesMongoTarget({
    environment,
    mongoUrl: args.mongoUrl,
    env,
  });
  const options: ScraperOptions = { ...args.options };
  const warnings: string[] = [];
  const allowNonProdWrites = env[SCRAPER_WRITE_PERMISSION_ENV] === 'true';
  const explicitDryRun = options.dryRun === true;
  const resolvedMongoUrl = args.mongoUrl ?? env.MONGODBURL;
  const dbLabel = summarizeMongoUrl(resolvedMongoUrl);
  const databaseLabel = resolveMongoDatabaseName(resolvedMongoUrl) ?? dbLabel;

  if (isPromotionOnlyEnvironment(environment)) {
    const writeIntent =
      !explicitDryRun && (environment === 'production' || allowNonProdWrites || args.apply);
    if (writeIntent && (args.command === 'run' || args.command === 'materialize')) {
      throw new Error(promotionOnlyScraperWriteRefusal(environment));
    }
  } else if (!explicitDryRun) {
    if (args.apply && !allowNonProdWrites) {
      throw new Error(scraperApplyWithoutWritePermissionRefusal(args.command));
    }
    if (!args.apply && allowNonProdWrites) {
      throw new Error(scraperWritePermissionWithoutApplyRefusal(args.command, databaseLabel));
    }
  }

  const writes = args.apply && allowNonProdWrites && !explicitDryRun;
  options.dryRun = !writes;

  let autoMaterialize = args.autoMaterialize;
  if (autoMaterialize && !writes) {
    autoMaterialize = false;
    warnings.push('Dry run, so --auto-materialize is disabled.');
  }

  if (environment === 'production' && options.useCache) {
    options.useCache = false;
    warnings.push('SCRAPER_ENV=production; disabling --use-cache.');
  }

  return {
    environment,
    options,
    autoMaterialize,
    warnings,
    dbLabel,
    writes,
    banner: scraperRunBanner({
      command: args.command,
      writes,
      databaseLabel,
      dryRunReason: explicitDryRun ? '--dry-run' : 'no --apply',
      useCache: options.useCache === true,
    }),
  };
}

export function applyObservationPruneEnvironmentGuards(args: {
  apply: boolean;
  mongoUrl?: string;
  env?: NodeJS.ProcessEnv;
}): ObservationPruneGuardResult {
  const env = args.env || process.env;
  const environment = resolveScraperEnvironment(env);
  assertScraperEnvironmentMatchesMongoTarget({
    environment,
    mongoUrl: args.mongoUrl,
    env,
  });
  let apply = args.apply;
  const warnings: string[] = [];
  const allowNonProdWrites = env.ALLOW_NON_PROD_SCRAPER_WRITES === 'true';

  if (environment !== 'production' && apply && !allowNonProdWrites) {
    apply = false;
    warnings.push(
      `SCRAPER_ENV=${environment}; forcing prune-observations dry-run. Set ALLOW_NON_PROD_SCRAPER_WRITES=true to delete in this non-production DB.`,
    );
  }

  if (environment === 'production' && apply) {
    throw new Error('Production observation pruning is disabled.');
  }

  if (apply && !c4LosslessIngestDeclared(env)) {
    apply = false;
    warnings.push(
      'C4_LOSSLESS_INGEST is undeclared, so this process cannot establish whether the target environment materializes over superseded observations; forcing prune-observations dry-run. Declare it (C4_LOSSLESS_INGEST=false) in the environment this target materializes from, then re-run.',
    );
  }

  return {
    environment,
    apply,
    warnings,
    dbLabel: summarizeMongoUrl(args.mongoUrl ?? env.MONGODBURL),
  };
}
