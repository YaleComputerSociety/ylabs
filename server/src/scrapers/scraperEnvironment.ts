/**
 * Environment guardrails for scraper CLI runs.
 *
 * MONGODBURL decides where data goes, but it should not be the only safety
 * boundary. These helpers make the intended scraper environment explicit.
 */
import type { ScraperOptions } from './types';

export type ScraperEnvironment = 'development' | 'beta' | 'production' | 'test';

export interface ScraperCommandGuardResult {
  environment: ScraperEnvironment;
  options: ScraperOptions;
  autoMaterialize: boolean;
  warnings: string[];
  dbLabel: string;
}

export function resolveScraperEnvironment(env: NodeJS.ProcessEnv = process.env): ScraperEnvironment {
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

export function applyScraperEnvironmentGuards(args: {
  command: 'run' | 'materialize' | 'report';
  options: ScraperOptions;
  autoMaterialize: boolean;
  mongoUrl?: string;
  env?: NodeJS.ProcessEnv;
}): ScraperCommandGuardResult {
  const env = args.env || process.env;
  const environment = resolveScraperEnvironment(env);
  const options: ScraperOptions = { ...args.options };
  let autoMaterialize = args.autoMaterialize;
  const warnings: string[] = [];
  const allowNonProdWrites = env.ALLOW_NON_PROD_SCRAPER_WRITES === 'true';

  if (environment !== 'production') {
    if (args.command === 'run' && !options.dryRun && !allowNonProdWrites) {
      options.dryRun = true;
      warnings.push(
        `SCRAPER_ENV=${environment}; forcing --dry-run. Set ALLOW_NON_PROD_SCRAPER_WRITES=true to write to this non-production DB.`,
      );
    }

    if (autoMaterialize && !allowNonProdWrites) {
      autoMaterialize = false;
      warnings.push(
        `SCRAPER_ENV=${environment}; disabling --auto-materialize for non-production safety.`,
      );
    }

    if (args.command === 'materialize' && !options.dryRun && !allowNonProdWrites) {
      options.dryRun = true;
      warnings.push(
        `SCRAPER_ENV=${environment}; materialize defaults to dry-run outside production.`,
      );
    }
  }

  if (environment === 'production') {
    const confirmed = env.CONFIRM_PROD_SCRAPE === 'true';
    const writes = args.command === 'run' ? !options.dryRun : args.command === 'materialize' && !options.dryRun;

    if (writes && !options.release) {
      throw new Error('Production scraper writes require --release.');
    }

    if (writes && !confirmed) {
      throw new Error(
        'Production scraper writes require CONFIRM_PROD_SCRAPE=true in the environment.',
      );
    }

    if (options.useCache) {
      options.useCache = false;
      warnings.push('SCRAPER_ENV=production; disabling --use-cache.');
    }
  }

  return {
    environment,
    options,
    autoMaterialize,
    warnings,
    dbLabel: summarizeMongoUrl(args.mongoUrl),
  };
}
