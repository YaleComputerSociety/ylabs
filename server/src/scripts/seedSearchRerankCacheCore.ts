import fs from 'fs';
import path from 'path';
import { ResearchEntity } from '../models/researchEntity';
import {
  SEARCH_RERANK_MAX_SCORE,
  SEARCH_RERANK_MIN_SCORE,
  SearchRerankCache,
} from '../models/searchRerankCache';
import {
  searchRerankCacheFilters,
  searchRerankCacheQueryKey,
  type SearchRerankCacheFilters,
} from '../services/researchGroupService';
import type { ResearchGroupFilterInput } from '../services/researchGroupFilters';
import { serializedDocumentId } from '../utils/idSerialization';

export const SCRIPT_NAME = 'research-search:seed-rerank-cache';
export const SEED_CONFIRM_FLAG = '--confirm-search-rerank-cache-seed';
export const DEFAULT_SEED_SOURCE = 'offline-scoring';

export type SeedEnvironment = 'development' | 'beta' | 'production';

const MONGO_URL_ENV_VARS: Record<SeedEnvironment, string> = {
  development: 'MONGODBURL',
  beta: 'BETA_MONGODBURL',
  production: 'PRODUCTION_MONGODBURL',
};

export interface SeedSearchRerankCacheArgs {
  input?: string;
  environment: SeedEnvironment;
  indexVersion?: string;
  source: string;
  apply: boolean;
  confirm: boolean;
}

export interface SeedInputEntry {
  query: string;
  filters: ResearchGroupFilterInput;
  scores: Record<string, number>;
}

export interface PlannedRerankCacheEntry {
  queryKey: string;
  queryText: string;
  filters: SearchRerankCacheFilters;
  scores: Array<{ entityId: string; score: number }>;
}

export interface SeedSearchRerankCacheReport {
  mode: 'apply' | 'dry-run';
  entries: number;
  scores: number;
  resolvedScores: number;
  unresolvedSlugs: number;
  entriesWithNoResolvedScore: number;
  upserted: number;
}

const flagValue = (arg: string, flag: string): string | undefined =>
  arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : undefined;

function parseEnvironment(value: string | undefined): SeedEnvironment {
  if (value === 'development' || value === 'beta' || value === 'production') return value;
  throw new Error(`--environment must be development, beta or production; received ${value}`);
}

export function parseSeedSearchRerankCacheArgs(argv: string[]): SeedSearchRerankCacheArgs {
  const args: SeedSearchRerankCacheArgs = {
    environment: 'development',
    source: DEFAULT_SEED_SOURCE,
    apply: false,
    confirm: false,
  };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === SEED_CONFIRM_FLAG) args.confirm = true;
    else if (flagValue(arg, '--input') !== undefined) args.input = flagValue(arg, '--input');
    else if (flagValue(arg, '--environment') !== undefined) {
      args.environment = parseEnvironment(flagValue(arg, '--environment'));
    } else if (flagValue(arg, '--index-version') !== undefined) {
      args.indexVersion = flagValue(arg, '--index-version')!.trim() || undefined;
    } else if (flagValue(arg, '--source') !== undefined) {
      args.source = flagValue(arg, '--source')!.trim() || DEFAULT_SEED_SOURCE;
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  if (!args.input) throw new Error(`${SCRIPT_NAME} requires --input=<path to scores JSON>`);
  return args;
}

/**
 * An apply names its confirmation flag and a corpus marker, and writes Development unless
 * `--environment` names Beta or Production, each of which reads its own connection variable.
 */
export function assertSeedSearchRerankCacheApplyAllowed(
  args: Pick<SeedSearchRerankCacheArgs, 'apply' | 'confirm' | 'environment' | 'indexVersion'>,
  dbLabel: string,
): void {
  if (!args.apply) return;
  if (!args.confirm) throw new Error(`${SEED_CONFIRM_FLAG} is required when --apply is set.`);
  if (!args.indexVersion) {
    throw new Error(`${SCRIPT_NAME} apply requires --index-version=<corpus or index marker>`);
  }
  if (args.environment === 'development' && !/\/development$/i.test(dbLabel)) {
    throw new Error(
      `${SCRIPT_NAME} apply is restricted to a Development database unless --environment=beta or --environment=production is given (got ${dbLabel})`,
    );
  }
}

export function resolveSeedMongoUrl(
  environment: SeedEnvironment,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const variable = MONGO_URL_ENV_VARS[environment];
  const value = env[variable]?.trim();
  if (!value) throw new Error(`${variable} is required to reach the ${environment} environment.`);
  return value;
}

const isInside = (child: string, parent: string): boolean => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

/**
 * The scores pair real student queries with research rows, so the file must live outside
 * the repository, where nothing can commit it.
 */
export function resolveSeedInputPath(input: string, repositoryRoot: string): string {
  const resolved = fs.realpathSync(path.resolve(input));
  if (isInside(resolved, fs.realpathSync(repositoryRoot))) {
    throw new Error(`${SCRIPT_NAME} --input must be outside the repository`);
  }
  return resolved;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseSeedInput(raw: unknown): SeedInputEntry[] {
  if (!Array.isArray(raw)) throw new Error(`${SCRIPT_NAME} input must be a JSON array`);
  return raw.map((entry, index) => {
    if (!isPlainObject(entry)) throw new Error(`Entry ${index} is not an object`);
    const { query, filters, scores } = entry;
    if (typeof query !== 'string' || query.trim() === '') {
      throw new Error(`Entry ${index} needs a non-empty query`);
    }
    if (filters !== undefined && !isPlainObject(filters)) {
      throw new Error(`Entry ${index} filters must be an object`);
    }
    if (!isPlainObject(scores)) throw new Error(`Entry ${index} scores must be an object`);
    for (const score of Object.values(scores)) {
      if (
        typeof score !== 'number' ||
        !Number.isFinite(score) ||
        score < SEARCH_RERANK_MIN_SCORE ||
        score > SEARCH_RERANK_MAX_SCORE
      ) {
        throw new Error(
          `Entry ${index} has a score that is not a number from ${SEARCH_RERANK_MIN_SCORE} to ${SEARCH_RERANK_MAX_SCORE}`,
        );
      }
    }
    return {
      query,
      filters: (filters ?? {}) as ResearchGroupFilterInput,
      scores: scores as Record<string, number>,
    };
  });
}

export async function resolveLiveSlugIds(slugs: readonly string[]): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();
  const rows = (await ResearchEntity.find({ slug: { $in: [...slugs] }, archived: { $ne: true } })
    .select('_id slug')
    .lean()) as Array<{ _id: unknown; slug?: unknown }>;
  const bySlug = new Map<string, string>();
  for (const row of rows) {
    const entityId = serializedDocumentId(row._id);
    if (typeof row.slug === 'string' && entityId) bySlug.set(row.slug, entityId);
  }
  return bySlug;
}

export function planRerankCacheEntries(
  entries: readonly SeedInputEntry[],
  idBySlug: ReadonlyMap<string, string>,
): { planned: PlannedRerankCacheEntry[]; scores: number; unresolvedSlugs: number } {
  const entryIndexByKey = new Map<string, number>();
  let scores = 0;
  let unresolvedSlugs = 0;
  const planned = entries.map((entry, index) => {
    const queryKey = searchRerankCacheQueryKey(entry.query, entry.filters);
    const earlier = entryIndexByKey.get(queryKey);
    if (earlier !== undefined) {
      throw new Error(`Entries ${earlier} and ${index} have the same query key`);
    }
    entryIndexByKey.set(queryKey, index);
    const resolved = Object.entries(entry.scores).flatMap(([slug, score]) => {
      scores += 1;
      const entityId = idBySlug.get(slug);
      if (!entityId) {
        unresolvedSlugs += 1;
        return [];
      }
      return [{ entityId, score }];
    });
    return {
      queryKey,
      queryText: entry.query.trim(),
      filters: searchRerankCacheFilters(entry.filters),
      scores: resolved,
    };
  });
  return { planned, scores, unresolvedSlugs };
}

export async function seedSearchRerankCache(options: {
  entries: readonly SeedInputEntry[];
  apply: boolean;
  indexVersion?: string;
  source: string;
  now?: Date;
}): Promise<SeedSearchRerankCacheReport> {
  const slugs = [...new Set(options.entries.flatMap((entry) => Object.keys(entry.scores)))];
  const idBySlug = await resolveLiveSlugIds(slugs);
  const { planned, scores, unresolvedSlugs } = planRerankCacheEntries(options.entries, idBySlug);
  const report: SeedSearchRerankCacheReport = {
    mode: options.apply ? 'apply' : 'dry-run',
    entries: planned.length,
    scores,
    resolvedScores: scores - unresolvedSlugs,
    unresolvedSlugs,
    entriesWithNoResolvedScore: planned.filter((entry) => entry.scores.length === 0).length,
    upserted: 0,
  };
  if (!options.apply || planned.length === 0) return report;
  if (!options.indexVersion) throw new Error(`${SCRIPT_NAME} apply requires an index version`);
  const scoredAt = options.now ?? new Date();
  for (const entry of planned) {
    await SearchRerankCache.updateOne(
      { queryKey: entry.queryKey },
      {
        $set: {
          ...entry,
          scoredAt,
          indexVersion: options.indexVersion,
          source: options.source,
        },
      },
      { upsert: true },
    );
    report.upserted += 1;
  }
  return report;
}
