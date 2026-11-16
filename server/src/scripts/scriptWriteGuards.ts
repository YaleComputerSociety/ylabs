import { recordDevApplyIntent } from '../db/devWriteLease';
import { createHash } from 'crypto';
import {
  resolveScraperEnvironment,
  summarizeMongoUrl,
  type ScraperEnvironment,
} from '../scrapers/scraperEnvironment';

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
  // Resolved here rather than taken from the caller, because a caller that
  // omitted `mongoUrl` got the label 'missing', which no production pattern
  // matches, so the refusal below could not fire at all while the script went on
  // to connect through `MONGODBURL` anyway. Omission must not be a way past this
  // check, so the guard reads the same variable the connection does (#3725).
  const mongoUrl = args.mongoUrl ?? env.MONGODBURL;
  const dbLabel = summarizeMongoUrl(mongoUrl);
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

  if (args.apply) recordDevApplyIntent(args.scriptName);
  return { environment, dbLabel, dbFingerprint: mongoTargetFingerprint(mongoUrl) };
}

export {
  REPORT_ROOT_ENV,
  resolveReportRoot,
  resolveSafeJsonReportOutputPath,
} from '../utils/reportOutputPath';
