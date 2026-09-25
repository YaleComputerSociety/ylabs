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
import { materializeEntity } from '../scrapers/entityMaterializer';
import { planFieldLockRelease } from '../utils/researchEntityFieldLocks';
import { planFieldValueRefusal } from '../utils/researchEntityFieldValueRefusals';
import {
  LAB_TYPE_CORRECTIONS,
  LAB_TYPE_CORRECTION_REFUSAL_NOTE,
  LAB_TYPE_CORRECTION_REFUSED_BY,
  LAB_TYPE_CORRECTION_REFUSED_FIELD,
  planLabTypeCorrections,
  summarizeLabTypeCorrections,
  type LabTypeCorrectionEntity,
  type LabTypeCorrectionPlanRow,
} from './repairLabNamedFacultyResearchTypesCore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:repair-lab-named-faculty-research-types';

export interface LabTypeCorrectionCliOptions {
  dryRun: boolean;
  confirmLabTypeCorrection: boolean;
  output?: string;
}

export function parseLabTypeCorrectionArgs(argv: string[]): LabTypeCorrectionCliOptions {
  const options: LabTypeCorrectionCliOptions = { dryRun: true, confirmLabTypeCorrection: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply' || arg === '--mode=apply') options.dryRun = false;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') options.dryRun = true;
    else if (arg === '--confirm-lab-type-correction') options.confirmLabTypeCorrection = true;
    else if (arg === '--output') {
      options.output = resolveSafeJsonReportOutputPath(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = resolveSafeJsonReportOutputPath(arg.slice('--output='.length));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export async function runLabTypeCorrections(options: { dryRun: boolean }): Promise<{
  mode: 'dry-run' | 'apply';
  summary: ReturnType<typeof summarizeLabTypeCorrections>;
  rows: LabTypeCorrectionPlanRow[];
}> {
  const entities = await ResearchEntity.find({
    slug: { $in: LAB_TYPE_CORRECTIONS.map((correction) => correction.slug) },
  })
    .select(
      'slug name entityType kind archived manuallyLockedFields studentVisibilityTier fieldValueRefusals',
    )
    .lean<LabTypeCorrectionEntity[]>();

  const rows = planLabTypeCorrections(entities);
  const planned = rows.filter((row) => row.outcome === 'plan');

  if (!options.dryRun && planned.length > 0) {
    await ResearchEntity.bulkWrite(
      planned.map((row) => ({
        updateOne: { filter: { slug: row.slug }, update: { $set: row.update } },
      })),
    );
    const updated = await ResearchEntity.find({
      slug: { $in: planned.map((row) => row.slug) },
    }).lean();
    await syncEntities('researchEntity', updated as any);
  }

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    summary: summarizeLabTypeCorrections(rows),
    rows,
  };
}

async function main(): Promise<void> {
  const options = parseLabTypeCorrectionArgs(process.argv.slice(2));
  const apply = !options.dryRun;

  if (apply && !options.confirmLabTypeCorrection) {
    throw new Error(`${SCRIPT_NAME} apply mode requires --confirm-lab-type-correction.`);
  }

  const guard = assertScriptApplyAllowed({
    apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  console.log(
    `Environment: ${guard.environment}; Mongo target: ${guard.dbLabel}; mode: ${apply ? 'apply' : 'dry-run'}`,
  );

  await initializeConnections();
  try {
    const result = await runLabTypeCorrections({ dryRun: options.dryRun });
    if (options.output) {
      const safeOutput = resolveSafeJsonReportOutputPath(options.output);
      fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
      fs.writeFileSync(
        safeOutput,
        JSON.stringify(
          { generatedAt: new Date().toISOString(), environment: guard.environment, ...result },
          null,
          2,
        ),
      );
      console.log(`Saved lab-type correction report to ${safeOutput}`);
    }
    console.log(JSON.stringify(result, null, 2));
    if (apply && result.summary.plan > 0) {
      console.log(
        'Run student-visibility:gate to recompute the tier for these rows; take the before/after from the gate dry-run rather than from a query over student_ready.',
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

/**
 * Swaps the `entityType` lock this repair used to take for a refusal of the roster value.
 *
 * The lock and the refusal are not equivalent: a lock holds the field against every
 * future source, a refusal rejects one value and stays withdrawable. Releasing the lock
 * without recording the refusal first would let the next materialization revert the
 * correction, so the refusal is written and the row re-materialized before the lock comes
 * off, and the run reports whether the corrected type survived on its own (#3362).
 */
export async function migrateLabTypeLocksToRefusals(options: { apply: boolean }): Promise<{
  mode: 'dry-run' | 'apply';
  rowsCiting: number;
  refusalsRecorded: number;
  locksReleased: number;
  survivedRematerialize: number;
  revertedAfterRelease: number;
}> {
  const slugs = LAB_TYPE_CORRECTIONS.map((correction) => correction.slug);
  const rows = (await ResearchEntity.find({
    slug: { $in: slugs },
    manuallyLockedFields: LAB_TYPE_CORRECTION_REFUSED_FIELD,
  })
    .select('slug entityType manuallyLockedFields fieldValueRefusals')
    .lean()) as Array<Record<string, unknown>>;

  let refusalsRecorded = 0;
  let locksReleased = 0;
  let survivedRematerialize = 0;
  let revertedAfterRelease = 0;

  for (const row of rows) {
    const slug = String(row.slug ?? '');
    const correction = LAB_TYPE_CORRECTIONS.find((entry) => entry.slug === slug);
    if (!correction || !options.apply) continue;
    const refusedValue = 'FACULTY_RESEARCH_AREA';
    const refusal = planFieldValueRefusal(row.fieldValueRefusals, {
      field: LAB_TYPE_CORRECTION_REFUSED_FIELD,
      value: refusedValue,
      rule: 'superseded_by_better_source',
      refusedBy: LAB_TYPE_CORRECTION_REFUSED_BY,
      note: LAB_TYPE_CORRECTION_REFUSAL_NOTE,
      evidenceUrl: correction.evidence,
    });
    await ResearchEntity.updateOne({ slug }, { $set: refusal });
    refusalsRecorded += 1;

    // Refusal first, lock second. The reverse order leaves a window in which the next
    // materialization reverts the correction.
    //
    // Routed through `planFieldLockRelease` rather than a `$pull`: the planner is the
    // single owner of a lock list and it drops the field's lock provenance in the same
    // update, which a hand-written pull leaves behind.
    const release = planFieldLockRelease(row.manuallyLockedFields, [
      LAB_TYPE_CORRECTION_REFUSED_FIELD,
    ]);
    await ResearchEntity.updateOne(
      { slug },
      Object.keys(release.unset).length > 0
        ? { $set: release.set, $unset: release.unset }
        : { $set: release.set },
    );
    locksReleased += 1;

    await materializeEntity('researchEntity', { entityKey: slug }, { syncMeilisearch: false });
    const after = (await ResearchEntity.findOne({ slug }).select('entityType').lean()) as {
      entityType?: unknown;
    } | null;
    if (after?.entityType === 'LAB') survivedRematerialize += 1;
    else revertedAfterRelease += 1;
  }

  return {
    mode: options.apply ? 'apply' : 'dry-run',
    rowsCiting: rows.length,
    refusalsRecorded,
    locksReleased,
    survivedRematerialize,
    revertedAfterRelease,
  };
}
