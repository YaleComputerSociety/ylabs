import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { rebuildResearchEntitySearchIndex } from '../services/researchEntitySearchIndexService';
import { getMeiliClient } from '../utils/meiliClient';
import {
  assertScraperEnvironmentMatchesMongoTarget,
  resolveMongoDatabaseName,
  resolveScraperEnvironment,
  summarizeMongoUrl,
  type ScraperEnvironment,
} from '../scrapers/scraperEnvironment';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  assertRebuildResearchEntitySearchIndexAllowed,
  buildRebuildResearchEntitySearchIndexOutput,
  writeRebuildResearchEntitySearchIndexOutput,
  type RebuildResearchEntitySearchIndexCliOptions,
} from './rebuildResearchEntitySearchIndex';
import { resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

dotenv.config();

export interface ReindexMeiliCliOptions {
  confirm: boolean;
  pageSize: number;
  output?: string;
}

export interface ReindexMeiliPreflight {
  environment: ScraperEnvironment;
  meiliHost: string;
  indexPrefix: string;
  database: string;
}

export const MODEL_INDEX_BASE_NAMES = ['researchentities'] as const;
export const RETIRED_INDEX_BASE_NAMES = ['listings', 'papers'] as const;

export interface IndexReconcilePlan {
  prefix: string;
  keep: string[];
  retire: string[];
  unknown: string[];
}

export function planIndexReconcile(args: {
  allIndexUids: string[];
  prefix: string;
}): IndexReconcilePlan {
  const ownedPrefix = `${args.prefix}_`;
  const owned = args.allIndexUids.filter((uid) => uid.startsWith(ownedPrefix));
  const modelUids = new Set(MODEL_INDEX_BASE_NAMES.map((base) => `${ownedPrefix}${base}`));
  const retiredUids = new Set(RETIRED_INDEX_BASE_NAMES.map((base) => `${ownedPrefix}${base}`));

  return {
    prefix: args.prefix,
    keep: owned.filter((uid) => modelUids.has(uid)),
    retire: owned.filter((uid) => retiredUids.has(uid)),
    unknown: owned.filter((uid) => !modelUids.has(uid) && !retiredUids.has(uid)),
  };
}

async function listMeiliIndexUids(): Promise<string[]> {
  const client = await getMeiliClient();
  const response = await client.getIndexes({ limit: 1000 });
  const results = Array.isArray(response?.results) ? response.results : [];
  return results
    .map((index: any) => index?.uid)
    .filter((uid: unknown): uid is string => typeof uid === 'string');
}

async function deleteMeiliIndex(uid: string): Promise<void> {
  const client = await getMeiliClient();
  await client.deleteIndex(uid);
}

export function parseReindexMeiliArgs(argv: string[]): ReindexMeiliCliOptions {
  const options: ReindexMeiliCliOptions = { confirm: false, pageSize: 250 };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--confirm') {
      options.confirm = true;
      continue;
    }
    if (arg.startsWith('--page-size=')) {
      const raw = arg.slice('--page-size='.length);
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== raw.trim()) {
        throw new Error('--page-size requires a positive integer');
      }
      options.pageSize = parsed;
      continue;
    }
    if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
      continue;
    }
    throw new Error(`Unknown reindex:meili argument: ${arg}`);
  }

  return options;
}

export function assertReindexMeiliEnvironment(
  args: { env?: NodeJS.ProcessEnv; mongoUrl?: string } = {},
): ReindexMeiliPreflight {
  const env = args.env || process.env;
  const environment = resolveScraperEnvironment(env);
  if (environment !== 'beta' && environment !== 'production') {
    throw new Error(
      `reindex:meili targets beta or production only; SCRAPER_ENV resolved to "${environment}". Use the development sweep search-rebuild stage for the local index.`,
    );
  }

  const meiliHost = String(env.MEILISEARCH_HOST || '').trim();
  if (!meiliHost) {
    throw new Error('MEILISEARCH_HOST must be set to reindex a remote Meilisearch instance.');
  }

  const indexPrefix = String(env.MEILISEARCH_INDEX_PREFIX || '').trim();
  if (!indexPrefix) {
    throw new Error(
      'MEILISEARCH_INDEX_PREFIX must be non-empty for beta/production so the rebuild cannot clobber the unprefixed local index.',
    );
  }

  const mongoUrl = args.mongoUrl ?? env.MONGODBURL;
  assertScraperEnvironmentMatchesMongoTarget({ environment, mongoUrl, env });

  return {
    environment,
    meiliHost,
    indexPrefix,
    database: resolveMongoDatabaseName(mongoUrl) || summarizeMongoUrl(mongoUrl),
  };
}

async function main() {
  const options = parseReindexMeiliArgs(process.argv.slice(2));
  const preflight = assertReindexMeiliEnvironment();

  await initializeConnections();
  const database = mongoose.connection.db?.databaseName || preflight.database;
  const activeEntityCount = await ResearchEntity.countDocuments({ archived: { $ne: true } });

  console.log(
    JSON.stringify(
      {
        preflight: {
          environment: preflight.environment,
          meiliHost: preflight.meiliHost,
          indexPrefix: preflight.indexPrefix,
          database,
          activeEntityCount,
          willRebuild: options.confirm,
        },
      },
      null,
      2,
    ),
  );

  if (activeEntityCount === 0) {
    throw new Error(
      `Refusing to reindex: ${database} has 0 non-archived ResearchEntity documents. Verify the Mongo copy landed before clearing Meilisearch.`,
    );
  }

  const reconcile = planIndexReconcile({
    allIndexUids: await listMeiliIndexUids(),
    prefix: preflight.indexPrefix,
  });
  console.log(JSON.stringify({ reconcile }, null, 2));
  if (reconcile.unknown.length > 0) {
    console.warn(
      `Leaving ${reconcile.unknown.length} unrecognized prefixed index(es) in place for manual review: ${reconcile.unknown.join(', ')}`,
    );
  }

  if (!options.confirm) {
    console.log(
      'Dry run. Re-run with --confirm to clear and rebuild the model index and delete retired indexes.',
    );
    return;
  }

  const rebuildOptions: RebuildResearchEntitySearchIndexCliOptions = {
    pageSize: options.pageSize,
    clearExisting: true,
    confirmMeiliRebuild: true,
    output: options.output,
  };
  const guard = assertRebuildResearchEntitySearchIndexAllowed({ confirmMeiliRebuild: true });

  const result = await rebuildResearchEntitySearchIndex(rebuildOptions);

  for (const uid of reconcile.retire) {
    await deleteMeiliIndex(uid);
    console.log(`Deleted retired index ${uid}.`);
  }

  const output = buildRebuildResearchEntitySearchIndexOutput(result, {
    environment: guard.environment,
    db: database,
    options: rebuildOptions,
  });
  console.log(JSON.stringify({ ...output, retiredIndexes: reconcile.retire }, null, 2));
  writeRebuildResearchEntitySearchIndexOutput(
    { ...output, retiredIndexes: reconcile.retire },
    options.output,
  );
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to reindex Meilisearch for environment:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
