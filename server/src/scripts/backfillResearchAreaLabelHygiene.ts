/**
 * Strip stored `researchAreas[]` extraction artifacts that the read-path guard
 * now fails closed on: symbol-only tokens, citation tails, and lowercase prose
 * fragments (issue #980). The read path already hides these from students, so
 * this backfill only cleans the data at rest and refreshes the Meilisearch
 * `researchentities` index for the changed docs, closing the same drift class
 * #1002 warned about (a backfill that mutates areas but leaves Meili stale).
 *
 * Dry-run-first. Apply mode requires `--confirm-research-areas` and is blocked
 * against production unless SCRAPER_ENV=production and CONFIRM_PROD_SCRAPE=true.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeResearchAreaLabelList } from '../utils/researchAreaLabelHygiene';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface ResearchAreaHygieneCliOptions {
  dryRun: boolean;
  confirmResearchAreas: boolean;
  batchSize: number;
  limit?: number;
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

export function parseResearchAreaHygieneArgs(argv: string[]): ResearchAreaHygieneCliOptions {
  const options: ResearchAreaHygieneCliOptions = {
    dryRun: true,
    confirmResearchAreas: false,
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
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parsePositiveInt(arg.slice('--batch-size='.length), '--batch-size');
    } else if (arg === '--batch-size') {
      options.batchSize = parsePositiveInt(argv[i + 1], '--batch-size');
      i += 1;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1], '--limit');
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

export interface ResearchAreaHygieneChange {
  id: string;
  slug?: string;
  removed: string[];
  after: string[];
}

export interface ResearchAreaHygieneResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  changed: number;
  removedValues: number;
  reindexed: number;
  sampleChanges: ResearchAreaHygieneChange[];
}

interface EntityRow {
  _id: unknown;
  slug?: string;
  researchAreas?: string[];
}

export function planResearchAreaHygieneChange(entity: {
  id: string;
  slug?: string;
  researchAreas?: unknown;
}): ResearchAreaHygieneChange | null {
  const before = Array.isArray(entity.researchAreas)
    ? entity.researchAreas.filter((value): value is string => typeof value === 'string')
    : [];
  if (before.length === 0) return null;
  const after = sanitizeResearchAreaLabelList(before);
  const afterKeys = new Set(after.map((value) => value.toLowerCase()));
  const removed = before.filter((value) => {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 && !afterKeys.has(normalized.toLowerCase());
  });
  if (removed.length === 0 && after.length === before.length) return null;
  return { id: entity.id, slug: entity.slug, removed, after };
}

export async function runResearchAreaHygieneBackfill(options: {
  dryRun: boolean;
  batchSize: number;
  limit?: number;
}): Promise<ResearchAreaHygieneResult> {
  const query = ResearchEntity.find({
    archived: { $ne: true },
    researchAreas: { $exists: true, $ne: [] },
  })
    .select('_id slug researchAreas')
    .sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const entities = (await query.lean()) as EntityRow[];

  const changes: ResearchAreaHygieneChange[] = [];
  for (const entity of entities) {
    const change = planResearchAreaHygieneChange({
      id: String(entity._id),
      slug: entity.slug,
      researchAreas: entity.researchAreas,
    });
    if (change) changes.push(change);
  }

  let reindexed = 0;
  if (!options.dryRun && changes.length > 0) {
    for (let i = 0; i < changes.length; i += options.batchSize) {
      const batch = changes.slice(i, i + options.batchSize);
      await ResearchEntity.bulkWrite(
        batch.map((change) => ({
          updateOne: {
            filter: { _id: change.id },
            update: { $set: { researchAreas: change.after } },
          },
        })),
      );
      const reindexDocs = await ResearchEntity.find({
        _id: { $in: batch.map((change) => change.id) },
      }).lean();
      await syncEntities('researchEntity', reindexDocs);
      reindexed += reindexDocs.length;
    }
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: entities.length,
    changed: changes.length,
    removedValues: changes.reduce((sum, change) => sum + change.removed.length, 0),
    reindexed,
    sampleChanges: changes.slice(0, 25),
  };
}

async function main(): Promise<void> {
  const options = parseResearchAreaHygieneArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirmResearchAreas) {
    throw new Error('Apply mode requires --confirm-research-areas.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'research-area label hygiene backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runResearchAreaHygieneBackfill({
      dryRun: options.dryRun,
      batchSize: options.batchSize,
      limit: options.limit,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { dryRun: options.dryRun, batchSize: options.batchSize, limit: options.limit },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
      console.log(`Saved research-area hygiene report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result, null, 2));
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
