import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  normalizeWebsiteUrl,
  planFacultyResearchPromotion,
  PROMOTABLE_SOURCE_ENTITY_TYPE,
  PROMOTED_ENTITY_TYPE,
  PROMOTED_KIND,
  summarizeFacultyResearchPromotion,
  type FacultyResearchPromotionRow,
} from './promoteFacultyResearchToLabCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SYNC_BATCH_SIZE = 200;
const NOT_ARCHIVED = { $or: [{ archived: { $exists: false } }, { archived: false }] };

export interface FacultyResearchPromotionOptions {
  dryRun: boolean;
  limit: number;
  explicitLimit: boolean;
  confirm: boolean;
  output?: string;
}

function parsePositiveInt(value: string | undefined): number {
  if (!value || value.startsWith('--') || !/^[1-9]\d*$/.test(value)) {
    throw new Error('--limit must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('--limit must be a positive integer');
  return parsed;
}

export function parseFacultyResearchPromotionArgs(
  argv: string[],
): FacultyResearchPromotionOptions {
  const options: FacultyResearchPromotionOptions = {
    dryRun: true,
    limit: 0,
    explicitLimit: false,
    confirm: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-promote-faculty-research') options.confirm = true;
    else if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInt(arg.slice('--limit='.length));
      options.explicitLimit = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInt(argv[i + 1]);
      options.explicitLimit = true;
      i += 1;
    } else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else {
      throw new Error(`Unknown research-entity:promote-faculty-research argument: ${arg}`);
    }
  }
  return options;
}

export function assertFacultyResearchPromotionApplyAllowed(
  options: Pick<FacultyResearchPromotionOptions, 'dryRun' | 'confirm' | 'explicitLimit'>,
): void {
  const apply = !options.dryRun;
  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-promote-faculty-research.');
  }
  if (apply && !options.explicitLimit) {
    throw new Error('Apply mode requires an explicit --limit.');
  }
}

export interface FacultyResearchPromotionResult {
  mode: 'dry-run' | 'apply';
  scanned: number;
  promoted: number;
  held: number;
  kindRealigned: number;
  updated: number;
  synced: number;
  errors: number;
  byHoldReason: Record<string, number>;
  promotedSamples: FacultyResearchPromotionRow[];
  heldSamples: FacultyResearchPromotionRow[];
}

/**
 * Usage is counted across every live entity, not just the faculty-research rows:
 * a URL shared with a center or an existing lab is someone else's page grafted
 * onto this row, and promoting it would mint a duplicate lab (#2460, #2234).
 */
async function buildUrlUsage(): Promise<{
  websiteUrls: Map<string, number>;
  sourceUrls: Map<string, number>;
}> {
  const docs = (await ResearchEntity.find(NOT_ARCHIVED, {
    websiteUrl: 1,
    sourceUrls: 1,
  }).lean()) as Array<{ websiteUrl?: string; sourceUrls?: string[] }>;
  const websiteUrls = new Map<string, number>();
  const sourceUrls = new Map<string, number>();
  for (const doc of docs) {
    const websiteKey = normalizeWebsiteUrl(doc.websiteUrl);
    if (websiteKey) websiteUrls.set(websiteKey, (websiteUrls.get(websiteKey) ?? 0) + 1);
    for (const raw of doc.sourceUrls ?? []) {
      const key = normalizeWebsiteUrl(raw);
      if (key) sourceUrls.set(key, (sourceUrls.get(key) ?? 0) + 1);
    }
  }
  return { websiteUrls, sourceUrls };
}

export async function runFacultyResearchPromotion(options: {
  dryRun: boolean;
  limit?: number;
}): Promise<FacultyResearchPromotionResult> {
  const usage = await buildUrlUsage();

  const query = ResearchEntity.find(
    { ...NOT_ARCHIVED, entityType: PROMOTABLE_SOURCE_ENTITY_TYPE },
    { _id: 1, slug: 1, name: 1, entityType: 1, kind: 1, websiteUrl: 1, sourceUrls: 1 },
  ).sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);

  const candidates = (await query.lean()) as Array<Record<string, unknown>>;
  const plan = planFacultyResearchPromotion(
    candidates.map((doc) => ({
      id: doc._id,
      slug: typeof doc.slug === 'string' ? doc.slug : undefined,
      name: typeof doc.name === 'string' ? doc.name : undefined,
      entityType: typeof doc.entityType === 'string' ? doc.entityType : undefined,
      kind: typeof doc.kind === 'string' ? doc.kind : undefined,
      websiteUrl: typeof doc.websiteUrl === 'string' ? doc.websiteUrl : undefined,
      urlUsageCount:
        typeof doc.websiteUrl === 'string'
          ? (usage.websiteUrls.get(normalizeWebsiteUrl(doc.websiteUrl)) ?? 0)
          : 0,
      sourceUrlUsageCounts: (Array.isArray(doc.sourceUrls) ? (doc.sourceUrls as string[]) : [])
        .map((raw) => normalizeWebsiteUrl(raw))
        .filter(Boolean)
        .map((key) => usage.sourceUrls.get(key) ?? 0),
    })),
  );
  const summary = summarizeFacultyResearchPromotion(candidates.length, plan);
  const promotions = plan.filter((row) => row.decision === 'PROMOTE');

  const result: FacultyResearchPromotionResult = {
    mode: options.dryRun ? 'dry-run' : 'apply',
    scanned: summary.scanned,
    promoted: summary.promoted,
    held: summary.held,
    kindRealigned: summary.kindRealigned,
    updated: 0,
    synced: 0,
    errors: 0,
    byHoldReason: summary.byHoldReason,
    promotedSamples: promotions.slice(0, 25),
    heldSamples: plan.filter((row) => row.decision === 'HOLD').slice(0, 25),
  };

  if (options.dryRun || promotions.length === 0) return result;

  for (let i = 0; i < promotions.length; i += SYNC_BATCH_SIZE) {
    const batch = promotions.slice(i, i + SYNC_BATCH_SIZE);
    try {
      await ResearchEntity.bulkWrite(
        batch.map((row) => {
          const set: Record<string, string> = { entityType: PROMOTED_ENTITY_TYPE };
          if (row.toKind) set.kind = PROMOTED_KIND;
          return { updateOne: { filter: { _id: row.id }, update: { $set: set } } };
        }),
      );
      result.updated += batch.length;
      const fresh = await ResearchEntity.find({ _id: { $in: batch.map((row) => row.id) } }).lean();
      await syncEntities('researchEntity', fresh);
      result.synced += fresh.length;
    } catch (error) {
      result.errors += batch.length;
      console.error('faculty-research promotion batch failed:', sanitizeLogValue(error));
    }
  }
  return result;
}

async function main(): Promise<void> {
  const options = parseFacultyResearchPromotionArgs(process.argv.slice(2));
  assertFacultyResearchPromotionApplyAllowed(options);
  const apply = !options.dryRun;

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'research-entity:promote-faculty-research',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runFacultyResearchPromotion({
      dryRun: options.dryRun,
      limit: options.explicitLimit ? options.limit : undefined,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { dryRun: options.dryRun, limit: options.explicitLimit ? options.limit : undefined },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, `${JSON.stringify(payload, null, 2)}\n`);
      console.log(`Saved faculty-research promotion report to ${safeOutput}`);
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
