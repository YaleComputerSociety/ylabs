import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { resetOrgUnitCanonicalizerCache } from '../scrapers/orgUnitCanonicalization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planOrgUnitBackfillRow,
  summarizeOrgUnitBackfill,
  type OrgUnitBackfillPlanRow,
  type OrgUnitBackfillSummary,
} from './backfillResearchEntityOrgUnitsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface OrgUnitBackfillCliOptions {
  dryRun: boolean;
  confirmOrgUnits: boolean;
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

export function parseOrgUnitBackfillArgs(argv: string[]): OrgUnitBackfillCliOptions {
  const options: OrgUnitBackfillCliOptions = {
    dryRun: true,
    confirmOrgUnits: false,
    batchSize: 200,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') {
      options.dryRun = false;
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm-org-units') {
      options.confirmOrgUnits = true;
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

export interface OrgUnitBackfillResult {
  mode: 'dry-run' | 'apply';
  summary: OrgUnitBackfillSummary;
  sampleChanges: OrgUnitBackfillPlanRow[];
}

interface EntityRow {
  _id: unknown;
  slug?: string;
  name?: string;
  school?: unknown;
  departments?: unknown;
  schools?: unknown;
}

export async function runOrgUnitBackfill(options: {
  dryRun: boolean;
  limit?: number;
  batchSize: number;
}): Promise<OrgUnitBackfillResult> {
  resetOrgUnitCanonicalizerCache();

  const filter: Record<string, unknown> = {
    archived: { $ne: true },
    $or: [
      { school: { $exists: true, $ne: '' } },
      { departments: { $exists: true, $not: { $size: 0 } } },
    ],
  };

  const query = ResearchEntity.find(filter)
    .select('_id slug name school departments schools')
    .sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const entities = (await query.lean()) as EntityRow[];

  const rows: OrgUnitBackfillPlanRow[] = [];
  for (const entity of entities) {
    const row = await planOrgUnitBackfillRow({
      id: String(entity._id),
      slug: entity.slug,
      name: entity.name,
      ...(Object.prototype.hasOwnProperty.call(entity, 'school') ? { school: entity.school } : {}),
      ...(Object.prototype.hasOwnProperty.call(entity, 'departments')
        ? { departments: entity.departments }
        : {}),
      schools: entity.schools,
    });
    rows.push(row);
  }

  const changedRows = rows.filter((row) => row.changed);

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
    }
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeOrgUnitBackfill(rows),
    sampleChanges: changedRows.slice(0, 25),
  };
}

async function main(): Promise<void> {
  const options = parseOrgUnitBackfillArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirmOrgUnits) {
    throw new Error('Apply mode requires --confirm-org-units.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'research-entity org-unit re-canonicalization backfill',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runOrgUnitBackfill({
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
      console.log(`Saved org-unit backfill report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result.summary, null, 2));
    if (apply && result.summary.changed > 0) {
      console.log('Rebuild the Meilisearch research index so the department facet picks up new values.');
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
