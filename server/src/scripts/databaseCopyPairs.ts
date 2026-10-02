export const DEVELOPMENT_DATABASE_NAME = 'Development';
export const BETA_DATABASE_NAME = 'Beta';
export const PRODUCTION_DATABASE_NAME = 'Prod';

export const DATABASE_COPY_PAIRS = {
  'development-to-beta': { source: DEVELOPMENT_DATABASE_NAME, target: BETA_DATABASE_NAME },
  'beta-to-development': { source: BETA_DATABASE_NAME, target: DEVELOPMENT_DATABASE_NAME },
  'beta-to-production': { source: BETA_DATABASE_NAME, target: PRODUCTION_DATABASE_NAME },
} as const;

export type DatabaseCopyPair = keyof typeof DATABASE_COPY_PAIRS;

export interface ParsedMongoTarget {
  database: string;
  host: string;
  local: boolean;
}

const LOCAL_MONGO_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function parseMongoTarget(value: string): ParsedMongoTarget {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('MongoDB URLs must be valid connection URLs');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('MongoDB URLs must include an explicit database name');
  }

  return {
    database,
    host: parsed.hostname,
    local: LOCAL_MONGO_HOSTS.has(parsed.hostname),
  };
}

export interface ResolvedDatabaseCopyPair {
  pair: DatabaseCopyPair;
  sourceDatabase: string;
  targetDatabase: string;
}

export function assertDatabaseCopyPair(
  pair: DatabaseCopyPair,
  sourceDatabase: string,
  targetDatabase: string,
): ResolvedDatabaseCopyPair {
  const expected = DATABASE_COPY_PAIRS[pair];
  if (sourceDatabase !== expected.source || targetDatabase !== expected.target) {
    const allowed = Object.values(DATABASE_COPY_PAIRS)
      .map(({ source, target }) => `${source} -> ${target}`)
      .join(', ');
    throw new Error(
      `Refusing to copy ${sourceDatabase || '(missing)'} -> ${targetDatabase || '(missing)'}: ${pair} copies only ${expected.source} -> ${expected.target} (allowed copies: ${allowed}).`,
    );
  }
  return { pair, sourceDatabase, targetDatabase };
}

export function assertDatabaseCopyPairUrls(
  pair: DatabaseCopyPair,
  sourceUrl: string,
  targetUrl: string,
): ResolvedDatabaseCopyPair {
  const source = parseMongoTarget(sourceUrl);
  const target = parseMongoTarget(targetUrl);
  if (source.local || target.local) {
    throw new Error(
      `Refusing to copy ${pair}: both MongoDB targets must be remote, not localhost.`,
    );
  }
  if (sourceUrl === targetUrl) {
    throw new Error(`Refusing to copy ${pair}: the source and target URLs are the same.`);
  }
  return assertDatabaseCopyPair(pair, source.database, target.database);
}
