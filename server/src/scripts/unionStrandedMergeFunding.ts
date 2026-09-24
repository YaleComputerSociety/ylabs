/**
 * Carries the funding evidence a completed merge left behind on its archived
 * duplicate over to the survivor it should already be serving (#1928).
 *
 * A merge archives the duplicate and points its `canonicalGroupId` at the
 * survivor. The dedupe lane unions the duplicate's grants and funding agencies
 * into the survivor at the moment it merges, but a duplicate archived by any other
 * path never had that union run, and no lane re-plans an already-archived row. So
 * the award records sit on a row nobody can reach while the survivor serves a card
 * with no funding evidence on it at all.
 *
 * Only `recentGrants`, `recentGrantCount` and `fundingAgencies` move. Rematerializing
 * the survivor from the duplicate's key would also plan its name, descriptions,
 * researchAreas and websiteUrl over the survivor's own, which is the graft this
 * repository spends #1407 and #2972 undoing. An award record is a different kind of
 * claim: it names an agency, an id and a period, and it belongs to whichever row the
 * tombstone says holds the identity.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { initializeConnections } from '../db/connections';
import { ResearchEntity } from '../models/researchEntity';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planStrandedFundingUnion,
  unionKeepsEveryCanonicalGrant,
  type StrandedFundingUnionPlan,
} from './unionStrandedMergeFundingCore';
import {
  MERGE_RELINKABLE_OBSERVATION_FIELDS,
  planStrandedFundingObservationRelink,
} from './researchEntityPiDedupeCore';

dotenv.config();
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const SCRIPT_NAME = 'research-entity:union-stranded-merge-funding';

export interface UnionStrandedMergeFundingArgs {
  apply: boolean;
  confirm: boolean;
  maxApply: number;
  output?: string;
}

export function parseUnionStrandedMergeFundingArgs(argv: string[]): UnionStrandedMergeFundingArgs {
  const args: UnionStrandedMergeFundingArgs = { apply: false, confirm: false, maxApply: 400 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-union-stranded-merge-funding') args.confirm = true;
    else if (arg.startsWith('--max-apply=')) {
      args.maxApply = parsePositiveInteger(arg.slice('--max-apply='.length));
    } else if (arg === '--max-apply') {
      args.maxApply = parsePositiveInteger(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
    else if (arg === '--output') {
      args.output = argv[index + 1];
      index += 1;
    } else throw new Error(`Unknown ${SCRIPT_NAME} argument: ${arg}`);
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

export function assertUnionStrandedMergeFundingApplyAllowed(args: {
  apply: boolean;
  confirm: boolean;
  plannedCanonicals: number;
  maxApply: number;
}): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(`--confirm-union-stranded-merge-funding is required when --apply is set.`);
  }
  if (args.plannedCanonicals > args.maxApply) {
    throw new Error(
      `Apply would write ${args.plannedCanonicals} survivors, above --max-apply=${args.maxApply}.`,
    );
  }
}

interface PlannedCanonical {
  canonicalId: string;
  canonicalSlug?: string;
  canonicalTier?: string;
  duplicateSlugs: string[];
  addedGrants: number;
  addedAgencies: number;
  grantsBefore: number;
  grantsAfter: number;
  plan: StrandedFundingUnionPlan;
}

const SELECT =
  '_id slug archived studentVisibilityTier recentGrants recentGrantCount fundingAgencies canonicalGroupId';

export interface StrandedFundingRelinkPair {
  canonicalSlug?: string;
  duplicateSlugs: string[];
}

export async function loadStrandedFundingPlans(): Promise<{
  planned: PlannedCanonical[];
  relinkPairs: StrandedFundingRelinkPair[];
  refusedNonSuperset: number;
  archivedDuplicatesScanned: number;
  canonicalsUnreachable: number;
}> {
  const duplicates = (await ResearchEntity.find({
    archived: true,
    canonicalGroupId: { $exists: true, $ne: null },
    $or: [
      { recentGrants: { $exists: true, $ne: [] } },
      { fundingAgencies: { $exists: true, $ne: [] } },
    ],
  })
    .select(SELECT)
    .lean()) as any[];

  const byCanonical = new Map<string, any[]>();
  for (const duplicate of duplicates) {
    const key = String(duplicate.canonicalGroupId);
    if (!byCanonical.has(key)) byCanonical.set(key, []);
    byCanonical.get(key)!.push(duplicate);
  }

  const canonicals = (await ResearchEntity.find({
    _id: { $in: [...byCanonical.keys()] },
    archived: { $ne: true },
  })
    .select(SELECT)
    .lean()) as any[];

  const planned: PlannedCanonical[] = [];
  let refusedNonSuperset = 0;
  for (const canonical of canonicals) {
    const group = byCanonical.get(String(canonical._id)) ?? [];
    const plan = planStrandedFundingUnion(canonical, group);
    if (!plan) continue;
    if (!unionKeepsEveryCanonicalGrant(canonical, plan)) {
      refusedNonSuperset += 1;
      continue;
    }
    const canonicalId = serializedDocumentId(canonical._id);
    if (!canonicalId) continue;
    planned.push({
      canonicalId,
      canonicalSlug: canonical.slug,
      canonicalTier: canonical.studentVisibilityTier,
      duplicateSlugs: group.map((row) => row.slug).filter(Boolean),
      addedGrants: plan.addedGrants,
      addedAgencies: plan.addedAgencies,
      grantsBefore: Array.isArray(canonical.recentGrants) ? canonical.recentGrants.length : 0,
      grantsAfter: plan.recentGrants.length,
      plan,
    });
  }
  planned.sort((left, right) =>
    String(left.canonicalSlug).localeCompare(String(right.canonicalSlug)),
  );

  // Every reachable survivor and its archived duplicates, independent of whether the
  // union still has anything to add. The relink arm must be planned separately,
  // because a survivor whose union is already written plans nothing here while its
  // duplicates' observations stay stranded, and gating the relink on `planned` makes
  // the repair a silent no-op on exactly the rows a previous run half-fixed (#3145).
  const relinkPairs = canonicals.map((canonical) => ({
    canonicalSlug: canonical.slug as string | undefined,
    duplicateSlugs: (byCanonical.get(String(canonical._id)) ?? [])
      .map((row) => row.slug)
      .filter(Boolean) as string[],
  }));

  return {
    planned,
    relinkPairs,
    refusedNonSuperset,
    archivedDuplicatesScanned: duplicates.length,
    canonicalsUnreachable: byCanonical.size - canonicals.length,
  };
}

async function applyPlans(planned: PlannedCanonical[]): Promise<number> {
  let written = 0;
  for (const entry of planned) {
    const result = await ResearchEntity.updateOne(
      { _id: new mongoose.Types.ObjectId(entry.canonicalId), archived: { $ne: true } },
      {
        $set: {
          recentGrants: entry.plan.recentGrants,
          recentGrantCount: entry.plan.recentGrantCount,
          fundingAgencies: entry.plan.fundingAgencies,
        },
      },
    );
    if (result.modifiedCount > 0) written += 1;
  }
  return written;
}

/**
 * Re-key the archived duplicates' funding observations onto each survivor.
 *
 * Without this the union above is not durable: the survivor's next materialize pass
 * projects funding from the observations its own key can reach, and the duplicate's
 * observations still carry the duplicate's `entityKey`, so the pass reverts the union
 * it just wrote. Measured on Development, re-materializing two repaired survivors
 * dropped all 7 unioned grants straight back off (#3145).
 */
async function relinkStrandedFundingObservations(
  pairs: StrandedFundingRelinkPair[],
): Promise<number> {
  const db = mongoose.connection.db;
  if (!db) return 0;
  let relinked = 0;
  for (const entry of pairs) {
    const survivorKey = (entry.canonicalSlug || '').trim();
    const duplicateKeys = entry.duplicateSlugs.filter(Boolean);
    if (!survivorKey || duplicateKeys.length === 0) continue;
    const observations = await db
      .collection('observations')
      .find({
        entityKey: { $in: duplicateKeys },
        field: { $in: [...MERGE_RELINKABLE_OBSERVATION_FIELDS] },
        retractedAt: { $exists: false },
      })
      .project({ _id: 1, entityKey: 1, field: 1, entityId: 1 })
      .toArray();
    const plan = planStrandedFundingObservationRelink({
      survivorKey,
      duplicateKeys,
      observations: observations.map((row) => ({
        id: row._id,
        entityKey: row.entityKey,
        field: row.field,
        entityId: row.entityId,
      })),
    });
    if (!plan) continue;
    const result = await db
      .collection('observations')
      .updateMany(
        { _id: { $in: plan.ids as mongoose.Types.ObjectId[] } },
        { $set: { entityKey: plan.survivorKey, updatedAt: new Date() } },
      );
    relinked += result.modifiedCount || 0;
  }
  return relinked;
}

async function main(): Promise<void> {
  const args = parseUnionStrandedMergeFundingArgs(process.argv.slice(2));
  const guard = assertScriptApplyAllowed({
    apply: args.apply,
    scriptName: SCRIPT_NAME,
    mongoUrl: process.env.MONGODBURL,
  });
  await initializeConnections();

  const loaded = await loadStrandedFundingPlans();
  assertUnionStrandedMergeFundingApplyAllowed({
    apply: args.apply,
    confirm: args.confirm,
    plannedCanonicals: loaded.planned.length,
    maxApply: args.maxApply,
  });

  const survivorsWritten = args.apply ? await applyPlans(loaded.planned) : 0;
  // After the union write, so a relink failure cannot leave the survivor projecting
  // from evidence whose union was never stored (#3145).
  const fundingObservationsRelinked = args.apply
    ? await relinkStrandedFundingObservations(loaded.relinkPairs)
    : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    archivedDuplicatesScanned: loaded.archivedDuplicatesScanned,
    canonicalsUnreachable: loaded.canonicalsUnreachable,
    plannedCanonicals: loaded.planned.length,
    refusedBecauseUnionWouldDropAGrant: loaded.refusedNonSuperset,
    plannedAddedGrants: loaded.planned.reduce((sum, entry) => sum + entry.addedGrants, 0),
    plannedAddedAgencies: loaded.planned.reduce((sum, entry) => sum + entry.addedAgencies, 0),
    plannedSurvivorsServingZeroGrantsToday: loaded.planned.filter(
      (entry) => entry.grantsBefore === 0,
    ).length,
    plannedByCanonicalTier: loaded.planned.reduce<Record<string, number>>((acc, entry) => {
      const key = entry.canonicalTier || 'UNKNOWN';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    survivorsWritten,
    fundingObservationsRelinked,
    plan: loaded.planned.map(({ plan, ...rest }) => rest),
    nextStep:
      'Re-run the visibility gate over the written survivors so the funding signal reaches the gate, then re-read them through getResearchGroupDetail.',
  };

  if (args.output) {
    const safeOutput = resolveSafeJsonReportOutputPath(args.output);
    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    fs.writeFileSync(safeOutput, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify({ ...report, plan: report.plan.slice(0, 25) }, null, 2));
  await mongoose.disconnect();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(sanitizeLogValue(error));
    process.exit(1);
  });
}
