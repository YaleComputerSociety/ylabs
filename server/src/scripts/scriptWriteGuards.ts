import os from 'os';
import path from 'path';
import {
  resolveScraperEnvironment,
  summarizeMongoUrl,
  type ScraperEnvironment,
} from '../scrapers/scraperEnvironment';

export interface ScriptApplyGuardResult {
  environment: ScraperEnvironment;
  dbLabel: string;
}

export function assertScriptApplyAllowed(args: {
  apply: boolean;
  scriptName: string;
  mongoUrl?: string;
  env?: NodeJS.ProcessEnv;
}): ScriptApplyGuardResult {
  const env = args.env || process.env;
  const environment = resolveScraperEnvironment(env);
  const dbLabel = summarizeMongoUrl(args.mongoUrl);
  const targetLooksProduction = /\/(prod|production)$/i.test(dbLabel);

  if (args.apply && environment !== 'production' && targetLooksProduction) {
    throw new Error(
      `${args.scriptName} apply target looks like production (${dbLabel}) but SCRAPER_ENV=${environment}. Set SCRAPER_ENV=production and CONFIRM_PROD_SCRAPE=true before production writes.`,
    );
  }

  if (args.apply && environment === 'production' && env.CONFIRM_PROD_SCRAPE !== 'true') {
    throw new Error(
      `${args.scriptName} production writes require CONFIRM_PROD_SCRAPE=true in the environment. Mongo target: ${dbLabel}.`,
    );
  }

  return { environment, dbLabel };
}

const hasPathPrefix = (target: string, root: string): boolean =>
  target === root || target.startsWith(`${root}${path.sep}`);

export function resolveSafeJsonReportOutputPath(
  value: string | undefined,
  flag = '--output',
): string {
  const output = value?.trim();
  if (!output || output.startsWith('--')) {
    throw new Error(`${flag} requires a path`);
  }
  if (containsAsciiControl(output)) {
    throw new Error(`${flag} path contains invalid characters`);
  }

  const resolved = path.resolve(output);
  if (path.extname(resolved).toLowerCase() !== '.json') {
    throw new Error(`${flag} must point to a .json report file`);
  }

  const tmpRoot = path.resolve(os.tmpdir());
  const projectTmpRoot = path.resolve(process.cwd(), 'tmp');
  if (!hasPathPrefix(resolved, tmpRoot) && !hasPathPrefix(resolved, projectTmpRoot)) {
    throw new Error(`${flag} must write under ${tmpRoot} or ./tmp`);
  }

  return resolved;
}
import { containsAsciiControl } from '../utils/asciiControl';
