import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import {
  RESEARCH_ENTITY_SEARCH_INDEX_NAME,
  RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY,
} from '../services/researchEntitySearchIndexService';
import { searchResearchGroupsViaMeili } from '../services/researchGroupService';
import { getMeiliIndex, resolveIndexName } from '../utils/meiliClient';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface ReviewCase {
  name: string;
  query: string;
}

const DEFAULT_REVIEW_CASES: ReviewCase[] = [
  { name: 'archival research', query: 'archival research' },
  { name: 'wet lab', query: 'wet lab' },
  { name: 'machine learning', query: 'machine learning' },
  { name: 'public health', query: 'public health' },
  { name: 'climate policy', query: 'climate policy' },
  { name: 'social science data', query: 'social science data' },
  { name: 'digital humanities', query: 'digital humanities' },
];

interface CliOptions {
  pageSize: number;
  topK: number;
  strict: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    pageSize: 10,
    topK: 5,
    strict: false,
  };

  for (const arg of argv) {
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg.startsWith('--page-size=')) {
      const parsed = Number(arg.slice('--page-size='.length));
      if (Number.isFinite(parsed) && parsed > 0) options.pageSize = Math.floor(parsed);
      continue;
    }
    if (arg.startsWith('--top-k=')) {
      const parsed = Number(arg.slice('--top-k='.length));
      if (Number.isFinite(parsed) && parsed > 0) options.topK = Math.floor(parsed);
    }
  }

  return options;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatHit(hit: Record<string, any>) {
  return {
    id: hit.id || hit._id,
    name: hit.displayName || hit.name,
    studentVisibilityTier: hit.studentVisibilityTier,
    descriptionQuality: hit.descriptionQuality,
    methodSignals: stringArray(hit.methodSignals),
    conceptSignals: stringArray(hit.conceptSignals),
    sourceUrls: stringArray(hit.sourceUrls),
    ...(hit.searchMatch ? { searchMatch: hit.searchMatch } : {}),
  };
}

async function verifyResearchEntitiesSearchAvailable(index: any) {
  const [stats] = await Promise.all([
    index.getStats(),
    index.search('', {
      limit: 1,
      attributesToRetrieve: [RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY],
    }),
  ]);

  return {
    indexName: RESEARCH_ENTITY_SEARCH_INDEX_NAME,
    resolvedIndexName: resolveIndexName(RESEARCH_ENTITY_SEARCH_INDEX_NAME),
    documentCount: stats?.numberOfDocuments ?? stats?.numberOfDocumentsTotal,
    isIndexing: typeof stats?.isIndexing === 'boolean' ? stats.isIndexing : undefined,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await initializeConnections();

  let index: any;
  let meiliIndex;
  try {
    index = await getMeiliIndex(RESEARCH_ENTITY_SEARCH_INDEX_NAME);
    meiliIndex = await verifyResearchEntitiesSearchAvailable(index);
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          meiliAvailable: false,
          indexName: RESEARCH_ENTITY_SEARCH_INDEX_NAME,
          resolvedIndexName: resolveIndexName(RESEARCH_ENTITY_SEARCH_INDEX_NAME),
          summary: {
            recommendation:
              'Start Meilisearch and rebuild the researchentities index before relevance review.',
            rebuild: 'yarn --cwd server meili:rebuild-research-entities',
          },
          error: errorMessage(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const cases = await Promise.all(
    DEFAULT_REVIEW_CASES.map(async (reviewCase) => {
      const result = await searchResearchGroupsViaMeili(
        reviewCase.query,
        {},
        1,
        options.pageSize,
        {},
      );
      const hits = result.researchEntities || [];
      const rawMeiliResult =
        hits.length === 0 && (result.estimatedTotalHits || 0) > 0
          ? await index.search(reviewCase.query, {
              limit: options.topK,
              offset: 0,
              attributesToRetrieve: [
                'id',
                'name',
                'displayName',
                'studentVisibilityTier',
                'descriptionQuality',
                'methodSignals',
                'conceptSignals',
                'sourceUrls',
              ],
            })
          : undefined;

      return {
        name: reviewCase.name,
        query: reviewCase.query,
        total: result.estimatedTotalHits,
        top: hits.slice(0, options.topK).map(formatHit),
        ...(rawMeiliResult
          ? {
              rawMeiliTopWhenPublicRowsMissing: (rawMeiliResult.hits || [])
                .slice(0, options.topK)
                .map(formatHit),
            }
          : {}),
        needsProductReview: hits.length === 0,
      };
    }),
  );

  const zeroResultCases = cases.filter((reviewCase) => reviewCase.needsProductReview);
  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        meiliAvailable: true,
        meiliIndex,
        pageSize: options.pageSize,
        topK: options.topK,
        summary: {
          cases: cases.length,
          zeroResultCases: zeroResultCases.length,
          recommendation:
            zeroResultCases.length === 0
              ? 'ResearchEntity Meili relevance review cases returned candidates.'
              : 'Review zero-result cases before promoting ResearchEntity search relevance.',
        },
        cases,
      },
      null,
      2,
    ),
  );

  if (options.strict && zeroResultCases.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('ResearchEntity relevance review failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
