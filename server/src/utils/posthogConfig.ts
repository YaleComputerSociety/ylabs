import { allowsNonProductionSecurityBypass } from './environment';
import {
  databaseNameFromMongoUrl,
  operatorEnvironmentForDatabaseName,
} from '../scripts/operatorDatabaseEnvironment';

export const POSTHOG_INGEST_ORIGIN = 'https://us.i.posthog.com';
export const POSTHOG_ASSETS_ORIGIN = 'https://us-assets.i.posthog.com';

const POSTHOG_PROJECT_KEY = /^phc_[A-Za-z0-9]{20,64}$/;
const PRODUCTION_SEARCH_INDEX_PREFIX = 'prod';

const trimmed = (value: string | undefined) =>
  String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '');

const servesProductionDatabase = (env: NodeJS.ProcessEnv) => {
  try {
    return (
      operatorEnvironmentForDatabaseName(databaseNameFromMongoUrl(trimmed(env.MONGODBURL))) ===
      'production'
    );
  } catch {
    return false;
  }
};

export const isProductionWebRuntime = (env: NodeJS.ProcessEnv = process.env): boolean =>
  !allowsNonProductionSecurityBypass(env) &&
  trimmed(env.SCRAPER_ENV).toLowerCase() !== 'beta' &&
  trimmed(env.MEILISEARCH_INDEX_PREFIX) === PRODUCTION_SEARCH_INDEX_PREFIX &&
  servesProductionDatabase(env);

export const isPostHogConfigured = (env: NodeJS.ProcessEnv = process.env): boolean =>
  POSTHOG_PROJECT_KEY.test(trimmed(env.VITE_POSTHOG_KEY)) &&
  trimmed(env.VITE_POSTHOG_HOST) === POSTHOG_INGEST_ORIGIN &&
  isProductionWebRuntime(env);

export const posthogConnectOrigins = (env: NodeJS.ProcessEnv = process.env): string[] =>
  isPostHogConfigured(env) ? [POSTHOG_INGEST_ORIGIN, POSTHOG_ASSETS_ORIGIN] : [];

export const isProductAnalyticsAllowedForSession = (
  user: { isAdmin?: boolean } | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean => Boolean(user) && user?.isAdmin !== true && isPostHogConfigured(env);
