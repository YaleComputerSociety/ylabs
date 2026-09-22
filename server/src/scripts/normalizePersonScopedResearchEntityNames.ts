import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import {
  applyStudentVisibilityGatePlans,
  planStudentVisibilityGate,
} from '../services/studentVisibilityGateService';
import { syncEntities } from '../services/meiliSyncService';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  personScopedNamePlanIsEmpty,
  planPersonScopedNameNormalization,
  type PersonScopedNamePlan,
} from './normalizePersonScopedResearchEntityNamesCore';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCRIPT_NAME = 'research-entity:normalize-person-scoped-names';

export interface NormalizePersonScopedNamesArgs {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseArgs(argv: string[]): NormalizePersonScopedNamesArgs {
  const args: NormalizePersonScopedNamesArgs = { apply: false, confirm: false, maxApply: 500 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-person-scoped-name-normalization') args.confirm = true;
    else if (arg.startsWith('--max-apply=')) {
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length));
    } else if (arg === '--max-apply') args.maxApply = parsePositiveInteger(argv[++index]);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') args.output = argv[++index];
  }
  return args;
}

function parsePositiveInteger(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--max-apply must be a safe positive integer');
  }
  return parsed;
}

interface PlannedEntity {
  entityId: string;
  slug: string;
  entityType: string;
  kind: string;
  studentVisibilityTier: string;
  plan: PersonScopedNamePlan;
}

async function loadPlannedEntities(): Promise<PlannedEntity[]> {
  const docs = await ResearchEntity.find(
    { archived: { $ne: true } },
    {
      slug: 1,
      name: 1,
      displayName: 1,
      entityType: 1,
      kind: 1,
      studentVisibilityTier: 1,
      manuallyLockedFields: 1,
    },
  ).lean();

  return docs
    .map((doc) => ({
      entityId: String(serializedDocumentId((doc as any)._id) || ''),
      slug: String((doc as any).slug || ''),
      entityType: String((doc as any).entityType || ''),
      kind: String((doc as any).kind || ''),
      studentVisibilityTier: String((doc as any).studentVisibilityTier || ''),
      plan: planPersonScopedNameNormalization(doc as any),
    }))
    .filter((entry) => !personScopedNamePlanIsEmpty(entry.plan));
}

/**
 * The rows a rename can change the gate outcome for without itself being renamed.
 * `duplicate_name_risk` is a corpus-wide input, so giving one row the name another
 * row already stores changes the OTHER row's verdict too, and re-gating only the
 * renamed side would leave a stale tier on the incumbent. Measured on Development:
 * 6 of 108 renames land on a name some other live row already holds, which are
 * pre-existing grafts this repair makes byte-identical rather than creates.
 */
export async function loadCollisionCounterpartIds(planned: PlannedEntity[]): Promise<string[]> {
  const renamedTo = new Set(
    planned.flatMap((entry) =>
      entry.plan.renames.filter((rename) => rename.field === 'name').map((rename) => rename.to),
    ),
  );
  if (renamedTo.size === 0) return [];
  const plannedIds = new Set(planned.map((entry) => entry.entityId));
  const docs = await ResearchEntity.find(
    { archived: { $ne: true }, name: { $in: Array.from(renamedTo) } },
    { _id: 1 },
  )
    .collation({ locale: 'en', strength: 2 })
    .lean();
  return docs
    .map((doc) => String(serializedDocumentId((doc as any)._id) || ''))
    .filter((id) => id && !plannedIds.has(id));
}

async function applyRepair(
  planned: PlannedEntity[],
  collisionCounterpartIds: string[],
): Promise<{ renamedEntities: number; renamedFields: number; regatedEntities: number }> {
  const renameTargets = planned.filter((entry) => entry.plan.renames.length > 0);
  let renamedFields = 0;
  for (const entry of renameTargets) {
    const set: Record<string, string> = {};
    for (const rename of entry.plan.renames) set[rename.field] = rename.to;
    await ResearchEntity.updateOne({ _id: entry.entityId }, { $set: set });
    renamedFields += entry.plan.renames.length;
  }

  // Every planned row is re-gated, not only the unrecoverable ones: the gate reads
  // `name`, so a row this pass renamed has to be re-evaluated against its new value
  // rather than keeping a tier computed from the old one.
  const regateIds = Array.from(
    new Set([...planned.map((entry) => entry.entityId), ...collisionCounterpartIds]),
  );
  let regatedEntities = 0;
  if (regateIds.length > 0) {
    const gatePlans = await planStudentVisibilityGate({
      collection: 'research',
      mode: 'apply',
      recordIds: regateIds,
    });
    await applyStudentVisibilityGatePlans(gatePlans);
    regatedEntities = regateIds.length;
  }

  if (renameTargets.length > 0) {
    const refreshed = await ResearchEntity.find({
      _id: { $in: renameTargets.map((entry) => entry.entityId) },
    }).lean();
    await syncEntities('researchEntity', refreshed);
  }

  return { renamedEntities: renameTargets.length, renamedFields, regatedEntities };
}

function countBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = key(row) || 'UNKNOWN';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const planned = await loadPlannedEntities();
  const collisionCounterpartIds = await loadCollisionCounterpartIds(planned);
  const renameRows = planned.filter((entry) => entry.plan.renames.length > 0);
  const regateRows = planned.filter((entry) => entry.plan.regateForUnusableName);
  const lockedRows = planned.filter((entry) => entry.plan.skippedLockedFields.length > 0);

  if (args.apply) {
    if (!args.confirm) {
      throw new Error(
        '--confirm-person-scoped-name-normalization is required when --apply is set.',
      );
    }
    if (planned.length > args.maxApply) {
      throw new Error(
        `Apply would touch ${planned.length} entities, above --max-apply=${args.maxApply}.`,
      );
    }
  }

  const applied = args.apply
    ? await applyRepair(planned, collisionCounterpartIds)
    : { renamedEntities: 0, renamedFields: 0, regatedEntities: 0 };

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    plannedEntities: planned.length,
    plannedBarePersonNameRenames: renameRows.length,
    plannedRenamedFields: renameRows.reduce((sum, entry) => sum + entry.plan.renames.length, 0),
    plannedUnusableNameRegates: regateRows.length,
    plannedSkippedLockedFieldRows: lockedRows.length,
    plannedCollisionCounterpartRegates: collisionCounterpartIds.length,
    renameRowsByEntityType: countBy(renameRows, (entry) => entry.entityType),
    renameRowsByVisibilityTier: countBy(renameRows, (entry) => entry.studentVisibilityTier),
    regateRowsByVisibilityTier: countBy(regateRows, (entry) => entry.studentVisibilityTier),
    renamedEntities: applied.renamedEntities,
    renamedFields: applied.renamedFields,
    regatedEntities: applied.regatedEntities,
    entities: planned.map((entry) => ({
      slug: entry.slug,
      entityType: entry.entityType,
      studentVisibilityTier: entry.studentVisibilityTier,
      renamedFields: entry.plan.renames.map((rename) => rename.field),
      regateForUnusableName: entry.plan.regateForUnusableName,
      skippedLockedFields: entry.plan.skippedLockedFields,
    })),
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify({ ...report, entities: report.entities.slice(0, 25) }, null, 2));
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
