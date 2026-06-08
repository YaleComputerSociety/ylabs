import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { searchPathways, type PathwaySearchInput } from '../services/pathwaySearchService';
import { searchPathwaysViaMeili } from '../services/pathwaySearchIndexService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface ReviewCase {
  name: string;
  input: PathwaySearchInput;
}

const DEFAULT_REVIEW_CASES: ReviewCase[] = [
  { name: 'paid RA', input: { q: 'paid RA', filters: { compensation: ['PAID'] } } },
  { name: 'summer', input: { q: 'summer' } },
  { name: 'fellowship', input: { q: 'fellowship' } },
  { name: 'beginner-friendly', input: { q: 'beginner friendly' } },
  { name: 'Psychology', input: { q: 'Psychology', filters: { departments: ['Psychology'] } } },
  { name: 'CS', input: { q: 'Computer Science', filters: { departments: ['Computer Science'] } } },
  { name: 'Economics', input: { q: 'Economics', filters: { departments: ['Economics'] } } },
  { name: 'wet lab', input: { q: 'wet lab' } },
  { name: 'data', input: { q: 'data' } },
  { name: 'archival', input: { q: 'archival' } },
  { name: 'thesis', input: { q: 'thesis' } },
  {
    name: 'posted roles',
    input: { q: 'posted roles', filters: { hasActivePostedOpportunity: true } },
  },
];

export interface PathwayRelevanceReviewCliOptions {
  pageSize: number;
  topK: number;
  strict: boolean;
  output?: string;
}

export function parsePathwayRelevanceReviewArgs(argv: string[]): PathwayRelevanceReviewCliOptions {
  const options: PathwayRelevanceReviewCliOptions = {
    pageSize: 10,
    topK: 5,
    strict: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg.startsWith('--page-size=')) {
      options.pageSize = parsePositiveInteger(arg.slice('--page-size='.length), '--page-size');
      continue;
    }
    if (arg.startsWith('--top-k=')) {
      options.topK = parsePositiveInteger(arg.slice('--top-k='.length), '--top-k');
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

    throw new Error(`Unknown pathway relevance review argument: ${arg}`);
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

export function writePathwayRelevanceReviewOutput(report: unknown, output?: string): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}

export function buildPathwayRelevanceReviewOutput<T extends object>(
  report: T,
  metadata: {
    environment?: string;
    db?: string;
    options: PathwayRelevanceReviewCliOptions;
  },
): T & {
  environment?: string;
  db?: string;
  options: PathwayRelevanceReviewCliOptions;
} {
  return {
    ...report,
    ...(metadata.environment ? { environment: metadata.environment } : {}),
    ...(metadata.db ? { db: metadata.db } : {}),
    options: metadata.options,
  };
}

function topIds(hits: Array<{ _id: string }>, topK: number): string[] {
  return hits.slice(0, topK).map((hit) => hit._id);
}

function overlap(a: string[], b: string[]): number {
  const bSet = new Set(b);
  return a.filter((id) => bSet.has(id)).length;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const options = parsePathwayRelevanceReviewArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: false,
    scriptName: 'pathway:relevance-review',
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();
  const targetDb = mongoose.connection.db?.databaseName || mongoose.connection.name || guard.dbLabel;

  try {
    await searchPathwaysViaMeili({ page: 1, pageSize: 1 });
  } catch (error) {
    const result = buildPathwayRelevanceReviewOutput(
      {
        generatedAt: new Date().toISOString(),
        runtimeBackend: process.env.PATHWAY_SEARCH_BACKEND || 'mongo',
        meiliAvailable: false,
        summary: {
          recommendation: 'Start Meilisearch and rebuild the pathways index before relevance review.',
          rollback: 'Set PATHWAY_SEARCH_BACKEND=mongo.',
        },
        error: errorMessage(error),
      },
      {
        environment: guard.environment,
        db: targetDb,
        options,
      },
    );
    console.log(JSON.stringify(result, null, 2));
    writePathwayRelevanceReviewOutput(result, options.output);
    process.exitCode = 1;
    return;
  }

  const cases = await Promise.all(
    DEFAULT_REVIEW_CASES.map(async (reviewCase) => {
      const input = {
        ...reviewCase.input,
        page: 1,
        pageSize: options.pageSize,
      };
      const [mongo, meili] = await Promise.all([
        searchPathways(input),
        searchPathwaysViaMeili(input),
      ]);
      const mongoTopIds = topIds(mongo.hits, options.topK);
      const meiliTopIds = topIds(meili.hits, options.topK);
      const topOverlap = overlap(mongoTopIds, meiliTopIds);

      return {
        name: reviewCase.name,
        query: reviewCase.input.q || '',
        filters: reviewCase.input.filters || {},
        mongo: {
          total: mongo.estimatedTotalHits,
          top: mongo.hits.slice(0, options.topK).map((hit) => ({
            id: hit._id,
            label: hit.studentFacingLabel,
            entity: hit.researchEntity.displayName || hit.researchEntity.name,
          })),
        },
        meili: {
          total: meili.estimatedTotalHits,
          top: meili.hits.slice(0, options.topK).map((hit) => ({
            id: hit._id,
            label: hit.studentFacingLabel,
            entity: hit.researchEntity.displayName || hit.researchEntity.name,
          })),
        },
        topOverlap,
        needsProductReview:
          mongo.estimatedTotalHits !== meili.estimatedTotalHits ||
          (mongoTopIds.length > 0 && topOverlap < Math.min(mongoTopIds.length, options.topK)),
      };
    }),
  );

  const divergentCases = cases.filter((reviewCase) => reviewCase.needsProductReview);
  const result = buildPathwayRelevanceReviewOutput(
    {
      generatedAt: new Date().toISOString(),
      runtimeBackend: process.env.PATHWAY_SEARCH_BACKEND || 'mongo',
      pageSize: options.pageSize,
      topK: options.topK,
      summary: {
        cases: cases.length,
        divergentCases: divergentCases.length,
        recommendation:
          divergentCases.length === 0
            ? 'Meili relevance is ready for operator acceptance.'
            : 'Keep PATHWAY_SEARCH_BACKEND=mongo until divergent cases are reviewed.',
        rollback: 'Set PATHWAY_SEARCH_BACKEND=mongo.',
      },
      cases,
    },
    {
      environment: guard.environment,
      db: targetDb,
      options,
    },
  );

  console.log(JSON.stringify(result, null, 2));
  writePathwayRelevanceReviewOutput(result, options.output);
  if (options.strict && divergentCases.length > 0) {
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Pathway relevance review failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
