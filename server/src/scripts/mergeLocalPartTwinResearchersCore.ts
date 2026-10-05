import type { Db, Document, ObjectId } from 'mongodb';
import type { ResearcherDedupedReason } from '../models/researcher';
import { splitName } from '../scrapers/utils/scraperHelpers';
import { looksLikeYaleNetid } from '../utils/yaleNetid';
import {
  RESEARCHER_UNIQUE_IDENTIFIER_FIELDS,
  planResearcherAttributeUnion,
  roleAssignmentEdgeKey,
  shellProfileLinkKindsReleasedWith,
  type ResearcherAttributeSnapshot,
  type ResearcherAttributeUnionPlan,
} from './dedupeAccountlessResearcherShellsCore';
import {
  loadLiveEmailGroups,
  localPartPairOf,
  netidKeyedReferenceCount,
} from './mergeLocalPartNetidAccountsCore';

export const LOCAL_PART_TWIN_RESEARCHER_DEDUPED_REASON: ResearcherDedupedReason =
  'local-part-netid-twin-account';

const DETACHED_REVIEW_STATUS = 'DISPUTED';

export const TWIN_RESEARCHER_HOLD_REASONS = [
  'account-links-several-researchers',
  'researcher-names-disagree',
  'researcher-identifier-conflict',
  'loser-researcher-holds-disputed-edge',
  'local-part-account-has-login',
  'netid-keyed-references',
  'researcher-identifier-holds-local-part',
] as const;
export type TwinResearcherHoldReason = (typeof TWIN_RESEARCHER_HOLD_REASONS)[number];

export interface TwinResearcherMerge {
  localPartAccountId: ObjectId;
  netidAccountId: ObjectId;
  loserResearcherId: ObjectId;
  survivorResearcherId: ObjectId;
}

export interface TwinResearcherMergePlan {
  pairsWithBothResearchers: number;
  merges: TwinResearcherMerge[];
  held: Record<TwinResearcherHoldReason, number>;
}

const foldName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

function givenAndSurname(displayName: unknown): { given: string; surname: string } {
  const { first, last } = splitName(typeof displayName === 'string' ? displayName : '');
  return {
    given: foldName(first).split(' ')[0] ?? '',
    surname: foldName(last),
  };
}

/**
 * Same normalized surname, and the same given name or a bare initial of it. Deliberately
 * stricter than the lanes' name agreement: the two records sit on two login accounts, so a
 * wrong fold would give one person's account another person's research.
 */
export function displayNamesClearlyAgree(left: unknown, right: unknown): boolean {
  const a = givenAndSurname(left);
  const b = givenAndSurname(right);
  if (!a.surname || !b.surname || !a.given || !b.given) return false;
  if (a.surname !== b.surname) return false;
  if (a.given === b.given) return true;
  if (a.given.length === 1) return b.given.startsWith(a.given);
  if (b.given.length === 1) return a.given.startsWith(b.given);
  return false;
}

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function identifiersConflict(loser: Document, survivor: Document, localPartNetid: string): boolean {
  const loserOrcid = trimmed(loser.identifiers?.orcid).toUpperCase();
  const survivorOrcid = trimmed(survivor.identifiers?.orcid).toUpperCase();
  if (loserOrcid && survivorOrcid && loserOrcid !== survivorOrcid) return true;
  const loserNetid = trimmed(loser.identifiers?.netid).toLowerCase();
  const survivorNetid = trimmed(survivor.identifiers?.netid).toLowerCase();
  if (!loserNetid || !survivorNetid || loserNetid === localPartNetid.toLowerCase()) return false;
  return loserNetid !== survivorNetid;
}

async function holdReasonFor(
  db: Db,
  pair: { localPart: Document; netidAccount: Document },
  loser: Document,
  survivor: Document,
): Promise<TwinResearcherHoldReason | undefined> {
  if (!displayNamesClearlyAgree(loser.displayName, survivor.displayName)) {
    return 'researcher-names-disagree';
  }
  if (identifiersConflict(loser, survivor, pair.localPart.netid)) {
    return 'researcher-identifier-conflict';
  }
  const disputed = await db
    .collection('role_assignments')
    .countDocuments({ personId: loser._id, reviewStatus: DETACHED_REVIEW_STATUS });
  if (disputed > 0) return 'loser-researcher-holds-disputed-edge';
  if (pair.localPart.lastLoginAt != null) return 'local-part-account-has-login';
  if ((await netidKeyedReferenceCount(db, pair.localPart.netid)) > 0) {
    return 'netid-keyed-references';
  }
  const othersHoldingLocalPart = await db
    .collection('researchers')
    .countDocuments({ 'identifiers.netid': pair.localPart.netid, _id: { $ne: loser._id } });
  if (othersHoldingLocalPart > 0) return 'researcher-identifier-holds-local-part';
  return undefined;
}

export async function planLocalPartTwinResearcherMerges(db: Db): Promise<TwinResearcherMergePlan> {
  const plan: TwinResearcherMergePlan = {
    pairsWithBothResearchers: 0,
    merges: [],
    held: Object.fromEntries(TWIN_RESEARCHER_HOLD_REASONS.map((reason) => [reason, 0])) as Record<
      TwinResearcherHoldReason,
      number
    >,
  };
  const researchers = db.collection('researchers');
  for (const group of await loadLiveEmailGroups(db)) {
    const pair = localPartPairOf(group);
    if (!pair) continue;
    const live = { archived: { $ne: true } };
    const losers = await researchers.find({ accountId: pair.localPart._id, ...live }).toArray();
    const survivors = await researchers
      .find({ accountId: pair.netidAccount._id, ...live })
      .toArray();
    if (losers.length === 0 || survivors.length === 0) continue;
    plan.pairsWithBothResearchers += 1;
    if (losers.length !== 1 || survivors.length !== 1) {
      plan.held['account-links-several-researchers'] += 1;
      continue;
    }
    const hold = await holdReasonFor(db, pair, losers[0], survivors[0]);
    if (hold) {
      plan.held[hold] += 1;
      continue;
    }
    plan.merges.push({
      localPartAccountId: pair.localPart._id as ObjectId,
      netidAccountId: pair.netidAccount._id as ObjectId,
      loserResearcherId: losers[0]._id as ObjectId,
      survivorResearcherId: survivors[0]._id as ObjectId,
    });
  }
  return plan;
}

export interface TwinResearcherMergeEdits {
  merge: TwinResearcherMerge;
  repointEdgeIds: ObjectId[];
  archiveRedundantEdgeIds: ObjectId[];
  touchedEntityIds: string[];
  union: ResearcherAttributeUnionPlan;
  loserUnsets: string[];
  releasedProfileLinkKinds: string[];
}

const snapshotOf = (doc: Document): ResearcherAttributeSnapshot => ({
  profileLinks: Array.isArray(doc.profileLinks) ? doc.profileLinks : [],
  identifiers: doc.identifiers ?? {},
  profile: doc.profile ?? {},
});

// The local part reached `identifiers.netid` through the #2831 join defect, so it is not a
// netid and must never be carried onto the surviving record.
function withoutLocalPartNetid(
  union: ResearcherAttributeUnionPlan,
  localPartNetid: string,
): ResearcherAttributeUnionPlan {
  const carried = union.identifierGapFills.netid;
  if (carried === undefined) return union;
  if (looksLikeYaleNetid(carried) && carried.toLowerCase() !== localPartNetid.toLowerCase()) {
    return union;
  }
  const identifierGapFills = Object.fromEntries(
    Object.entries(union.identifierGapFills).filter(([field]) => field !== 'netid'),
  );
  return { ...union, identifierGapFills };
}

export async function planTwinResearcherMergeEdits(
  db: Db,
  merge: TwinResearcherMerge,
): Promise<TwinResearcherMergeEdits | undefined> {
  const researchers = db.collection('researchers');
  const live = { archived: { $ne: true } };
  const loser = await researchers.findOne({
    _id: merge.loserResearcherId,
    accountId: merge.localPartAccountId,
    ...live,
  });
  const survivor = await researchers.findOne({
    _id: merge.survivorResearcherId,
    accountId: merge.netidAccountId,
    ...live,
  });
  const localPart = await db.collection('accounts').findOne({ _id: merge.localPartAccountId });
  if (!loser || !survivor || !localPart) return undefined;
  const localPartNetid = String(localPart.netid ?? '');

  const roleAssignments = db.collection('role_assignments');
  const edgeKey = (edge: Document) =>
    roleAssignmentEdgeKey({
      targetKind: edge.target?.kind,
      targetId: edge.target?.id,
      role: edge.role,
    });
  // A survivor edge an operator detached still claims its key, so a loser edge beside it is
  // archived rather than handed to the survivor live (#3152).
  const survivorKeys = new Set(
    (
      await roleAssignments
        .find({
          personId: survivor._id,
          $or: [{ archived: { $ne: true } }, { reviewStatus: DETACHED_REVIEW_STATUS }],
        })
        .toArray()
    ).map(edgeKey),
  );
  const loserEdges = await roleAssignments
    .find({ personId: loser._id, archived: { $ne: true } })
    .sort({ _id: 1 })
    .toArray();
  const repointEdgeIds: ObjectId[] = [];
  const archiveRedundantEdgeIds: ObjectId[] = [];
  const touchedEntityIds = new Set<string>();
  for (const edge of loserEdges) {
    if (edge.target?.kind === 'RESEARCH_ENTITY' && edge.target?.id) {
      touchedEntityIds.add(String(edge.target.id));
    }
    const key = edgeKey(edge);
    if (survivorKeys.has(key)) {
      archiveRedundantEdgeIds.push(edge._id as ObjectId);
      continue;
    }
    survivorKeys.add(key);
    repointEdgeIds.push(edge._id as ObjectId);
  }

  const union = withoutLocalPartNetid(
    planResearcherAttributeUnion(snapshotOf(survivor), snapshotOf(loser)),
    localPartNetid,
  );
  const loserUnsets = new Set<string>(['accountId']);
  for (const field of Object.keys(union.identifierGapFills)) {
    if (RESEARCHER_UNIQUE_IDENTIFIER_FIELDS.has(field)) loserUnsets.add(`identifiers.${field}`);
  }
  if (trimmed(loser.identifiers?.netid).toLowerCase() === localPartNetid.toLowerCase()) {
    loserUnsets.add('identifiers.netid');
  }
  return {
    merge,
    repointEdgeIds,
    archiveRedundantEdgeIds,
    touchedEntityIds: [...touchedEntityIds].sort(),
    union,
    loserUnsets: [...loserUnsets].sort(),
    releasedProfileLinkKinds: shellProfileLinkKindsReleasedWith(union),
  };
}

export interface TwinResearcherMergeApplyResult {
  researchersMerged: number;
  edgesRepointed: number;
  edgesArchivedRedundant: number;
  profileLinksAppended: number;
  identifiersFilled: Record<string, number>;
  profileFieldsFilled: Record<string, number>;
  skippedStale: number;
  touchedEntityIds: string[];
}

export async function applyLocalPartTwinResearcherMerges(
  db: Db,
  merges: readonly TwinResearcherMerge[],
  now: Date = new Date(),
): Promise<TwinResearcherMergeApplyResult> {
  const result: TwinResearcherMergeApplyResult = {
    researchersMerged: 0,
    edgesRepointed: 0,
    edgesArchivedRedundant: 0,
    profileLinksAppended: 0,
    identifiersFilled: {},
    profileFieldsFilled: {},
    skippedStale: 0,
    touchedEntityIds: [],
  };
  const touched = new Set<string>();
  const researchers = db.collection('researchers');
  const roleAssignments = db.collection('role_assignments');
  for (const merge of merges) {
    const edits = await planTwinResearcherMergeEdits(db, merge);
    if (!edits) {
      result.skippedStale += 1;
      continue;
    }
    // The loser releases its account and unique identifiers before the survivor takes them,
    // because both paths carry unique indexes.
    const loserUpdate: Document = {
      $set: {
        archived: true,
        dedupedIntoResearcherId: merge.survivorResearcherId,
        dedupedAt: now,
        dedupedReason: LOCAL_PART_TWIN_RESEARCHER_DEDUPED_REASON,
      },
      $unset: Object.fromEntries(edits.loserUnsets.map((field) => [field, ''])),
    };
    if (edits.releasedProfileLinkKinds.length > 0) {
      loserUpdate.$pull = { profileLinks: { kind: { $in: edits.releasedProfileLinkKinds } } };
    }
    const archived = await researchers.updateOne(
      {
        _id: merge.loserResearcherId,
        accountId: merge.localPartAccountId,
        archived: { $ne: true },
      },
      loserUpdate,
    );
    if (archived.matchedCount === 0) {
      result.skippedStale += 1;
      continue;
    }
    result.researchersMerged += 1;

    const survivorSet: Document = {};
    for (const [field, value] of Object.entries(edits.union.identifierGapFills)) {
      survivorSet[`identifiers.${field}`] = value;
      result.identifiersFilled[field] = (result.identifiersFilled[field] ?? 0) + 1;
    }
    for (const [field, value] of Object.entries(edits.union.profileGapFills)) {
      survivorSet[`profile.${field}`] = value;
      result.profileFieldsFilled[field] = (result.profileFieldsFilled[field] ?? 0) + 1;
    }
    const survivorUpdate: Document = {};
    if (Object.keys(survivorSet).length > 0) survivorUpdate.$set = survivorSet;
    if (edits.union.profileLinksToAppend.length > 0) {
      survivorUpdate.$push = { profileLinks: { $each: edits.union.profileLinksToAppend } };
    }
    if (Object.keys(survivorUpdate).length > 0) {
      await researchers.updateOne({ _id: merge.survivorResearcherId }, survivorUpdate);
      result.profileLinksAppended += edits.union.profileLinksToAppend.length;
    }

    if (edits.repointEdgeIds.length > 0) {
      const repointed = await roleAssignments.updateMany(
        { _id: { $in: edits.repointEdgeIds }, personId: merge.loserResearcherId },
        { $set: { personId: merge.survivorResearcherId } },
      );
      result.edgesRepointed += repointed.matchedCount;
    }
    if (edits.archiveRedundantEdgeIds.length > 0) {
      const redundant = await roleAssignments.updateMany(
        { _id: { $in: edits.archiveRedundantEdgeIds }, personId: merge.loserResearcherId },
        { $set: { archived: true } },
      );
      result.edgesArchivedRedundant += redundant.matchedCount;
    }
    for (const id of edits.touchedEntityIds) touched.add(id);
  }
  result.touchedEntityIds = [...touched].sort();
  return result;
}

export async function summarizeTwinResearcherMergeEdits(
  db: Db,
  merges: readonly TwinResearcherMerge[],
): Promise<{
  edgesToRepoint: number;
  edgesToArchiveRedundant: number;
  entitiesToRegate: number;
  identifiersToFill: Record<string, number>;
  profileLinksToAppend: number;
  loserLocalPartNetidsToClear: number;
}> {
  const summary = {
    edgesToRepoint: 0,
    edgesToArchiveRedundant: 0,
    entitiesToRegate: 0,
    identifiersToFill: {} as Record<string, number>,
    profileLinksToAppend: 0,
    loserLocalPartNetidsToClear: 0,
  };
  const entities = new Set<string>();
  for (const merge of merges) {
    const edits = await planTwinResearcherMergeEdits(db, merge);
    if (!edits) continue;
    summary.edgesToRepoint += edits.repointEdgeIds.length;
    summary.edgesToArchiveRedundant += edits.archiveRedundantEdgeIds.length;
    summary.profileLinksToAppend += edits.union.profileLinksToAppend.length;
    for (const field of Object.keys(edits.union.identifierGapFills)) {
      summary.identifiersToFill[field] = (summary.identifiersToFill[field] ?? 0) + 1;
    }
    if (
      edits.loserUnsets.includes('identifiers.netid') &&
      edits.union.identifierGapFills.netid === undefined
    ) {
      summary.loserLocalPartNetidsToClear += 1;
    }
    for (const id of edits.touchedEntityIds) entities.add(id);
  }
  summary.entitiesToRegate = entities.size;
  return summary;
}
