import mongoose from 'mongoose';
import { LEAD_ROLE_CANONICAL_VALUES } from '../models/canonicalRoleMapping';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import type { DirectoryRemovalMatcher } from '../services/directoryRemovalMatcher';
import { slugWithoutRemovedLead } from '../services/directoryRemovalSlugNames';
import { getResearchEntityRosterByEntityId } from '../services/researchEntityMembershipAccessor';
import { studentVisibilityGateLeadRows } from '../services/studentVisibilityGateService';
import {
  applyResearchEntityReslug,
  firstFreeResearchEntitySlug,
  keylessResearchEntityObservationsOf,
  resyncRenamedResearchEntities,
  type ResearchEntityReslugPlan,
} from './researchEntityReslugCore';

export const SCRIPT_NAME = 'directory-removal:reslug';

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

export type ReslugPlan = ResearchEntityReslugPlan;

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
    const toSlug = await firstFreeResearchEntitySlug(base, reserved, SCRIPT_NAME);
    reserved.add(toSlug);
    if (toSlug !== base) counts.rowsTakingANumberedSlug += 1;
    counts.rowsToRename += 1;
    counts.observationsToStamp += await Observation.countDocuments(
      keylessResearchEntityObservationsOf(row.slug),
    );
    plans.push({ entityId: row._id, fromSlug: row.slug, toSlug });
  }
  return { plans, counts };
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
    const outcome = await applyResearchEntityReslug(plan);
    observationsStamped += outcome.stamped;
    rowsRenamed += outcome.renamed;
    if (outcome.renamed > 0) renamedIds.push(plan.entityId);
  }
  const index = await resyncRenamedResearchEntities(renamedIds);
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
