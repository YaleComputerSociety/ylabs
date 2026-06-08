/**
 * Backfill the ResearchEntity `browseRankScore` for the default /research
 * "best first" browse ordering.
 *
 * New scrape/materialize runs recompute the score automatically (in
 * entityMaterializer, after access signals are derived). This script applies it
 * to the already-materialized corpus so existing entities are ranked instead of
 * sinking to the bottom (Meilisearch sorts docs missing a sortable attribute
 * last). Re-runnable and idempotent — only entities whose score actually changes
 * are written and re-synced.
 *
 * Dry-run-first. Apply mode requires `--confirm-browse-rank`, and is blocked
 * against production unless CONFIRM_PROD_SCRAPE=true.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { recomputeBrowseRankForEntities } from '../services/researchEntityBrowseRankService';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface BrowseRankBackfillCliOptions {
  dryRun: boolean;
  limit?: number;
  batchSize: number;
  confirmBrowseRank: boolean;
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

export function parseBrowseRankBackfillArgs(argv: string[]): BrowseRankBackfillCliOptions {
  const options: BrowseRankBackfillCliOptions = {
    dryRun: true,
    batchSize: 200,
    confirmBrowseRank: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm-browse-rank') {
      options.confirmBrowseRank = true;
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
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--output requires a path');
      options.output = next;
      i += 1;
    } else if (arg.startsWith('--output=')) {
      const value = arg.slice('--output='.length).trim();
      if (!value || value.startsWith('--')) throw new Error('--output requires a path');
      options.output = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export interface BrowseRankBackfillResult {
  mode: 'dry-run' | 'apply';
  considered: number;
  updated: number;
  sampleScores: Array<{ id: string; name?: string; score: number }>;
}

export async function runBrowseRankBackfill(options: {
  dryRun: boolean;
  limit?: number;
  batchSize: number;
}): Promise<BrowseRankBackfillResult> {
  const query = ResearchEntity.find({ archived: { $ne: true } }).select('_id name').sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const entities = (await query.lean()) as Array<{ _id: any; name?: string }>;
  const nameById = new Map(entities.map((e) => [String(e._id), e.name]));

  const result: BrowseRankBackfillResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    considered: 0,
    updated: 0,
    sampleScores: [],
  };

  for (let i = 0; i < entities.length; i += options.batchSize) {
    const batch = entities.slice(i, i + options.batchSize).map((e) => e._id);
    const batchResult = await recomputeBrowseRankForEntities(batch, { dryRun: options.dryRun });
    result.considered += batchResult.considered;
    result.updated += batchResult.updated;
    for (const [id, score] of batchResult.scoresByEntityId) {
      if (result.sampleScores.length >= 25) break;
      result.sampleScores.push({ id, name: nameById.get(id), score });
    }
  }

  result.sampleScores.sort((a, b) => b.score - a.score);
  return result;
}

async function main(): Promise<void> {
  const options = parseBrowseRankBackfillArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirmBrowseRank) {
    throw new Error('Apply mode requires --confirm-browse-rank.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'browse-rank backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runBrowseRankBackfill({
      dryRun: options.dryRun,
      limit: options.limit,
      batchSize: options.batchSize,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { dryRun: options.dryRun, limit: options.limit, batchSize: options.batchSize },
      result,
    };
    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(payload, null, 2));
      console.log(`Saved browse-rank backfill report to ${options.output}`);
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
    console.error(error);
    process.exit(1);
  });
}
