import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { resetOrgUnitCanonicalizerCache } from '../scrapers/orgUnitCanonicalization';
import { syncEntities } from '../services/meiliSyncService';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planSchoolProfileHostRow,
  summarizeSchoolProfileHost,
  type SchoolProfileHostPlanRow,
  type SchoolProfileHostSummary,
} from './backfillSchoolFromProfileHostCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface SchoolProfileHostCliOptions {
  dryRun: boolean;
  confirm: boolean;
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

export function parseSchoolProfileHostArgs(argv: string[]): SchoolProfileHostCliOptions {
  const options: SchoolProfileHostCliOptions = { dryRun: true, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm') {
      options.confirm = true;
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

export interface SchoolProfileHostResult {
  mode: 'dry-run' | 'apply';
  summary: SchoolProfileHostSummary;
  sampleChanges: SchoolProfileHostPlanRow[];
}

interface EntityRow {
  _id: unknown;
  slug?: string;
  name?: string;
  entityType?: string;
  school?: unknown;
  schools?: unknown;
  departments?: unknown;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
}

export async function runSchoolProfileHostBackfill(options: {
  dryRun: boolean;
  limit?: number;
  observedAt?: Date;
}): Promise<SchoolProfileHostResult> {
  resetOrgUnitCanonicalizerCache();
  const observedAt = options.observedAt ?? new Date();

  const filter: Record<string, unknown> = {
    archived: { $ne: true },
    $and: [
      { $or: [{ school: { $exists: false } }, { school: { $in: [null, ''] } }] },
      { $or: [{ schools: { $exists: false } }, { schools: { $size: 0 } }] },
    ],
  };

  const query = ResearchEntity.find(filter)
    .select('_id slug name entityType school schools departments websiteUrl sourceUrls')
    .sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const entities = (await query.lean()) as EntityRow[];

  const rows: Array<SchoolProfileHostPlanRow | null> = [];
  for (const entity of entities) {
    rows.push(
      await planSchoolProfileHostRow(
        {
          id: String(entity._id),
          slug: entity.slug,
          name: entity.name,
          entityType: entity.entityType,
          school: entity.school,
          schools: entity.schools,
          departments: entity.departments,
          websiteUrl: entity.websiteUrl,
          sourceUrls: entity.sourceUrls,
        },
        observedAt,
      ),
    );
  }

  const changedRows = rows.filter((row): row is SchoolProfileHostPlanRow => row !== null);

  if (!options.dryRun && changedRows.length > 0) {
    await ResearchEntity.bulkWrite(
      changedRows.map((row) => ({
        updateOne: { filter: { _id: row.id }, update: { $set: row.update } },
      })),
    );
    const updatedDocs = await ResearchEntity.find({
      _id: { $in: changedRows.map((row) => row.id) },
    }).lean();
    await syncEntities('researchEntity', updatedDocs);
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeSchoolProfileHost(rows),
    sampleChanges: changedRows.slice(0, 25),
  };
}

async function main(): Promise<void> {
  const options = parseSchoolProfileHostArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'research-entity school-from-profile-host backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runSchoolProfileHostBackfill({
      dryRun: options.dryRun,
      limit: options.limit,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { dryRun: options.dryRun, limit: options.limit },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
      console.log(`Saved school-from-profile-host backfill report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result.summary, null, 2));
    if (apply && result.summary.changed > 0) {
      console.log('Rebuilt the Meilisearch research index for the updated entities.');
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
