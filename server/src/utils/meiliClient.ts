import dotenv from 'dotenv';
import { requiresDeployedRuntimeSecurity } from './environment';
if (process.env.YLABS_SKIP_LOCAL_DOTENV !== 'true') {
  dotenv.config({ quiet: true });
}

const LOCAL_MEILISEARCH_HOST = 'http://localhost:7700';

export const MEILISEARCH_REQUEST_TIMEOUT_MS = 5_000;

export type MeiliKeyRole = 'search' | 'write';

export const LEGACY_MEILISEARCH_API_KEY_VARIABLE = 'MEILISEARCH_API_KEY';

export const MEILISEARCH_ROLE_KEY_VARIABLES: Record<MeiliKeyRole, string> = {
  search: 'MEILISEARCH_SEARCH_API_KEY',
  write: 'MEILISEARCH_WRITE_API_KEY',
};

export type MeiliApiKeySource = 'scoped' | 'legacy' | 'none';

export interface MeiliConnectionConfig {
  host: string;
  apiKey: string | undefined;
  apiKeySource: MeiliApiKeySource;
  role: MeiliKeyRole;
  indexPrefix: string;
  requestTimeoutMs: number;
}

const trimmedEnvValue = (env: NodeJS.ProcessEnv, name: string): string =>
  String(env[name] ?? '').trim();

const DEPLOYED_RUNTIME_REQUIRED_SETTINGS = [
  'MEILISEARCH_HOST',
  'MEILISEARCH_INDEX_PREFIX',
] as const;

export const assertDeployedMeiliConnectionConfig = (env: NodeJS.ProcessEnv = process.env): void => {
  if (!requiresDeployedRuntimeSecurity(env)) return;
  for (const name of DEPLOYED_RUNTIME_REQUIRED_SETTINGS) {
    if (!trimmedEnvValue(env, name)) throw new Error(`${name} must be set in deployed runtimes.`);
  }
};

const resolveMeiliApiKey = (
  role: MeiliKeyRole,
  env: NodeJS.ProcessEnv,
): { apiKey: string | undefined; apiKeySource: MeiliApiKeySource } => {
  const scopedKey = trimmedEnvValue(env, MEILISEARCH_ROLE_KEY_VARIABLES[role]);
  if (scopedKey) return { apiKey: scopedKey, apiKeySource: 'scoped' };
  const legacyKey = trimmedEnvValue(env, LEGACY_MEILISEARCH_API_KEY_VARIABLE);
  if (legacyKey) return { apiKey: legacyKey, apiKeySource: 'legacy' };
  return { apiKey: undefined, apiKeySource: 'none' };
};

export const resolveMeiliConnectionConfig = (
  env: NodeJS.ProcessEnv = process.env,
  role: MeiliKeyRole = 'write',
): MeiliConnectionConfig => ({
  host: trimmedEnvValue(env, 'MEILISEARCH_HOST') || LOCAL_MEILISEARCH_HOST,
  ...resolveMeiliApiKey(role, env),
  role,
  indexPrefix: trimmedEnvValue(env, 'MEILISEARCH_INDEX_PREFIX'),
  requestTimeoutMs: MEILISEARCH_REQUEST_TIMEOUT_MS,
});

export const legacyMeiliKeyFallbackWarning = (role: MeiliKeyRole): string =>
  `${MEILISEARCH_ROLE_KEY_VARIABLES[role]} is not set, so Meilisearch ${role} requests use ` +
  `${LEGACY_MEILISEARCH_API_KEY_VARIABLE}. Set a scoped ${role} key; see docs/meilisearch-reindex-runbook.md.`;

const warnedLegacyFallbackRoles = new Set<MeiliKeyRole>();

const warnOnceOnLegacyKeyFallback = (config: MeiliConnectionConfig, env: NodeJS.ProcessEnv) => {
  if (config.apiKeySource !== 'legacy') return;
  if (!requiresDeployedRuntimeSecurity(env)) return;
  if (warnedLegacyFallbackRoles.has(config.role)) return;
  warnedLegacyFallbackRoles.add(config.role);
  console.warn(legacyMeiliKeyFallbackWarning(config.role));
};

const meiliClientPromises = new Map<MeiliKeyRole, Promise<any>>();

const getMeiliClientForRole = async (role: MeiliKeyRole) => {
  let clientPromise = meiliClientPromises.get(role);
  if (!clientPromise) {
    clientPromise = (async () => {
      const config = resolveMeiliConnectionConfig(process.env, role);
      warnOnceOnLegacyKeyFallback(config, process.env);
      const { Meilisearch } = await import('meilisearch');
      return new Meilisearch({
        host: config.host,
        apiKey: config.apiKey,
        timeout: config.requestTimeoutMs,
      });
    })();
    meiliClientPromises.set(role, clientPromise);
  }

  return clientPromise;
};

export const getMeiliClient = async () => getMeiliClientForRole('write');

export const getMeiliSearchClient = async () => getMeiliClientForRole('search');

export const resolveIndexName = (name: string, env: NodeJS.ProcessEnv = process.env): string => {
  const { indexPrefix } = resolveMeiliConnectionConfig(env);
  return indexPrefix ? `${indexPrefix}_${name}` : name;
};

export const getMeiliIndex = async (name: string) => {
  const client = await getMeiliClient();
  return client.index(resolveIndexName(name));
};

export const getMeiliSearchIndex = async (name: string) => {
  const client = await getMeiliSearchClient();
  return client.index(resolveIndexName(name));
};
