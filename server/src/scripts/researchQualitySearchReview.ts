import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { searchPathwaysViaMeili } from '../services/pathwaySearchIndexService';
import { searchResearchGroupsViaMeili } from '../services/researchGroupService';
import {
  DEFAULT_RESEARCH_QUALITY_GOLDEN_QUERIES,
  buildResearchQualitySearchReviewRow,
  deriveResearchEntitySourceTitleFromUrls,
  summarizeResearchQualitySearchRows,
  type ResearchQualityDuplicateCandidate,
  type ResearchQualityGoldenQuery,
  type ResearchQualitySearchFacts,
} from './researchQualitySearchReviewCore';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface ResearchQualitySearchReviewCliOptions {
  topK: number;
  limit: number;
  strict: boolean;
  queryNames: string[];
  output?: string;
}

interface EntityRecord {
  _id: unknown;
  slug: string;
  name: string;
  entityType?: string;
  kind?: string;
  displayName?: string;
  description?: string;
  shortDescription?: string;
  fullDescription?: string;
  sourceUrls?: string[];
  websiteUrl?: string;
  researchAreas?: string[];
  departments?: string[];
}

interface MemberRecord {
  researchEntityId?: unknown;
  role?: string;
  name?: string;
}

interface SearchCollection {
  entityIds: Set<string>;
  matchedQueriesByEntityId: Map<string, Set<string>>;
  reasonsByEntityId: Map<string, Set<string>>;
  searchErrors: Array<{ query: string; surface: 'research' | 'pathways'; error: string }>;
}

export function parseResearchQualitySearchReviewArgs(
  argv: string[],
): ResearchQualitySearchReviewCliOptions {
  const options: ResearchQualitySearchReviewCliOptions = {
    topK: 5,
    limit: 50,
    strict: false,
    queryNames: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg.startsWith('--top-k=')) {
      options.topK = parsePositiveInteger(arg.slice('--top-k='.length), '--top-k');
      continue;
    }
    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }
    if (arg.startsWith('--query=')) {
      const value = arg.slice('--query='.length).trim();
      if (value) options.queryNames.push(value);
      continue;
    }
    if (arg === '--output') {
      options.output = parseRequiredOutputPath(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      options.output = parseRequiredOutputPath(arg.slice('--output='.length));
      continue;
    }

    throw new Error(`Unknown research quality search review argument: ${arg}`);
  }

  return options;
}

function parseRequiredOutputPath(value: string | undefined): string {
  const output = value?.trim();
  if (!output || output.startsWith('--')) {
    throw new Error('--output requires a path');
  }
  return output;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

export function writeResearchQualitySearchReviewOutput(result: unknown, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
}

export function buildResearchQualitySearchReviewOutput<T extends object>(
  result: T,
  metadata: {
    environment?: string;
    db?: string;
    options: ResearchQualitySearchReviewCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: ResearchQualitySearchReviewCliOptions;
} {
  return {
    ...result,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringId(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function normalizeName(value: string | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/\b(lab|laboratory|center|centre|program|project|group|the)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function addMapSet(map: Map<string, Set<string>>, key: string, value: string): void {
  if (!key || !value) return;
  const set = map.get(key) || new Set<string>();
  set.add(value);
  map.set(key, set);
}

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
}

function buildLexicalReasons(hit: Record<string, unknown>, query: string): string[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const fields: Array<[string, unknown]> = [
    ['name', hit.name],
    ['displayName', hit.displayName],
    ['description', hit.description],
    ['shortDescription', hit.shortDescription],
    ['fullDescription', hit.fullDescription],
    ['researchAreas', hit.researchAreas],
    ['departments', hit.departments],
  ];

  return fields
    .filter(([, value]) => {
      const text = Array.isArray(value) ? value.join(' ') : String(value || '');
      const lower = text.toLowerCase();
      return tokens.some((token) => lower.includes(token));
    })
    .map(([field]) => `${field} matched "${query}"`);
}

function selectedQueries(options: ResearchQualitySearchReviewCliOptions): ResearchQualityGoldenQuery[] {
  if (options.queryNames.length === 0) return DEFAULT_RESEARCH_QUALITY_GOLDEN_QUERIES;
  const requested = new Set(options.queryNames.map((name) => name.toLowerCase()));
  return DEFAULT_RESEARCH_QUALITY_GOLDEN_QUERIES.filter(
    (query) => requested.has(query.name.toLowerCase()) || requested.has(query.q.toLowerCase()),
  );
}

async function collectSearchCandidates(
  queries: ResearchQualityGoldenQuery[],
  options: ResearchQualitySearchReviewCliOptions,
): Promise<SearchCollection> {
  const collection: SearchCollection = {
    entityIds: new Set<string>(),
    matchedQueriesByEntityId: new Map(),
    reasonsByEntityId: new Map(),
    searchErrors: [],
  };

  for (const query of queries) {
    try {
      const research = await searchResearchGroupsViaMeili(query.q, {}, 1, options.topK);
      for (const hit of research.researchEntities as Array<Record<string, unknown>>) {
        const id = stringId(hit._id || hit.id);
        if (!id) continue;
        collection.entityIds.add(id);
        addMapSet(collection.matchedQueriesByEntityId, id, query.name);
        for (const reason of buildLexicalReasons(hit, query.q)) {
          addMapSet(collection.reasonsByEntityId, id, reason);
        }
      }
    } catch (error) {
      collection.searchErrors.push({
        query: query.name,
        surface: 'research',
        error: errorMessage(error),
      });
    }

    try {
      const pathways = await searchPathwaysViaMeili({
        q: query.q,
        filters: query.filters as any,
        page: 1,
        pageSize: options.topK,
      });
      for (const hit of pathways.hits) {
        const id = stringId(hit.researchEntity?._id);
        if (!id) continue;
        collection.entityIds.add(id);
        addMapSet(collection.matchedQueriesByEntityId, id, query.name);
        const label = hit.studentFacingLabel || hit.explanation || hit.bestNextStep;
        if (label) addMapSet(collection.reasonsByEntityId, id, `pathway matched "${query.q}"`);
      }
    } catch (error) {
      collection.searchErrors.push({
        query: query.name,
        surface: 'pathways',
        error: errorMessage(error),
      });
    }
  }

  return collection;
}

function countMap(rows: Array<{ _id: unknown; count: number }>): Map<string, number> {
  return new Map(rows.map((row) => [stringId(row._id), row.count]));
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).sort();
}

async function aggregateCountMap(
  model: mongoose.Model<any>,
  entityIds: mongoose.Types.ObjectId[],
  extraMatch: Record<string, unknown> = {},
): Promise<Map<string, number>> {
  const rows = await model.aggregate<{ _id: unknown; count: number }>([
    { $match: { researchEntityId: { $in: entityIds }, ...extraMatch } },
    { $group: { _id: '$researchEntityId', count: { $sum: 1 } } },
  ]);
  return countMap(rows);
}

async function aggregateCountAndTypes(
  model: mongoose.Model<any>,
  entityIds: mongoose.Types.ObjectId[],
  typeField: string,
  extraMatch: Record<string, unknown> = {},
): Promise<{ counts: Map<string, number>; types: Map<string, string[]> }> {
  const rows = await model.aggregate<{ _id: unknown; count: number; types: unknown[] }>([
    { $match: { researchEntityId: { $in: entityIds }, ...extraMatch } },
    {
      $group: {
        _id: '$researchEntityId',
        count: { $sum: 1 },
        types: { $addToSet: `$${typeField}` },
      },
    },
  ]);
  return {
    counts: countMap(rows),
    types: new Map(rows.map((row) => [stringId(row._id), uniqueStrings(row.types || [])])),
  };
}

function duplicateCandidatesFor(entities: EntityRecord[]): Map<string, ResearchQualityDuplicateCandidate[]> {
  const byNormalizedName = new Map<string, EntityRecord[]>();
  for (const entity of entities) {
    const key = normalizeName(entity.displayName || entity.name);
    if (!key) continue;
    const list = byNormalizedName.get(key) || [];
    list.push(entity);
    byNormalizedName.set(key, list);
  }

  const candidates = new Map<string, ResearchQualityDuplicateCandidate[]>();
  for (const group of byNormalizedName.values()) {
    if (group.length < 2) continue;
    for (const entity of group) {
      const id = stringId(entity._id);
      candidates.set(
        id,
        group
          .filter((candidate) => stringId(candidate._id) !== id)
          .map((candidate) => ({
            slug: candidate.slug,
            name: candidate.displayName || candidate.name,
          })),
      );
    }
  }
  return candidates;
}

async function buildReview(options: ResearchQualitySearchReviewCliOptions) {
  const queries = selectedQueries(options);
  const searchCollection = await collectSearchCandidates(queries, options);
  const validIds = Array.from(searchCollection.entityIds)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id))
    .slice(0, options.limit);

  const entities = (await ResearchEntity.find({ _id: { $in: validIds } })
    .select(
      '_id slug name entityType kind displayName description shortDescription fullDescription sourceUrls websiteUrl researchAreas departments',
    )
    .lean()) as unknown as EntityRecord[];

  const [members, pathwayStats, publicContactRouteStats, signalStats, opportunityCounts] =
    await Promise.all([
      ResearchGroupMember.find({ researchEntityId: { $in: validIds } })
        .select('researchEntityId role name')
        .lean(),
      aggregateCountAndTypes(EntryPathway, validIds, 'pathwayType', { archived: { $ne: true } }),
      aggregateCountAndTypes(ContactRoute, validIds, 'routeType', {
        archived: { $ne: true },
        visibility: 'PUBLIC',
      }),
      aggregateCountAndTypes(AccessSignal, validIds, 'signalType', { archived: { $ne: true } }),
      aggregateCountMap(PostedOpportunity, validIds, { archived: { $ne: true } }),
    ]);

  const membersByEntityId = new Map<string, MemberRecord[]>();
  for (const member of members as MemberRecord[]) {
    const id = stringId(member.researchEntityId);
    if (!id) continue;
    const list = membersByEntityId.get(id) || [];
    list.push(member);
    membersByEntityId.set(id, list);
  }

  const duplicateCandidates = duplicateCandidatesFor(entities);
  const rows = entities
    .map((entity) => {
      const id = stringId(entity._id);
      const facts: ResearchQualitySearchFacts = {
        id,
        slug: entity.slug,
        name: entity.name,
        entityType: entity.entityType,
        kind: entity.kind,
        displayName: entity.displayName,
        description: entity.description,
        shortDescription: entity.shortDescription,
        fullDescription: entity.fullDescription,
        sourceUrls: entity.sourceUrls || [],
        websiteUrl: entity.websiteUrl,
        sourceTitle: deriveResearchEntitySourceTitleFromUrls(
          entity.sourceUrls || [],
          entity.websiteUrl,
        ),
        members: membersByEntityId.get(id) || [],
        researchAreas: entity.researchAreas || [],
        departments: entity.departments || [],
        duplicateCandidates: duplicateCandidates.get(id) || [],
        pathwayCount: pathwayStats.counts.get(id) || 0,
        pathwayTypes: pathwayStats.types.get(id) || [],
        publicContactRouteCount: publicContactRouteStats.counts.get(id) || 0,
        publicContactRouteTypes: publicContactRouteStats.types.get(id) || [],
        accessSignalCount: signalStats.counts.get(id) || 0,
        accessSignalTypes: signalStats.types.get(id) || [],
        postedOpportunityCount: opportunityCounts.get(id) || 0,
        topSearchReasons: Array.from(searchCollection.reasonsByEntityId.get(id) || []),
        matchedQueryNames: Array.from(searchCollection.matchedQueriesByEntityId.get(id) || []),
      };
      return buildResearchQualitySearchReviewRow(facts);
    })
    .sort((a, b) => b.warningScore - a.warningScore || a.name.localeCompare(b.name));

  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    indexPosture: {
      researchEntities: 'Meilisearch read-only query',
      pathways: 'Meilisearch read-only query',
    },
    querySet: queries,
    totalCandidates: searchCollection.entityIds.size,
    reviewedEntities: rows.length,
    summary: summarizeResearchQualitySearchRows(rows),
    searchErrors: searchCollection.searchErrors,
    rows,
  };
}

async function main(): Promise<void> {
  const options = parseResearchQualitySearchReviewArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'research:quality-search-review',
    mongoUrl: process.env.MONGODBURL,
  });
  const queries = selectedQueries(options);
  if (queries.length === 0) {
    throw new Error('No matching golden queries selected.');
  }

  await initializeConnections();
  const review = await buildReview(options);
  const result = buildResearchQualitySearchReviewOutput(review, {
    environment: guard.environment,
    db: mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel,
    options,
  });
  console.log(JSON.stringify(result, null, 2));
  writeResearchQualitySearchReviewOutput(result, options.output);
  if (options.strict && (result.searchErrors.length > 0 || result.summary.maxWarningScore > 0)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
    .catch((error) => {
      console.error('Research quality/search review failed:', errorMessage(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
