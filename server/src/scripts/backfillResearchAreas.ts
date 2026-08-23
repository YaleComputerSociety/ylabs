/**
 * Backfill canonicalized ResearchEntity `researchAreas[]` so the /research
 * topical browse facet and area filter stop missing entities (issue #349).
 *
 * For each entity it canonicalizes any existing raw area strings against the
 * seeded `research_areas` catalog and, for entities without areas, derives new
 * ones deterministically from canonical department names and description prose.
 * Matching is normalized-name plus curated alias only; anything that does not
 * resolve is left as its raw string and surfaced in the report review queue,
 * never guessed into a new area (fail closed).
 *
 * Dry-run-first. Apply mode requires `--confirm-research-areas`, is blocked
 * against production unless CONFIRM_PROD_SCRAPE=true, and only rewrites entities
 * whose area list actually changes. Each applied batch is re-synced to the
 * Meilisearch research index so the area facet never drifts from Mongo.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { getResearchAreaCanonicalizer } from '../scrapers/researchAreaCanonicalization';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  normalizeMaxAreas,
  planResearchAreaBackfillRow,
  summarizeResearchAreaBackfill,
  type ResearchAreaBackfillPlanRow,
  type ResearchAreaBackfillSummary,
} from './backfillResearchAreasCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface ResearchAreaBackfillCliOptions {
  dryRun: boolean;
  confirmResearchAreas: boolean;
  onlyEmpty: boolean;
  maxAreas: number;
  limit?: number;
  batchSize: number;
  kinds?: string[];
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

function parseKinds(value: string | undefined): string[] {
  const kinds = (value || '')
    .split(',')
    .map((kind) => kind.trim().toLowerCase())
    .filter((kind) => kind.length > 0);
  if (kinds.length === 0) throw new Error('--kind requires a comma-separated list of kinds');
  return kinds;
}

export function parseResearchAreaBackfillArgs(argv: string[]): ResearchAreaBackfillCliOptions {
  const options: ResearchAreaBackfillCliOptions = {
    dryRun: true,
    confirmResearchAreas: false,
    onlyEmpty: true,
    maxAreas: normalizeMaxAreas(undefined),
    batchSize: 200,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm-research-areas') {
      options.confirmResearchAreas = true;
    } else if (arg === '--include-nonempty') {
      options.onlyEmpty = false;
    } else if (arg === '--only-empty') {
      options.onlyEmpty = true;
    } else if (arg.startsWith('--max-areas=')) {
      options.maxAreas = normalizeMaxAreas(
        parsePositiveInt(arg.slice('--max-areas='.length), '--max-areas'),
      );
    } else if (arg === '--max-areas') {
      options.maxAreas = normalizeMaxAreas(parsePositiveInt(argv[i + 1], '--max-areas'));
      i += 1;
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
    } else if (arg.startsWith('--kind=')) {
      options.kinds = parseKinds(arg.slice('--kind='.length));
    } else if (arg === '--kind') {
      options.kinds = parseKinds(argv[i + 1]);
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

export interface ResearchAreaBackfillResult {
  mode: 'dry-run' | 'apply';
  summary: ResearchAreaBackfillSummary;
  sampleChanges: ResearchAreaBackfillPlanRow[];
  syncedToMeili: number;
}

export interface ResearchAreaApplyDeps {
  persistBatch: (rows: ResearchAreaBackfillPlanRow[]) => Promise<void>;
  syncBatch: (ids: string[]) => Promise<number>;
}

export async function applyResearchAreaChanges(
  changedRows: ResearchAreaBackfillPlanRow[],
  batchSize: number,
  deps: ResearchAreaApplyDeps,
): Promise<{ persisted: number; synced: number }> {
  let persisted = 0;
  let synced = 0;
  for (let i = 0; i < changedRows.length; i += batchSize) {
    const batch = changedRows.slice(i, i + batchSize);
    await deps.persistBatch(batch);
    persisted += batch.length;
    synced += await deps.syncBatch(batch.map((row) => row.id));
  }
  return { persisted, synced };
}

function createResearchAreaApplyDeps(): ResearchAreaApplyDeps {
  return {
    persistBatch: async (batch) => {
      await ResearchEntity.bulkWrite(
        batch.map((row) => ({
          updateOne: {
            filter: { _id: row.id },
            update: { $set: { researchAreas: row.after } },
          },
        })),
      );
    },
    syncBatch: async (ids) => {
      const fresh = await ResearchEntity.find({ _id: { $in: ids } }).lean();
      await syncEntities('researchEntity', fresh);
      return fresh.length;
    },
  };
}

interface EntityRow {
  _id: unknown;
  slug?: string;
  name?: string;
  kind?: string;
  departments?: string[];
  researchAreas?: string[];
  description?: string;
  shortDescription?: string;
  fullDescription?: string;
}

export async function runResearchAreaBackfill(
  options: {
    dryRun: boolean;
    onlyEmpty: boolean;
    maxAreas: number;
    limit?: number;
    batchSize: number;
    kinds?: string[];
  },
  deps: ResearchAreaApplyDeps = createResearchAreaApplyDeps(),
): Promise<ResearchAreaBackfillResult> {
  const canonicalizer = await getResearchAreaCanonicalizer();

  const filter: Record<string, unknown> = { archived: { $ne: true } };
  if (options.kinds && options.kinds.length > 0) filter.kind = { $in: options.kinds };
  if (options.onlyEmpty) {
    filter.$or = [{ researchAreas: { $exists: false } }, { researchAreas: { $size: 0 } }];
  }

  const query = ResearchEntity.find(filter)
    .select('_id slug name kind departments researchAreas shortDescription fullDescription')
    .sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const entities = (await query.lean()) as EntityRow[];

  const rows: ResearchAreaBackfillPlanRow[] = entities.map((entity) =>
    planResearchAreaBackfillRow(
      canonicalizer,
      {
        id: String(entity._id),
        slug: entity.slug,
        name: entity.name,
        kind: entity.kind,
        departments: entity.departments,
        existingResearchAreas: entity.researchAreas,
        shortDescription: entity.shortDescription,
        fullDescription: entity.fullDescription,
      },
      { onlyEmpty: options.onlyEmpty, maxAreas: options.maxAreas },
    ),
  );

  const changedRows = rows.filter((row) => row.changed);

  let syncedToMeili = 0;
  if (!options.dryRun && changedRows.length > 0) {
    const applied = await applyResearchAreaChanges(changedRows, options.batchSize, deps);
    syncedToMeili = applied.synced;
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeResearchAreaBackfill(rows),
    sampleChanges: changedRows.slice(0, 25),
    syncedToMeili,
  };
}

async function main(): Promise<void> {
  const options = parseResearchAreaBackfillArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirmResearchAreas) {
    throw new Error('Apply mode requires --confirm-research-areas.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'research-area backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runResearchAreaBackfill({
      dryRun: options.dryRun,
      onlyEmpty: options.onlyEmpty,
      maxAreas: options.maxAreas,
      limit: options.limit,
      batchSize: options.batchSize,
      kinds: options.kinds,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: {
        dryRun: options.dryRun,
        onlyEmpty: options.onlyEmpty,
        maxAreas: options.maxAreas,
        limit: options.limit,
        batchSize: options.batchSize,
        kinds: options.kinds,
      },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
      console.log(`Saved research-area backfill report to ${safeOutput}`);
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
