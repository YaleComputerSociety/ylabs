import mongoose from 'mongoose';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import type { DirectoryRemovalMatcher } from '../services/directoryRemovalMatcher';
import {
  numberedSlugCandidate,
  slugWithoutRemovedLead,
} from '../services/directoryRemovalSlugNames';
import { getResearchEntityRosterByEntityId } from '../services/researchEntityMembershipAccessor';
import {
  addIndexSyncOutcomes,
  NO_INDEX_SYNC,
  syncResearchEntitiesWithOutcome,
  type IndexSyncOutcome,
} from '../services/researchEntityIndexSyncOutcome';
import { studentVisibilityGateLeadRows } from '../services/studentVisibilityGateService';

export const SCRIPT_NAME = 'directory-removal:reslug';

const MAX_SLUG_ATTEMPTS = 50;

export interface ReslugArgs {
  apply: boolean;
}

export function parseReslugArgs(argv: string[]): ReslugArgs {
  const args: ReslugArgs = { apply: false };
  for (const arg of argv) {
    if (arg === '--') continue;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else {
      throw new Error(
        `Unknown ${SCRIPT_NAME} argument: ${arg}. It takes no identifier: it matches every active entry in directory_removals.`,
      );
    }
  }
  return args;
}

export function assertReslugMatcherUsable(matcher: DirectoryRemovalMatcher): void {
  if (matcher.state === 'inert') {
    throw new Error(
      `${SCRIPT_NAME} found no active directory_removals entry, so no row has a removed lead.`,
    );
  }
  if (matcher.state !== 'active') {
    throw new Error(
      `${SCRIPT_NAME} cannot match anyone without a directory removal key, so it refuses rather than guess.`,
    );
  }
}

export interface ReslugPlan {
  entityId: mongoose.Types.ObjectId;
  fromSlug: string;
  toSlug: string;
}

export interface ReslugCounts {
  removedResearchers: number;
  liveRowsLedByARemovedResearcher: number;
  rowsWithNoOtherLiveLead: number;
  rowsWhoseSlugNamesNoRemovedLead: number;
  rowsToRename: number;
  rowsTakingANumberedSlug: number;
  observationsToStamp: number;
}

export interface ReslugReport extends ReslugCounts {
  apply: boolean;
  rowsRenamed?: number;
  observationsStamped?: number;
  searchDocumentsResynced?: number;
  searchIndexSyncFailures?: number;
  searchIndexSyncDeferred?: number;
}

interface RemovedResearcher {
  _id: mongoose.Types.ObjectId;
  displayName?: string;
}

async function removedResearchersOf(
  matcher: DirectoryRemovalMatcher,
): Promise<RemovedResearcher[]> {
  const researchers = await Researcher.find({ archived: { $ne: true } })
    .select('_id displayName identifiers profileLinks.url')
    .lean<Array<RemovedResearcher & Record<string, any>>>();
  return researchers.filter((researcher) => matcher.isRemovedPerson(researcher));
}

const keylessObservationsOf = (slug: string) => ({
  entityType: 'researchEntity' as const,
  entityKey: slug,
  entityId: null,
});

async function slugIsTaken(slug: string, reserved: ReadonlySet<string>): Promise<boolean> {
  if (reserved.has(slug)) return true;
  if (await ResearchEntity.exists({ $or: [{ slug }, { 'mergedFrom.slug': slug }] })) return true;
  return Boolean(await Observation.exists({ entityType: 'researchEntity', entityKey: slug }));
}

async function firstFreeSlug(base: string, reserved: ReadonlySet<string>): Promise<string> {
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = numberedSlugCandidate(base, attempt);
    if (!(await slugIsTaken(candidate, reserved))) return candidate;
  }
  throw new Error(`${SCRIPT_NAME} found no free numbered slug after ${MAX_SLUG_ATTEMPTS} tries.`);
}

export async function planDirectoryRemovalReslugs(
  matcher: DirectoryRemovalMatcher,
): Promise<{ plans: ReslugPlan[]; counts: ReslugCounts }> {
  const removed = await removedResearchersOf(matcher);
  const removedIds = new Set(removed.map((researcher) => String(researcher._id)));
  const counts: ReslugCounts = {
    removedResearchers: removed.length,
    liveRowsLedByARemovedResearcher: 0,
    rowsWithNoOtherLiveLead: 0,
    rowsWhoseSlugNamesNoRemovedLead: 0,
    rowsToRename: 0,
    rowsTakingANumberedSlug: 0,
    observationsToStamp: 0,
  };
  if (removed.length === 0) return { plans: [], counts };

  const ledEntityIds = await RoleAssignment.distinct('target.id', {
    personId: { $in: removed.map((researcher) => researcher._id) },
    'target.kind': 'RESEARCH_ENTITY',
    role: { $in: LEAD_ROLE_CANONICAL_VALUES },
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  });
  const rows = await ResearchEntity.find({ _id: { $in: ledEntityIds }, archived: { $ne: true } })
    .select('_id slug')
    .sort({ _id: 1 })
    .lean<Array<{ _id: mongoose.Types.ObjectId; slug: string }>>();
  const rosters = await getResearchEntityRosterByEntityId(rows.map((row) => row._id));

  const plans: ReslugPlan[] = [];
  const reserved = new Set<string>();
  for (const row of rows) {
    const leads = studentVisibilityGateLeadRows(rosters.get(String(row._id)) ?? []);
    const removedLeads = leads.filter((lead) => removedIds.has(String(lead.userId)));
    if (removedLeads.length === 0) continue;
    counts.liveRowsLedByARemovedResearcher += 1;
    const remainingLeadNames = leads
      .filter((lead) => !removedIds.has(String(lead.userId)))
      .map((lead) => lead.name);
    if (remainingLeadNames.length === 0) {
      counts.rowsWithNoOtherLiveLead += 1;
      continue;
    }
    const base = removedLeads.reduce(
      (slug, lead) =>
        slugWithoutRemovedLead({ slug, removedLeadName: lead.name, remainingLeadNames }) ?? slug,
      row.slug,
    );
    if (base === row.slug) {
      counts.rowsWhoseSlugNamesNoRemovedLead += 1;
      continue;
    }
    const toSlug = await firstFreeSlug(base, reserved);
    reserved.add(toSlug);
    if (toSlug !== base) counts.rowsTakingANumberedSlug += 1;
    counts.rowsToRename += 1;
    counts.observationsToStamp += await Observation.countDocuments(keylessObservationsOf(row.slug));
    plans.push({ entityId: row._id, fromSlug: row.slug, toSlug });
  }
  return { plans, counts };
}

async function applyPlan(plan: ReslugPlan): Promise<{ stamped: number; renamed: number }> {
  const stamped = await Observation.updateMany(keylessObservationsOf(plan.fromSlug), {
    $set: { entityId: plan.entityId },
  });
  const renamed = await ResearchEntity.updateOne(
    { _id: plan.entityId, slug: plan.fromSlug, archived: { $ne: true } },
    { $set: { slug: plan.toSlug } },
  );
  return { stamped: stamped.modifiedCount, renamed: renamed.matchedCount };
}

export async function runDirectoryRemovalReslug(args: {
  matcher: DirectoryRemovalMatcher;
  apply: boolean;
}): Promise<ReslugReport> {
  assertReslugMatcherUsable(args.matcher);
  const { plans, counts } = await planDirectoryRemovalReslugs(args.matcher);
  if (!args.apply) return { apply: false, ...counts };

  let observationsStamped = 0;
  let rowsRenamed = 0;
  const renamedIds: mongoose.Types.ObjectId[] = [];
  for (const plan of plans) {
    const outcome = await applyPlan(plan);
    observationsStamped += outcome.stamped;
    rowsRenamed += outcome.renamed;
    if (outcome.renamed > 0) renamedIds.push(plan.entityId);
  }
  const index: IndexSyncOutcome = renamedIds.length
    ? addIndexSyncOutcomes(
        NO_INDEX_SYNC,
        await syncResearchEntitiesWithOutcome(
          await ResearchEntity.find({ _id: { $in: renamedIds } }).lean(),
        ),
      )
    : NO_INDEX_SYNC;
  return {
    apply: true,
    ...counts,
    rowsRenamed,
    observationsStamped,
    searchDocumentsResynced: index.resynced,
    searchIndexSyncFailures: index.indexSyncFailures,
    ...(index.indexSyncDeferred ? { searchIndexSyncDeferred: index.indexSyncDeferred } : {}),
  };
}
