/**
 * Repairs the confirmed-bad blast radius from issue #1653: live funding-program
 * (`FELLOWSHIP_PROGRAM`/`RA_PROGRAM`/`PROGRAM`) `shortDescription` values that
 * serve raw administrative-announcement copy (bare "invites applications"
 * naming, self-referential "is listed by" chrome, a stray scraped asterisk, a
 * mid-name truncation, or a stale absolute year) instead of an offer/
 * eligibility summary. Scoped to the exact ids and text confirmed at audit
 * time (see `repair1653ProgramCardAdminCopyShortDescriptionsCore`); every
 * other record is left untouched.
 *
 * Dry-run-first. Apply requires `--confirm-program-card-admin-copy-repair`,
 * is blocked against production by `assertScriptApplyAllowed`, and only
 * rewrites entities whose card actually changes. Meilisearch is re-synced for
 * the changed entities after an apply so the search card matches Mongo.
 */
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
  PROGRAM_CARD_ADMIN_COPY_TARGET_IDS,
  planProgramCardAdminCopyRepairRow,
  summarizeProgramCardAdminCopyRepair,
  type ProgramCardAdminCopyRepairPlanRow,
  type ProgramCardAdminCopyRepairSummary,
} from './repair1653ProgramCardAdminCopyShortDescriptionsCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface ProgramCardAdminCopyRepairCliOptions {
  dryRun: boolean;
  confirm: boolean;
  syncMeili: boolean;
  output?: string;
}

export function parseProgramCardAdminCopyRepairArgs(
  argv: string[],
): ProgramCardAdminCopyRepairCliOptions {
  const options: ProgramCardAdminCopyRepairCliOptions = {
    dryRun: true,
    confirm: false,
    syncMeili: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-program-card-admin-copy-repair') options.confirm = true;
    else if (arg === '--no-sync') options.syncMeili = false;
    else if (arg === '--output') {
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

export interface ProgramCardAdminCopyRepairResult {
  mode: 'dry-run' | 'apply';
  summary: ProgramCardAdminCopyRepairSummary;
  changes: ProgramCardAdminCopyRepairPlanRow[];
  meiliSynced: number;
}

interface EntityRow {
  _id: unknown;
  slug?: string;
  name?: string;
  shortDescription?: unknown;
  fullDescription?: unknown;
}

export async function runProgramCardAdminCopyRepair(options: {
  dryRun: boolean;
  syncMeili: boolean;
}): Promise<ProgramCardAdminCopyRepairResult> {
  const targetIds = Object.keys(PROGRAM_CARD_ADMIN_COPY_TARGET_IDS);
  const entities = (await ResearchEntity.find({ _id: { $in: targetIds } })
    .select('_id slug name shortDescription fullDescription')
    .lean()) as EntityRow[];

  const rows = entities.map((entity) =>
    planProgramCardAdminCopyRepairRow({
      id: String(entity._id),
      slug: entity.slug,
      name: entity.name,
      shortDescription: entity.shortDescription,
      fullDescription: entity.fullDescription,
    }),
  );
  const changedRows = rows.filter((row) => row.changed);

  let meiliSynced = 0;
  if (!options.dryRun && changedRows.length > 0) {
    await ResearchEntity.bulkWrite(
      changedRows.map((row) =>
        row.after
          ? {
              updateOne: {
                filter: { _id: row.id },
                update: { $set: { shortDescription: row.after } },
              },
            }
          : {
              updateOne: {
                filter: { _id: row.id },
                update: { $unset: { shortDescription: '' } },
              },
            },
      ),
    );
    if (options.syncMeili) {
      const changedIds = changedRows.map((row) => row.id);
      const freshDocs = await ResearchEntity.find({ _id: { $in: changedIds } }).lean();
      await syncEntities('researchEntity', freshDocs);
      meiliSynced = freshDocs.length;
    }
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeProgramCardAdminCopyRepair(rows),
    changes: changedRows,
    meiliSynced,
  };
}

async function main(): Promise<void> {
  const options = parseProgramCardAdminCopyRepairArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirm) {
    throw new Error('Apply mode requires --confirm-program-card-admin-copy-repair.');
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: 'program card administrative-copy shortDescription repair',
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runProgramCardAdminCopyRepair({
      dryRun: options.dryRun,
      syncMeili: options.syncMeili,
    });
    const payload = {
      generatedAt: new Date().toISOString(),
      environment: guard.environment,
      db: guard.dbLabel,
      options: { dryRun: options.dryRun, syncMeili: options.syncMeili },
      result,
    };
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(safeOutput, JSON.stringify(payload, null, 2));
      console.log(`Saved program card admin-copy repair report to ${safeOutput}`);
    }
    console.log(
      JSON.stringify({ summary: result.summary, changes: result.changes, meiliSynced: result.meiliSynced }, null, 2),
    );
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
