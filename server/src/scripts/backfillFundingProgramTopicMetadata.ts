/**
 * Backfills researchAreas[]/departments[] for existing FELLOWSHIP_PROGRAM and
 * RA_PROGRAM entities that have neither (issue #1700). These types are almost
 * never scraped with topical observations, so the generic canonicalization
 * pipeline never runs for them; this derives topical metadata from each
 * entity's own name/description via the curated sponsor-name mapping in
 * `fundingProgramTopicDerivation.ts` and writes it through the same
 * canonicalizers the materializer now applies at write time (issue #1700).
 *
 * Fail-closed: an entity whose name/description does not name a known
 * sponsor/department is left untouched and counted as unmapped, never forced
 * to a guessed value.
 *
 * Dry-run-first. Apply mode requires `--confirm-funding-program-topics`, is
 * blocked against production unless CONFIRM_PROD_SCRAPE=true, and only
 * rewrites entities whose plan actually changes. Each applied batch is
 * re-synced to the Meilisearch research index so the area/department facets
 * never drift from Mongo.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { resetOrgUnitCanonicalizerCache } from '../scrapers/orgUnitCanonicalization';
import { resetResearchAreaCanonicalizerCache } from '../scrapers/researchAreaCanonicalization';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planFundingProgramTopicBackfillRow,
  summarizeFundingProgramTopicBackfill,
  type FundingProgramTopicBackfillPlanRow,
  type FundingProgramTopicBackfillSummary,
} from './backfillFundingProgramTopicMetadataCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const FUNDING_PROGRAM_ENTITY_TYPES = ['FELLOWSHIP_PROGRAM', 'RA_PROGRAM'];

export interface FundingProgramTopicBackfillCliOptions {
  dryRun: boolean;
  confirmFundingProgramTopics: boolean;
  limit?: number;
  batchSize: number;
  output?: string;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

export function parseFundingProgramTopicBackfillArgs(
  argv: string[],
): FundingProgramTopicBackfillCliOptions {
  const options: FundingProgramTopicBackfillCliOptions = {
    dryRun: true,
    confirmFundingProgramTopics: false,
    batchSize: 200,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm-funding-program-topics') {
      options.confirmFundingProgramTopics = true;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1], '--limit');
      i += 1;
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parsePositiveInt(arg.slice('--batch-size='.length), '--batch-size');
    } else if (arg === '--batch-size') {
      options.batchSize = parsePositiveInt(argv[i + 1], '--batch-size');
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export interface FundingProgramTopicBackfillResult {
  mode: 'dry-run' | 'apply';
  summary: FundingProgramTopicBackfillSummary;
  sampleChanges: FundingProgramTopicBackfillPlanRow[];
  syncedToMeili: number;
}

interface EntityRow {
  _id: unknown;
  slug?: string;
  name?: string;
  fullDescription?: string;
  school?: unknown;
  departments?: unknown;
  researchAreas?: unknown;
}

export async function runFundingProgramTopicBackfill(options: {
  dryRun: boolean;
  limit?: number;
  batchSize: number;
}): Promise<FundingProgramTopicBackfillResult> {
  resetOrgUnitCanonicalizerCache();
  resetResearchAreaCanonicalizerCache();

  const filter: Record<string, unknown> = {
    archived: { $ne: true },
    entityType: { $in: FUNDING_PROGRAM_ENTITY_TYPES },
    $and: [
      { $or: [{ departments: { $exists: false } }, { departments: { $size: 0 } }] },
      { $or: [{ researchAreas: { $exists: false } }, { researchAreas: { $size: 0 } }] },
    ],
  };

  const query = ResearchEntity.find(filter)
    .select('_id slug name school departments researchAreas fullDescription')
    .sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const entities = (await query.lean()) as EntityRow[];

  const rows: FundingProgramTopicBackfillPlanRow[] = [];
  for (const entity of entities) {
    rows.push(
      await planFundingProgramTopicBackfillRow({
        id: String(entity._id),
        slug: entity.slug,
        name: entity.name,
        fullDescription: entity.fullDescription,
        school: entity.school,
        departments: entity.departments,
        researchAreas: entity.researchAreas,
      }),
    );
  }

  const changedRows = rows.filter((row) => row.changed);

  let syncedToMeili = 0;
  if (!options.dryRun && changedRows.length > 0) {
    for (let i = 0; i < changedRows.length; i += options.batchSize) {
      const batch = changedRows.slice(i, i + options.batchSize);
      await ResearchEntity.bulkWrite(
        batch.map((row) => ({
          updateOne: {
            filter: { _id: row.id },
            update: { $set: row.update },
          },
        })),
      );
      const fresh = await ResearchEntity.find({ _id: { $in: batch.map((row) => row.id) } }).lean();
      await syncEntities('researchEntity', fresh);
      syncedToMeili += fresh.length;
    }
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeFundingProgramTopicBackfill(rows),
    sampleChanges: changedRows.slice(0, 25),
    syncedToMeili,
  };
}

async function main(): Promise<void> {
  const options = parseFundingProgramTopicBackfillArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirmFundingProgramTopics) {
    throw new Error('Apply mode requires --confirm-funding-program-topics.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'funding-program topic metadata backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runFundingProgramTopicBackfill({
      dryRun: options.dryRun,
      limit: options.limit,
      batchSize: options.batchSize,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: {
        dryRun: options.dryRun,
        limit: options.limit,
        batchSize: options.batchSize,
      },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
      console.log(`Saved funding-program topic backfill report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result.summary, null, 2));
    if (apply && result.summary.changed > 0) {
      console.log(
        `Synced ${result.syncedToMeili} changed entities to the Meilisearch research index.`,
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
