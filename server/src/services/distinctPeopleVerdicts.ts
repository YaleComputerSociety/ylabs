import mongoose from 'mongoose';
import { Researcher } from '../models/researcher';
import { RoleAssignment } from '../models/roleAssignment';
import {
  buildDistinctPeopleVerdictIndex,
  distinctPeopleVerdictPairsJoinedByFold,
  type DistinctPeopleVerdictIndex,
  type DistinctPeopleVerdictPair,
} from '../scrapers/distinctPeopleVerdict';

const LEAD_ROLES = ['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR'];

export async function loadDistinctPeopleVerdictIndex(): Promise<DistinctPeopleVerdictIndex> {
  const holders = (await Researcher.find({
    'distinctFromResearcherIds.0': { $exists: true },
  })
    .select('_id distinctFromResearcherIds')
    .lean()) as Array<{ _id: unknown; distinctFromResearcherIds?: unknown[] }>;
  const verdicts = holders.map((holder) => ({
    researcherId: String(holder._id),
    distinctFromResearcherIds: (holder.distinctFromResearcherIds ?? []).map(String),
  }));
  if (verdicts.length === 0) return buildDistinctPeopleVerdictIndex({ verdicts });
  const folded = (await Researcher.find({ dedupedIntoResearcherId: { $ne: null } })
    .select('_id dedupedIntoResearcherId')
    .lean()) as Array<{ _id: unknown; dedupedIntoResearcherId?: unknown }>;
  const dedupedIntoByResearcherId = new Map(
    folded
      .filter((row) => row.dedupedIntoResearcherId)
      .map((row) => [String(row._id), String(row.dedupedIntoResearcherId)] as const),
  );
  return buildDistinctPeopleVerdictIndex({ verdicts, dedupedIntoByResearcherId });
}

/**
 * The current lead person ids of each research row, as the fold lanes read them. An
 * archived row's own leads were retired with it, so a lane folding archived rows reads
 * them with `includeRetiredEdges`.
 */
export async function loadCurrentLeadPersonIdsByEntity(
  entityIds: ReadonlyArray<string | mongoose.Types.ObjectId>,
  options: { includeRetiredEdges?: boolean } = {},
): Promise<Map<string, Set<string>>> {
  const leadsByEntity = new Map<string, Set<string>>();
  const ids = [...new Set(entityIds.map(String))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (ids.length === 0) return leadsByEntity;
  const edges = (await RoleAssignment.find({
    'target.kind': 'RESEARCH_ENTITY',
    'target.id': { $in: ids },
    role: { $in: LEAD_ROLES },
    ...(options.includeRetiredEdges
      ? {}
      : { state: { $ne: 'HISTORICAL' }, archived: { $ne: true } }),
    personId: { $exists: true, $ne: null },
  })
    .select('personId target.id')
    .lean()) as Array<{ personId?: unknown; target?: { id?: unknown } }>;
  for (const edge of edges) {
    const entityId = String(edge.target?.id ?? '');
    const leads = leadsByEntity.get(entityId) ?? new Set<string>();
    leads.add(String(edge.personId));
    leadsByEntity.set(entityId, leads);
  }
  return leadsByEntity;
}

export interface DistinctPeopleFoldRefusal<TGroup> {
  group: TGroup;
  joinedVerdictPairs: DistinctPeopleVerdictPair[];
}

/**
 * Splits planned research-row merge groups into those the recorded distinct-people
 * verdicts allow and those they refuse (#5802). A refused group is refused whole: no
 * partial fold is planned in its place, so this can only remove merges.
 */
export async function partitionMergeGroupsByDistinctPeopleVerdict<
  TGroup extends { canonicalEntityId: string; duplicateEntityIds: readonly string[] },
>(
  groups: readonly TGroup[],
  options: {
    verdicts?: DistinctPeopleVerdictIndex;
    leadsByEntity?: ReadonlyMap<string, ReadonlySet<string>>;
  } = {},
): Promise<{ kept: TGroup[]; refused: Array<DistinctPeopleFoldRefusal<TGroup>> }> {
  if (groups.length === 0) return { kept: [], refused: [] };
  const verdicts = options.verdicts ?? (await loadDistinctPeopleVerdictIndex());
  if (verdicts.size === 0) return { kept: [...groups], refused: [] };
  const leadsByEntity =
    options.leadsByEntity ??
    (await loadCurrentLeadPersonIdsByEntity(
      groups.flatMap((group) => [group.canonicalEntityId, ...group.duplicateEntityIds]),
    ));
  const kept: TGroup[] = [];
  const refused: Array<DistinctPeopleFoldRefusal<TGroup>> = [];
  for (const group of groups) {
    const sides = [group.canonicalEntityId, ...group.duplicateEntityIds].map(
      (entityId) => leadsByEntity.get(String(entityId)) ?? new Set<string>(),
    );
    const joinedVerdictPairs = distinctPeopleVerdictPairsJoinedByFold(sides, verdicts);
    if (joinedVerdictPairs.length > 0) refused.push({ group, joinedVerdictPairs });
    else kept.push(group);
  }
  return { kept, refused };
}

export async function mergeGroupJoinsDistinctPeople(group: {
  canonicalEntityId: string;
  duplicateEntityIds: readonly string[];
}): Promise<DistinctPeopleVerdictPair[]> {
  const { refused } = await partitionMergeGroupsByDistinctPeopleVerdict([group]);
  return refused[0]?.joinedVerdictPairs ?? [];
}
