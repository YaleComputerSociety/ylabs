import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../../db/connections';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { resolveSafeJsonReportOutputPath } from '../scriptWriteGuards';
import { journeyCases, type BrowseRequest, type JourneyEvalContext } from './journeyEvalCases';
import { summarizeInvariants, type InvariantResult, type RateResult } from './journeyEvalMetrics';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const RESEARCH_ENTITY_COLLECTION = 'research_entities';

interface JourneyEvalArgs {
  window: number;
  facetValues: number;
  pages: number;
  cases?: string[];
  output?: string;
}

function parseArgs(argv: string[]): JourneyEvalArgs {
  const args: JourneyEvalArgs = { window: 100, facetValues: 3, pages: 3 };
  for (const token of argv) {
    if (token.startsWith('--window=')) args.window = Number(token.slice('--window='.length));
    else if (token.startsWith('--facet-values='))
      args.facetValues = Number(token.slice('--facet-values='.length));
    else if (token.startsWith('--pages=')) args.pages = Number(token.slice('--pages='.length));
    else if (token.startsWith('--case='))
      args.cases = token
        .slice('--case='.length)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    else if (token.startsWith('--output=')) args.output = token.slice('--output='.length);
  }
  return args;
}

async function buildContext(args: JourneyEvalArgs): Promise<JourneyEvalContext> {
  const { searchResearchGroupsViaMeili } = await import('../../services/researchGroupService');
  const database = mongoose.connection.db;
  if (!database) throw new Error('MongoDB connection is not initialized');
  const collection = database.collection(RESEARCH_ENTITY_COLLECTION);

  return {
    window: args.window,
    facetValuesChecked: args.facetValues,
    pagesChecked: args.pages,
    browse: (request: BrowseRequest) =>
      searchResearchGroupsViaMeili(
        request.query ?? '',
        (request.filters ?? {}) as never,
        request.page ?? 1,
        request.pageSize ?? args.window,
        (request.sort ?? {}) as never,
        {},
      ) as never,
    readStoredRows: async (rowKeys: string[]) => {
      const rows = await collection.find({ slug: { $in: rowKeys } }).toArray();
      return new Map(rows.map((row) => [String(row.slug), row as Record<string, unknown>]));
    },
    readCorpusFingerprint: async () => {
      const [rowCount, latest] = await Promise.all([
        collection.countDocuments({}),
        collection
          .find({}, { projection: { updatedAt: 1 } })
          .sort({ updatedAt: -1 })
          .limit(1)
          .toArray(),
      ]);
      const latestUpdatedAt = latest[0]?.updatedAt;
      return {
        rowCount,
        latestUpdatedAt: latestUpdatedAt ? new Date(latestUpdatedAt as string).toISOString() : null,
      };
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await initializeConnections();
  const context = await buildContext(args);

  const selected = args.cases
    ? journeyCases.filter((journeyCase) => args.cases?.includes(journeyCase.id))
    : journeyCases;
  if (selected.length === 0) throw new Error('No journey case matched the requested --case list');

  const invariants: InvariantResult[] = [];
  const rates: RateResult[] = [];
  const caseReports: Array<Record<string, unknown>> = [];

  for (const journeyCase of selected) {
    const startedAt = Date.now();
    const outcome = await journeyCase.run(context);
    invariants.push(...outcome.invariants);
    rates.push(...outcome.rates);
    caseReports.push({
      id: journeyCase.id,
      title: journeyCase.title,
      elapsedMs: Date.now() - startedAt,
      invariants: outcome.invariants,
      rates: outcome.rates,
      ...(outcome.notes ? { notes: outcome.notes } : {}),
    });
  }

  const summary = summarizeInvariants(invariants);
  const report = {
    measuredAt: new Date().toISOString(),
    database: mongoose.connection.name,
    window: args.window,
    summary,
    cases: caseReports,
  };

  console.log(JSON.stringify(report, null, 2));
  if (args.output) {
    const outputPath = resolveSafeJsonReportOutputPath(args.output);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.error(`Report written to ${outputPath}`);
  }

  if (summary.invariantsInconclusive > 0) {
    console.error(
      `Inconclusive, so neither green nor a defect: ${summary.inconclusiveInvariantIds.join(', ')}`,
    );
  }
  if (summary.invariantsFailed > 0) process.exitCode = 1;
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error('Failed to run the browse journey eval:', sanitizeLogValue(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
