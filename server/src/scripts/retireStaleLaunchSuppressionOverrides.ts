/**
 * Retires a `studentVisibilityOverrideTier: 'suppressed'` that a single pre-#1802
 * launch-strictness pass wrote on 2026-06-11, on rows the gate now computes as
 * public and whose recorded reasons are all soft (#1898).
 *
 * Two properties of the repair matter more than the predicate.
 *
 * It retires the backing observation as well as the document field. Every row in
 * this cohort carries one live `manual-admin-edit` observation asserting the
 * override, so clearing the field alone leaves a later materialization free to
 * re-assert it. That is not hypothetical: the per-row repairs recorded on #1898 in
 * August 2026 were all back at `suppressed` when the cohort was re-measured.
 *
 * And `--apply` requires an explicit `--slug`. An override is an operator's
 * decision about one row, so retiring one is too. The dry-run names the whole
 * cohort and reports what each row would serve; an operator names the rows.
 *
 * A `CORE_FACILITY` or `INITIATIVE` row is held by a standing product question
 * rather than a stale flag (#1721), so the report splits the cohort by that and
 * `--apply` on such a row additionally requires `--product-decision-recorded`. The
 * split is the point: every check in the core module is a measurement, and a
 * measurement cannot release a row whose hold is a product answer. Leaving that in
 * this docblock made the two look interchangeable in the one place an operator
 * actually reads, which is the report.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { serializedDocumentId } from '../utils/idSerialization';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  isStaleLaunchOverrideObservationField,
  isStaleLaunchOverrideRefusal,
  planStaleLaunchSuppressionOverrideRetirement,
  STALE_LAUNCH_OVERRIDE_FIELDS,
  type StaleLaunchOverridePlan,
} from './retireStaleLaunchSuppressionOverridesCore';

dotenv.config();
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const SCRIPT_NAME = 'visibility:retire-stale-launch-overrides';
const ROLLBACK_REASON =
  'pre-#1802 launch-strictness override: the reasons it records are all soft enrichment signals that no longer gate, so the override hides a card the gate computes as public (#1898)';

export interface RetireStaleLaunchSuppressionOverridesArgs {
  apply: boolean;
  confirm: boolean;
  productDecisionRecorded: boolean;
  slugs: string[];
  output?: string;
}

export function parseRetireStaleLaunchSuppressionOverridesArgs(
  argv: string[],
): RetireStaleLaunchSuppressionOverridesArgs {
  const args: RetireStaleLaunchSuppressionOverridesArgs = {
    apply: false,
    confirm: false,
    productDecisionRecorded: false,
    slugs: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-retire-stale-launch-overrides') args.confirm = true;
    else if (arg === '--product-decision-recorded') args.productDecisionRecorded = true;
    else if (arg.startsWith('--slug=')) args.slugs.push(arg.slice('--slug='.length).trim());
    else if (arg === '--slug') {
      args.slugs.push((argv[index + 1] || '').trim());
      index += 1;
    } else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') {
      args.output = argv[index + 1];
      index += 1;
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
  }
  args.slugs = [...new Set(args.slugs.filter(Boolean))];
  return args;
}

export function assertRetireStaleLaunchSuppressionOverridesApplyAllowed(args: {
  apply: boolean;
  confirm: boolean;
  productDecisionRecorded: boolean;
  slugs: string[];
  selectedCount: number;
  awaitingProductDecisionCount: number;
}): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(`--confirm-retire-stale-launch-overrides is required when --apply is set.`);
  }
  if (args.slugs.length === 0) {
    throw new Error(
      `--slug is required when --apply is set: an override is a per-row operator decision, so retiring one is too.`,
    );
  }
  if (args.selectedCount !== args.slugs.length) {
    throw new Error(
      `--apply selected ${args.selectedCount} of ${args.slugs.length} named slug(s). Every named slug must be in the retirable cohort; re-read the dry-run.`,
    );
  }
  if (args.awaitingProductDecisionCount > 0 && !args.productDecisionRecorded) {
    throw new Error(
      `${args.awaitingProductDecisionCount} named row(s) are held by a standing product question rather than a stale flag, so no measurement releases them. Answer the question the dry-run reports, then re-run with --product-decision-recorded.`,
    );
  }
}

interface CohortRow {
  entityId: string;
  slug: string;
  entityType?: string;
  computedTier: string;
  softReasons: string[];
  awaitingProductDecision?: string;
}

export async function loadStaleLaunchOverrideCohort(): Promise<{
  retirable: CohortRow[];
  refused: Array<{ slug: string; entityType?: string; refusedBecause: string }>;
}> {
  const entities = (await ResearchEntity.find({
    studentVisibilityOverrideTier: 'suppressed',
    archived: { $ne: true },
  })
    .select(
      '_id slug entityType archived studentVisibilityOverrideTier studentVisibilityComputedTier studentVisibilityTier studentVisibilityReasons studentVisibilityComputedReasons studentVisibilitySuppressionReason',
    )
    .lean()) as any[];

  const retirable: CohortRow[] = [];
  const refused: Array<{ slug: string; entityType?: string; refusedBecause: string }> = [];
  for (const entity of entities) {
    const plan = planStaleLaunchSuppressionOverrideRetirement(entity);
    if (!plan) continue;
    if (isStaleLaunchOverrideRefusal(plan)) {
      refused.push({
        slug: entity.slug,
        entityType: entity.entityType,
        refusedBecause: plan.refusedBecause,
      });
      continue;
    }
    const entityId = serializedDocumentId(entity._id);
    if (!entityId) continue;
    const retirablePlan = plan as StaleLaunchOverridePlan;
    retirable.push({
      entityId,
      slug: entity.slug,
      entityType: entity.entityType,
      computedTier: retirablePlan.computedTier,
      softReasons: retirablePlan.softReasons,
      ...(retirablePlan.awaitingProductDecision
        ? { awaitingProductDecision: retirablePlan.awaitingProductDecision }
        : {}),
    });
  }
  retirable.sort((left, right) => left.slug.localeCompare(right.slug));
  refused.sort((left, right) => String(left.slug).localeCompare(String(right.slug)));
  return { retirable, refused };
}

async function loadBackingObservationIds(rows: CohortRow[]): Promise<string[]> {
  if (rows.length === 0) return [];
  const observations = (await Observation.find({
    entityType: 'researchEntity',
    $or: [
      { entityId: { $in: rows.map((row) => new mongoose.Types.ObjectId(row.entityId)) } },
      { entityKey: { $in: rows.map((row) => row.slug) } },
    ],
    field: { $in: [...STALE_LAUNCH_OVERRIDE_FIELDS] },
    superseded: { $ne: true },
  })
    .select('_id field')
    .lean()) as any[];

  return observations
    .filter((observation) => isStaleLaunchOverrideObservationField(observation.field))
    .map((observation) => serializedDocumentId(observation._id))
    .filter((id): id is string => Boolean(id));
}

async function applyRetirement(
  rows: CohortRow[],
  observationIds: string[],
): Promise<{ entitiesCleared: number; observationsRetired: number }> {
  let entitiesCleared = 0;
  for (const row of rows) {
    const result = await ResearchEntity.updateOne(
      { _id: new mongoose.Types.ObjectId(row.entityId) },
      {
        $unset: {
          studentVisibilityOverrideTier: '',
          studentVisibilitySuppressionReason: '',
          'fieldProvenance.studentVisibilityOverrideTier': '',
          'fieldProvenance.studentVisibilitySuppressionReason': '',
        },
      },
    );
    if (result.modifiedCount > 0) entitiesCleared += 1;
  }

  let observationsRetired = 0;
  if (observationIds.length > 0) {
    const result = await Observation.updateMany(
      {
        _id: { $in: observationIds.map((id) => new mongoose.Types.ObjectId(id)) },
        superseded: { $ne: true },
      },
      {
        $set: {
          superseded: true,
          rollback: { rolledBackAt: new Date(), reason: ROLLBACK_REASON },
        },
      },
    );
    observationsRetired = result.modifiedCount || 0;
  }

  return { entitiesCleared, observationsRetired };
}

async function main(): Promise<void> {
  const args = parseRetireStaleLaunchSuppressionOverridesArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const { retirable, refused } = await loadStaleLaunchOverrideCohort();
  const selected =
    args.slugs.length > 0 ? retirable.filter((row) => args.slugs.includes(row.slug)) : retirable;

  assertRetireStaleLaunchSuppressionOverridesApplyAllowed({
    apply: args.apply,
    confirm: args.confirm,
    productDecisionRecorded: args.productDecisionRecorded,
    slugs: args.slugs,
    selectedCount: selected.length,
    awaitingProductDecisionCount: selected.filter((row) => row.awaitingProductDecision).length,
  });

  const observationIds = await loadBackingObservationIds(selected);
  const applied = args.apply
    ? await applyRetirement(selected, observationIds)
    : { entitiesCleared: 0, observationsRetired: 0 };

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    cohortRetirable: retirable.length,
    cohortRetirableStaleFlagOnly: retirable.filter((row) => !row.awaitingProductDecision).length,
    cohortAwaitingProductDecision: retirable.filter((row) => row.awaitingProductDecision).length,
    cohortRefused: refused.length,
    selected: selected.length,
    backingObservations: observationIds.length,
    entitiesCleared: applied.entitiesCleared,
    observationsRetired: applied.observationsRetired,
    retirableByEntityType: retirable.reduce<Record<string, number>>((acc, row) => {
      const key = row.entityType || 'UNKNOWN';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    retirableRows: retirable,
    refusedRows: refused,
    nextStep:
      'Re-run the visibility gate over the cleared rows, then re-read them through getResearchGroupDetail.',
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
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
