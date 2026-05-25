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

  if (args.apply && environment === 'production' && env.CONFIRM_PROD_SCRAPE !== 'true') {
    throw new Error(
      `${args.scriptName} production writes require CONFIRM_PROD_SCRAPE=true in the environment. Mongo target: ${dbLabel}.`,
    );
  }

  return { environment, dbLabel };
}
