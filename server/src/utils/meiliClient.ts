import dotenv from 'dotenv';
import { requiresDeployedRuntimeSecurity } from './environment';
if (process.env.YLABS_SKIP_LOCAL_DOTENV !== 'true') {
  dotenv.config({ quiet: true });
}

const LOCAL_MEILISEARCH_HOST = 'http://localhost:7700';

export const MEILISEARCH_REQUEST_TIMEOUT_MS = 5_000;

export interface MeiliConnectionConfig {
  host: string;
  apiKey: string | undefined;
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

export const resolveMeiliConnectionConfig = (
  env: NodeJS.ProcessEnv = process.env,
): MeiliConnectionConfig => ({
  host: trimmedEnvValue(env, 'MEILISEARCH_HOST') || LOCAL_MEILISEARCH_HOST,
  apiKey: env.MEILISEARCH_API_KEY,
  indexPrefix: trimmedEnvValue(env, 'MEILISEARCH_INDEX_PREFIX'),
  requestTimeoutMs: MEILISEARCH_REQUEST_TIMEOUT_MS,
});

let meiliClientPromise: Promise<any> | null = null;

export const getMeiliClient = async () => {
  if (!meiliClientPromise) {
    meiliClientPromise = (async () => {
      const config = resolveMeiliConnectionConfig();
      const { Meilisearch } = await import('meilisearch');
      return new Meilisearch({
        host: config.host,
        apiKey: config.apiKey,
        timeout: config.requestTimeoutMs,
      });
    })();
  }

  return meiliClientPromise;
};

export const resolveIndexName = (name: string, env: NodeJS.ProcessEnv = process.env): string => {
  const { indexPrefix } = resolveMeiliConnectionConfig(env);
  return indexPrefix ? `${indexPrefix}_${name}` : name;
};

export const getMeiliIndex = async (name: string) => {
  const client = await getMeiliClient();
  return client.index(resolveIndexName(name));
};
