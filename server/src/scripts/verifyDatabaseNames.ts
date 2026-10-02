import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertDatabaseCopyPairUrls,
  BETA_DATABASE_NAME,
  DATABASE_COPY_PAIRS,
  DEVELOPMENT_DATABASE_NAME,
  parseMongoTarget,
  PRODUCTION_DATABASE_NAME,
  type DatabaseCopyPair,
} from './databaseCopyPairs';

dotenv.config({ quiet: true });

const COPY_PAIR_URL_VARIABLES: Record<DatabaseCopyPair, { source: string; target: string }> = {
  'development-to-beta': { source: 'DEVELOPMENT_MONGODBURL', target: 'BETA_MONGODBURL' },
  'beta-to-development': { source: 'BETA_MONGODBURL', target: 'DEVELOPMENT_MONGODBURL' },
  'beta-to-production': { source: 'BETA_MONGODBURL', target: 'PRODUCTION_MONGODBURL' },
};

const SERVING_DATABASE_NAMES = {
  development: DEVELOPMENT_DATABASE_NAME,
  beta: BETA_DATABASE_NAME,
  production: PRODUCTION_DATABASE_NAME,
} as const;

type ServingEnvironment = keyof typeof SERVING_DATABASE_NAMES;

export type VerifyDatabaseNamesRequest =
  | { kind: 'pair'; pair: DatabaseCopyPair }
  | { kind: 'serving'; environment: ServingEnvironment };

export function parseVerifyDatabaseNamesArgs(argv: string[]): VerifyDatabaseNamesRequest {
  const [flag, value, ...rest] = argv;
  if (rest.length === 0 && flag === '--pair' && value && value in DATABASE_COPY_PAIRS) {
    return { kind: 'pair', pair: value as DatabaseCopyPair };
  }
  if (rest.length === 0 && flag === '--serving' && value && value in SERVING_DATABASE_NAMES) {
    return { kind: 'serving', environment: value as ServingEnvironment };
  }
  throw new Error(
    `Usage: database:verify-names --pair <${Object.keys(DATABASE_COPY_PAIRS).join('|')}> or --serving <${Object.keys(SERVING_DATABASE_NAMES).join('|')}>`,
  );
}

const requiredUrl = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = String(env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export function verifyDatabaseNames(
  request: VerifyDatabaseNamesRequest,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (request.kind === 'pair') {
    const variables = COPY_PAIR_URL_VARIABLES[request.pair];
    const resolved = assertDatabaseCopyPairUrls(
      request.pair,
      requiredUrl(env, variables.source),
      requiredUrl(env, variables.target),
    );
    return { ...resolved };
  }

  const expected = SERVING_DATABASE_NAMES[request.environment];
  const target = parseMongoTarget(requiredUrl(env, 'MONGODBURL'));
  if (target.database !== expected) {
    throw new Error(
      `MONGODBURL names database ${target.database}, but ${request.environment} is served from ${expected}.`,
    );
  }
  return { environment: request.environment, database: target.database };
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  try {
    console.log(
      JSON.stringify(verifyDatabaseNames(parseVerifyDatabaseNamesArgs(process.argv.slice(2)))),
    );
  } catch (error) {
    console.error(sanitizeLogValue(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
