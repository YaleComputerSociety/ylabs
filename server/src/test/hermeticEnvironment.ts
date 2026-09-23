import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { vi } from 'vitest';
import { applyMongoMemoryLaunchBudget } from './mongoMemoryLaunchBudget';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const keysDeclaredIn = (fileName: string): string[] => {
  const filePath = path.join(SERVER_ROOT, fileName);
  if (!fs.existsSync(filePath)) return [];
  return Object.keys(dotenv.parse(fs.readFileSync(filePath)));
};

/**
 * Deliberately unroutable stand-ins for every backend a child process can be
 * pointed at. A spawned CLI re-runs `dotenv.config()` in its own process, where a
 * vitest module mock cannot reach it, and `dotenv` only fills names that are
 * absent, so handing the child an unreachable value fences it where deleting the
 * name would invite the file's real one back.
 */
const UNREACHABLE_BACKEND_VALUES: Record<string, string> = {
  MONGODBURL: 'mongodb://127.0.0.1:1/ylabs-hermetic-fence',
  DEVELOPMENT_MONGODBURL: 'mongodb://127.0.0.1:1/ylabs-hermetic-fence',
  BETA_MONGODBURL: 'mongodb://127.0.0.1:1/ylabs-hermetic-fence',
  PRODUCTION_MONGODBURL: 'mongodb://127.0.0.1:1/ylabs-hermetic-fence',
  FELLOWSHIP_REFRESH_BETA_DB: 'mongodb://127.0.0.1:1/ylabs-hermetic-fence',
  FELLOWSHIP_REFRESH_PROD_DB: 'mongodb://127.0.0.1:1/ylabs-hermetic-fence',
  MEILISEARCH_HOST: 'http://127.0.0.1:1',
  MEILISEARCH_API_KEY: 'ylabs-hermetic-fence',
  MEILISEARCH_INDEX_PREFIX: 'ylabs_hermetic_fence',
};

const LIVE_BACKEND_FLAG_KEYS = [
  'SCRAPER_ENV',
  'ALLOW_NON_PROD_SCRAPER_WRITES',
  'SCRAPER_FIELD_RETRACTION',
  'C4_RESOLVE_AT_MINT_ENTITIES',
];

const LIVE_BACKEND_KEYS = [...Object.keys(UNREACHABLE_BACKEND_VALUES), ...LIVE_BACKEND_FLAG_KEYS];

/**
 * Names the runner and the operating system own rather than the product. A local
 * `server/.env` that happens to declare one of them would otherwise have it
 * deleted here, and losing `NODE_ENV=test` makes `requiresDeployedRuntimeSecurity()`
 * true, so every suite mounting `app.ts` would run production security instead of
 * the CI behaviour the fence exists to reproduce.
 */
const RUNNER_OWNED_KEYS = ['NODE_ENV', 'CI', 'PATH', 'HOME', 'TMPDIR', 'TZ'];

/**
 * Every name a local `server/.env` can define, plus the connection strings a
 * shell can export with no file at all. The whole set is fenced rather than the
 * connection strings alone, because `LOCAL_AUTH_BYPASS` and the scraper write
 * flags decide test outcomes just as directly as a database URL does.
 */
export const fencedEnvironmentKeys = (): string[] =>
  Array.from(
    new Set([...LIVE_BACKEND_KEYS, ...keysDeclaredIn('.env'), ...keysDeclaredIn('.env.example')]),
  ).filter((key) => !RUNNER_OWNED_KEYS.includes(key));

export const applyEnvironmentFence = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  for (const key of fencedEnvironmentKeys()) delete env[key];
  env.YLABS_SKIP_LOCAL_DOTENV = 'true';
  return env;
};

const INERT_FENCED_VALUE = 'ylabs-hermetic-fence';

/**
 * The environment a suite must hand `spawn` when it drives a real CLI. Module
 * mocks stop at the process boundary, so the child is fenced by its environment
 * alone: every fenced name is present with a value that cannot reach a backend
 * and cannot read as `true`, which is what stops the child's own `dotenv.config()`
 * from filling the name from the developer's file.
 * `overrides` is where the suite puts its own `mongodb-memory-server` URI.
 *
 * "Cannot read as `true`" is not the same as "off" for a flag whose default is on.
 * `C4_RESOLVE_AT_MINT_ENTITIES` is enabled unless explicitly disabled (#3036), so
 * the inert value leaves a child at that default, which is the product behaviour a
 * hermetic run should reproduce. A suite that needs the fold off must say `false`.
 */
export const hermeticChildEnvironment = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  const child = applyEnvironmentFence({ ...process.env });
  for (const key of fencedEnvironmentKeys()) child[key] = INERT_FENCED_VALUE;
  return { ...child, ...UNREACHABLE_BACKEND_VALUES, ...overrides };
};

const searchFence = vi.hoisted(() => {
  const message =
    'A test reached the real Meilisearch client. Mock ../utils/meiliClient in the suite that needs an index (#2966).';
  // `then` must stay absent: a proxy that answers every property with a function
  // looks thenable, and `await getMeiliIndex(...)` would drive the stub instead
  // of resolving to it.
  const unreachableSurface = (): any =>
    new Proxy(
      {},
      {
        get: (_target, property) =>
          typeof property === 'string' && property !== 'then'
            ? async () => {
                throw new Error(message);
              }
            : undefined,
      },
    );
  return { message, unreachableSurface };
});

export const UNREACHABLE_SEARCH_INDEX_MESSAGE = searchFence.message;

/**
 * Around sixty modules call `dotenv.config()` at import time, so deleting keys
 * from `process.env` is not enough on its own: the first such module the test
 * graph pulls in reads the file straight back. Neutralising `config()` is what
 * makes a run see the environment CI sees, whether or not the developer keeps a
 * real `server/.env`.
 */
vi.mock('dotenv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dotenv')>();
  const withoutConfig = { ...actual, config: () => ({ parsed: {} }) };
  return { ...withoutConfig, default: withoutConfig };
});

// `dotenv/config` is a separate module that calls the real loader on import, so
// mocking the `dotenv` id alone leaves `import 'dotenv/config'` as a way back in.
vi.mock('dotenv/config', () => ({}));

/**
 * Clearing `MEILISEARCH_*` is not the whole fence, because the client falls back
 * to `http://localhost:7700` and a local Meilisearch started without a master
 * key answers an unauthenticated request. Refusing here reproduces the single
 * state CI runs in, where no index is reachable at all, so a suite that needs an
 * index declares its own mock rather than inheriting whatever happens to listen.
 */
vi.mock('../utils/meiliClient', () => ({
  getMeiliClient: async () => searchFence.unreachableSurface(),
  getMeiliIndex: async () => searchFence.unreachableSurface(),
  resolveIndexName: (name: string) => name,
}));

applyEnvironmentFence(process.env);

applyMongoMemoryLaunchBudget();
