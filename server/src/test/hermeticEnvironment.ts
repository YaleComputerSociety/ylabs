import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { vi } from 'vitest';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const keysDeclaredIn = (fileName: string): string[] => {
  const filePath = path.join(SERVER_ROOT, fileName);
  if (!fs.existsSync(filePath)) return [];
  return Object.keys(dotenv.parse(fs.readFileSync(filePath)));
};

const LIVE_BACKEND_KEYS = [
  'MONGODBURL',
  'DEVELOPMENT_MONGODBURL',
  'BETA_MONGODBURL',
  'PRODUCTION_MONGODBURL',
  'MEILISEARCH_HOST',
  'MEILISEARCH_API_KEY',
  'MEILISEARCH_INDEX_PREFIX',
];

/**
 * Every name a local `server/.env` can define, plus the connection strings a
 * shell can export with no file at all. The whole set is fenced rather than the
 * connection strings alone, because `LOCAL_AUTH_BYPASS` and the scraper write
 * flags decide test outcomes just as directly as a database URL does.
 */
export const fencedEnvironmentKeys = (): string[] =>
  Array.from(
    new Set([...LIVE_BACKEND_KEYS, ...keysDeclaredIn('.env'), ...keysDeclaredIn('.env.example')]),
  );

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

for (const key of fencedEnvironmentKeys()) delete process.env[key];
process.env.YLABS_SKIP_LOCAL_DOTENV = 'true';
