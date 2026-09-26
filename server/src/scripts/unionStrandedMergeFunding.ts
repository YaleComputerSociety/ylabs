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
import { sanitizeLogValue } from '../utils/logSanitizer';
import { assertScriptApplyAllowed, resolveSafeJsonReportOutputPath } from './scriptWriteGuards';
import {
  planUnbackedFundingRevocation,
  type UnbackedFundingRevocation,
} from './unionStrandedMergeFundingCore';
import {
  MERGE_RELINKABLE_OBSERVATION_FIELDS,
  planStrandedFundingObservationRelink,
} from './researchEntityPiDedupeCore';

dotenv.config();
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const SCRIPT_NAME = 'research-entity:union-stranded-merge-funding';

/**
 * The relink re-keys observations across every survivor a tombstone names, not just the
 * ones whose union still has something to add, so it is a named opt-in rather than a
 * default arm of a repair whose blast radius reviewers already signed off on (#3145).
 */
export const RELINK_STRANDED_OBSERVATIONS_FLAG = '--relink-stranded-observations';

export interface UnionStrandedMergeFundingArgs {
  apply: boolean;
  confirm: boolean;
  relinkStrandedObservations: boolean;
  maxApply: number;
  output?: string;
}

export function parseUnionStrandedMergeFundingArgs(argv: string[]): UnionStrandedMergeFundingArgs {
  const args: UnionStrandedMergeFundingArgs = {
    apply: false,
    confirm: false,
    relinkStrandedObservations: false,
    maxApply: 400,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply' || arg === '--mode=apply') args.apply = true;
    else if (arg === '--dry-run' || arg === '--mode=dry-run') args.apply = false;
    else if (arg === '--confirm-union-stranded-merge-funding') args.confirm = true;
    else if (arg === RELINK_STRANDED_OBSERVATIONS_FLAG) args.relinkStrandedObservations = true;
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
  plannedRows: number;
  maxApply: number;
}): void {
  if (!args.apply) return;
  if (!args.confirm) {
    throw new Error(`--confirm-union-stranded-merge-funding is required when --apply is set.`);
  }
  if (args.plannedRows > args.maxApply) {
    throw new Error(
      `Apply would write ${args.plannedRows} rows, above --max-apply=${args.maxApply}.`,
    );
  }
}

const SELECT =
  '_id slug archived studentVisibilityTier recentGrants recentGrantCount fundingAgencies canonicalGroupId';

export interface StrandedFundingRelinkPair {
  canonicalSlug?: string;
  duplicateSlugs: string[];
}

export async function loadStrandedFundingPlans(): Promise<{
  relinkPairs: StrandedFundingRelinkPair[];
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

  // Every reachable survivor and its archived duplicates. There is no union arm to gate
  // this on any more: the funding fields are complete restatements, so the only thing a
  // merge owes its survivor is that the duplicate's evidence be reachable from the
  // survivor's key, after which resolution decides the value (#3242).
  const relinkPairs = canonicals.map((canonical) => ({
    canonicalSlug: canonical.slug as string | undefined,
    duplicateSlugs: (byCanonical.get(String(canonical._id)) ?? [])
      .map((row) => row.slug)
      .filter(Boolean) as string[],
  }));

  return {
    relinkPairs,
    archivedDuplicatesScanned: duplicates.length,
    canonicalsUnreachable: byCanonical.size - canonicals.length,
  };
}

/**
 * Every live row's stored awards set against the awards its own key actually observes.
 *
 * Reads the observations once rather than per row: the union arm this replaces wrote
 * directly to survivors, so an unbacked award can sit on a row holding no funding
 * observation at all, and a probe restricted to rows with observations would miss
 * exactly those (#3242).
 */
async function probeUnbackedFunding(): Promise<
  Array<{ slug: string; tier?: string; revocation: UnbackedFundingRevocation }>
> {
  const db = mongoose.connection.db;
  if (!db) return [];

  const observedBySlug = new Map<string, Set<string>>();
  const cursor = db
    .collection('observations')
    .find({ field: 'recentGrants', superseded: { $ne: true } })
    .project({ entityKey: 1, value: 1 });
  for await (const doc of cursor) {
    const key = String((doc as any).entityKey ?? '');
    if (!key) continue;
    if (!observedBySlug.has(key)) observedBySlug.set(key, new Set());
    const target = observedBySlug.get(key)!;
    for (const award of Array.isArray((doc as any).value) ? (doc as any).value : []) {
      const id = String((award as any)?.id ?? '').trim();
      if (id) target.add(id.toLowerCase());
    }
  }

  const rows = (await ResearchEntity.find({
    archived: { $ne: true },
    recentGrants: { $exists: true, $ne: [] },
  })
    .select('slug studentVisibilityTier recentGrants recentGrantCount fundingAgencies')
    .lean()) as any[];

  const out: Array<{ slug: string; tier?: string; revocation: UnbackedFundingRevocation }> = [];
  for (const row of rows) {
    const revocation = planUnbackedFundingRevocation(
      row,
      observedBySlug.get(row.slug) ?? new Set<string>(),
    );
    if (revocation) out.push({ slug: row.slug, tier: row.studentVisibilityTier, revocation });
  }
  return out;
}

async function applyUnbackedFundingRevocations(
  plans: Array<{ slug: string; revocation: UnbackedFundingRevocation }>,
): Promise<number> {
  let written = 0;
  for (const entry of plans) {
    const result = await ResearchEntity.updateOne(
      { slug: entry.slug, archived: { $ne: true } },
      {
        $set: {
          recentGrants: entry.revocation.recentGrants,
          recentGrantCount: entry.revocation.recentGrantCount,
          fundingAgencies: entry.revocation.fundingAgencies,
        },
      },
    );
    if (result.modifiedCount > 0) written += 1;
  }
  return written;
}

async function probeStrandedFundingObservations(
  pairs: StrandedFundingRelinkPair[],
): Promise<Array<{ survivorKey: string; ids: unknown[]; fields: string[] }>> {
  const db = mongoose.connection.db;
  if (!db) return [];
  const plans: Array<{ survivorKey: string; ids: unknown[]; fields: string[] }> = [];
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
    if (plan) plans.push(plan);
  }
  return plans;
}

async function applyStrandedFundingObservationRelink(
  plans: Array<{ survivorKey: string; ids: unknown[] }>,
): Promise<number> {
  const db = mongoose.connection.db;
  if (!db) return 0;
  let relinked = 0;
  for (const plan of plans) {
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

  // Probed from the observations themselves rather than from a sibling arm's plan, reported in
  // both modes, so a re-run says what it would still do instead of reporting zero
  // because the union arm already ran (#3145).
  const relinkPlans = await probeStrandedFundingObservations(loaded.relinkPairs);
  const strandedFundingObservations = relinkPlans.reduce(
    (total, plan) => total + plan.ids.length,
    0,
  );
  const fundingObservationsRelinked =
    args.apply && args.relinkStrandedObservations
      ? await applyStrandedFundingObservationRelink(relinkPlans)
      : 0;

  // After the relink, so an award the relink has just made observable is not revoked as
  // unbacked on the same run (#3242).
  const unbackedPlans = await probeUnbackedFunding();
  const unbackedAwardRecords = unbackedPlans.reduce(
    (total, entry) => total + entry.revocation.revokedAwards,
    0,
  );
  // Capped on the revoke count, because revoking is the arm that removes a served value.
  assertUnionStrandedMergeFundingApplyAllowed({
    apply: args.apply,
    confirm: args.confirm,
    plannedRows: unbackedPlans.length,
    maxApply: args.maxApply,
  });
  const rowsRevoked = args.apply ? await applyUnbackedFundingRevocations(unbackedPlans) : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    environment: guard.environment,
    db: guard.dbLabel,
    mode: args.apply ? 'apply' : 'dry-run',
    archivedDuplicatesScanned: loaded.archivedDuplicatesScanned,
    canonicalsUnreachable: loaded.canonicalsUnreachable,
    relinkStrandedObservationsFlag: RELINK_STRANDED_OBSERVATIONS_FLAG,
    relinkStrandedObservationsRequested: args.relinkStrandedObservations,
    strandedFundingObservationSurvivors: relinkPlans.length,
    strandedFundingObservations,
    fundingObservationsRelinked,
    rowsStoringAnUnbackedAward: unbackedPlans.length,
    unbackedAwardRecords,
    unbackedByTier: unbackedPlans.reduce<Record<string, number>>((acc, entry) => {
      const key = entry.tier || 'UNKNOWN';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    rowsRevoked,
    plan: unbackedPlans.map((entry) => ({
      tier: entry.tier,
      awardsBefore: entry.revocation.recentGrants.length + entry.revocation.revokedAwards,
      awardsAfter: entry.revocation.recentGrants.length,
      revokedAwards: entry.revocation.revokedAwards,
    })),
    nextStep:
      'Re-gate the revoked rows so the withdrawn funding signal leaves the gate, then re-read them through getResearchGroupDetail.',
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
