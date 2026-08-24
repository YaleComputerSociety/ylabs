/**
 * Repairs research-entity `shortDescription` values that serve a
 * medicine.yale.edu profile's title/appointment/affiliation header ("Dr. X is
 * an Instructor of Medicine ... at Yale School of Medicine and a member of
 * the Center for ...") instead of a research sentence (#1761). Each match is
 * rebuilt from the entity's own `fullDescription` via the shared,
 * deterministic `resolveGroundedCardDescription` path (no LLM), which now
 * skips a leading role/title header when selecting a research sentence and
 * falls back to a researchAreas card summary. An entity whose full
 * description carries no research sentence at all yields no replacement and
 * is left with its stored short untouched; `--regate` then re-runs the
 * student-visibility gate against every candidate record so one whose stored
 * short is still role-header-only (and so still fails
 * `shortDescriptionQuality`) is held below `student_ready` rather than
 * continuing to serve a title-only card.
 *
 * Dry-run-first. Apply requires `--confirm-role-header-short-repair`, is
 * blocked against production by `assertScriptApplyAllowed`, and only rewrites
 * entities whose card actually changes. Meilisearch is re-synced for the
 * changed entities after an apply so the search card matches Mongo.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { syncEntities } from '../services/meiliSyncService';
import {
  planStudentVisibilityGate,
  applyStudentVisibilityGatePlans,
  type StudentVisibilityGatePlan,
} from '../services/studentVisibilityGateService';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planRoleHeaderShortRepairRow,
  summarizeRoleHeaderShortRepair,
  type RoleHeaderShortRepairPlanRow,
  type RoleHeaderShortRepairSummary,
} from './repair1761MedicineProfileRoleHeaderShortDescriptionsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface RoleHeaderShortRepairCliOptions {
  dryRun: boolean;
  confirm: boolean;
  syncMeili: boolean;
  regate: boolean;
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

export function parseRoleHeaderShortRepairArgs(argv: string[]): RoleHeaderShortRepairCliOptions {
  const options: RoleHeaderShortRepairCliOptions = {
    dryRun: true,
    confirm: false,
    syncMeili: true,
    regate: false,
    batchSize: 200,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-role-header-short-repair') options.confirm = true;
    else if (arg === '--no-sync') options.syncMeili = false;
    else if (arg === '--regate') options.regate = true;
    else if (arg.startsWith('--limit='))
      options.limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    else if (arg === '--limit') {
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

export interface RoleHeaderShortRepairResult {
  mode: 'dry-run' | 'apply';
  summary: RoleHeaderShortRepairSummary;
  changes: RoleHeaderShortRepairPlanRow[];
  unresolvedSlugs: string[];
  meiliSynced: number;
  gatePlans: StudentVisibilityGatePlan[];
  gateTierChanged: number;
}

interface EntityRow {
  _id: unknown;
  slug?: string;
  name?: string;
  shortDescription?: unknown;
  fullDescription?: unknown;
  researchAreas?: unknown;
}

function logPlanChange(plan: StudentVisibilityGatePlan): void {
  console.log(
    `  ${plan.label}: ${plan.currentTier ?? 'unset'} -> ${plan.tier} [${plan.reasons.join(', ')}]`,
  );
}

const MEDICINE_PROFILE_SOURCE_URL_PATTERN = /medicine\.yale\.edu/i;

export async function runRoleHeaderShortRepair(options: {
  dryRun: boolean;
  syncMeili: boolean;
  regate: boolean;
  limit?: number;
  batchSize: number;
}): Promise<RoleHeaderShortRepairResult> {
  const query = ResearchEntity.find({
    archived: { $ne: true },
    entityType: 'FACULTY_RESEARCH_AREA',
    studentVisibilityTier: 'student_ready',
    shortDescription: { $type: 'string' },
    sourceUrls: MEDICINE_PROFILE_SOURCE_URL_PATTERN,
  })
    .select('_id slug name shortDescription fullDescription researchAreas')
    .sort({ _id: 1 });
  if (options.limit) query.limit(options.limit);
  const entities = (await query.lean()) as EntityRow[];

  const rows: RoleHeaderShortRepairPlanRow[] = [];
  for (const entity of entities) {
    rows.push(
      await planRoleHeaderShortRepairRow({
        id: String(entity._id),
        slug: entity.slug,
        name: entity.name,
        shortDescription: entity.shortDescription,
        fullDescription: entity.fullDescription,
        researchAreas: entity.researchAreas,
      }),
    );
  }
  const changedRows = rows.filter((row) => row.changed);
  const malformedRows = rows.filter((row) => row.malformed);
  const unresolvedSlugs = malformedRows
    .filter((row) => !row.changed)
    .map((row) => row.slug || row.id);

  let meiliSynced = 0;
  if (!options.dryRun && changedRows.length > 0) {
    for (let i = 0; i < changedRows.length; i += options.batchSize) {
      const batch = changedRows.slice(i, i + options.batchSize);
      await ResearchEntity.bulkWrite(
        batch.map((row) => ({
          updateOne: {
            filter: { _id: row.id },
            update: { $set: { shortDescription: row.after } },
          },
        })),
      );
    }
  }

  let gatePlans: StudentVisibilityGatePlan[] = [];
  let gateTierChanged = 0;
  if (options.regate && malformedRows.length > 0) {
    const affected = await ResearchEntity.find({ slug: { $in: malformedRows.map((row) => row.slug) } })
      .select('_id slug')
      .lean();
    const recordIds = affected.map(
      (doc: any) => serializedDocumentId(doc._id) || String(doc._id),
    );
    gatePlans = await planStudentVisibilityGate({
      collection: 'research',
      mode: options.dryRun ? 'dry-run' : 'apply',
      recordIds,
    });
    gateTierChanged = gatePlans.filter((plan) => plan.tier !== plan.currentTier).length;
    if (!options.dryRun) {
      await applyStudentVisibilityGatePlans(gatePlans);
    }
  }

  if (!options.dryRun && options.syncMeili && (changedRows.length > 0 || gateTierChanged > 0)) {
    const syncSlugs = new Set<string>([
      ...changedRows.map((row) => row.slug || row.id),
      ...(options.regate ? malformedRows.map((row) => row.slug || row.id) : []),
    ]);
    const freshDocs = await ResearchEntity.find({ slug: { $in: Array.from(syncSlugs) } }).lean();
    await syncEntities('researchEntity', freshDocs);
    meiliSynced = freshDocs.length;
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeRoleHeaderShortRepair(rows),
    changes: changedRows,
    unresolvedSlugs,
    meiliSynced,
    gatePlans,
    gateTierChanged,
  };
}

async function main(): Promise<void> {
  const options = parseRoleHeaderShortRepairArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-role-header-short-repair.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'medicine-profile role-header short-description repair',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}; regate: ${options.regate}`,
  );

  await initializeConnections();
  try {
    const result = await runRoleHeaderShortRepair({
      dryRun: options.dryRun,
      syncMeili: options.syncMeili,
      regate: options.regate,
      limit: options.limit,
      batchSize: options.batchSize,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: {
        dryRun: options.dryRun,
        syncMeili: options.syncMeili,
        regate: options.regate,
        limit: options.limit,
        batchSize: options.batchSize,
      },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
      console.log(`Saved role-header short-description repair report to ${safeOutput}`);
    }
    console.log(
      JSON.stringify(
        {
          summary: result.summary,
          unresolvedSlugs: result.unresolvedSlugs,
          meiliSynced: result.meiliSynced,
          gateTierChanged: result.gateTierChanged,
        },
        null,
        2,
      ),
    );
    result.gatePlans.forEach(logPlanChange);
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
