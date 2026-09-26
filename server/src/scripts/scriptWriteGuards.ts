import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import {
  resolveScraperEnvironment,
  summarizeMongoUrl,
  type ScraperEnvironment,
} from '../scrapers/scraperEnvironment';
import { SHARED_TEMP_ROOT, approvedTempRootFor } from '../utils/tempArtifactRoots';

export interface ScriptApplyGuardResult {
  environment: ScraperEnvironment;
  dbLabel: string;
  dbFingerprint: string;
}

export function mongoTargetFingerprint(mongoUrl: string | undefined): string {
  if (!mongoUrl) return 'missing';
  let identity: string;
  try {
    const parsed = new URL(mongoUrl);
    const topologyKeys = ['directConnection', 'loadBalanced', 'replicaSet', 'srvServiceName'];
    const topology = topologyKeys
      .flatMap((key) =>
        parsed.searchParams.getAll(key).map((value) => [key.toLowerCase(), value.toLowerCase()]),
      )
      .sort(
        ([leftKey, leftValue], [rightKey, rightValue]) =>
          leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
      );
    identity = JSON.stringify({
      protocol: parsed.protocol.toLowerCase(),
      host: parsed.host.toLowerCase(),
      database: parsed.pathname.replace(/^\//, '').toLowerCase(),
      topology,
    });
  } catch {
    identity = mongoUrl.split('?')[0].replace(/\/\/.*@/, '//');
  }
  return createHash('sha256').update(identity).digest('hex');
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

  return { environment, dbLabel, dbFingerprint: mongoTargetFingerprint(args.mongoUrl) };
}

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
  if (!approvedTempRootFor(resolved, [tmpRoot, SHARED_TEMP_ROOT, projectTmpRoot])) {
    throw new Error(`${flag} must write under ${approvedTempRootLabel(tmpRoot)} or ./tmp`);
  }

  return resolved;
}

function approvedTempRootLabel(tmpRoot: string): string {
  return [...new Set([tmpRoot, SHARED_TEMP_ROOT])].join(' or ');
}
import { containsAsciiControl } from '../utils/asciiControl';
