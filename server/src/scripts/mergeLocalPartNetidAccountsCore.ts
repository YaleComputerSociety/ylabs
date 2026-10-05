import type { Db, Document, ObjectId } from 'mongodb';
import type { AccountArchivedReason } from '../models/account';
import { looksLikeYaleNetid } from '../utils/yaleNetid';
import { ACCOUNT_ID_REFERENCE_FIELDS } from './accountSwapCarry';

export const LOCAL_PART_TWIN_ARCHIVED_REASON: AccountArchivedReason =
  'merged-local-part-netid-twin';

export const LOCAL_PART_MERGE_REFUSAL_REASONS = [
  'off-shape-pair',
  'both-accounts-link-a-researcher',
  'local-part-account-has-login',
  'researcher-identifier-holds-local-part',
  'netid-keyed-references',
] as const;
export type LocalPartMergeRefusalReason = (typeof LOCAL_PART_MERGE_REFUSAL_REASONS)[number];

/**
 * Rows keyed by a netid string rather than an account id. A local-part account cannot sign
 * in, so none should exist; if one does it is audit or analytics history, which this repair
 * does not rewrite, so the pair is reported instead.
 */
export const NETID_KEYED_REFERENCE_FIELDS: ReadonlyArray<{ collection: string; field: string }> = [
  { collection: 'admin_grants', field: 'netid' },
  { collection: 'admin_grants', field: 'grantedBy' },
  { collection: 'admin_grants', field: 'revokedBy' },
  { collection: 'admin_grants', field: 'history.actorNetid' },
  { collection: 'admin_audit_events', field: 'actorNetid' },
  { collection: 'analytics_events', field: 'netid' },
  { collection: 'entitycorrectionreports', field: 'reporter.netId' },
  { collection: 'entitycorrectionreports', field: 'reviewedBy' },
  { collection: 'entitycorrectionreports', field: 'reviewHistory.reviewedBy' },
];

export interface LocalPartAccountMerge {
  localPartAccountId: ObjectId;
  netidAccountId: ObjectId;
}

export interface LocalPartMergePlan {
  sharedEmailGroups: number;
  merges: LocalPartAccountMerge[];
  refusals: Record<LocalPartMergeRefusalReason, number>;
  localPartAccountsWithoutTwin: number;
}

export interface LocalPartMergeApplyResult {
  merged: number;
  referencesRepointed: Record<string, number>;
  researchPlansKeptOnArchivedAccount: number;
}

const referenceKey = ({ collection, field }: { collection: string; field: string }) =>
  `${collection}.${field}`;

const normalizedEmail = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const emailLocalPart = (email: string): string => email.split('@')[0] ?? '';

export function isLocalPartAccount(account: { netid?: unknown; email?: unknown }): boolean {
  const netid = typeof account.netid === 'string' ? account.netid : '';
  const email = normalizedEmail(account.email);
  return (
    Boolean(netid) &&
    netid === emailLocalPart(email) &&
    email.includes('@') &&
    !looksLikeYaleNetid(netid)
  );
}

async function collectionExists(db: Db, name: string): Promise<boolean> {
  return db.listCollections({ name }, { nameOnly: true }).hasNext();
}

async function countWhere(db: Db, collection: string, filter: Document): Promise<number> {
  if (!(await collectionExists(db, collection))) return 0;
  return db.collection(collection).countDocuments(filter);
}

async function netidKeyedReferenceCount(db: Db, netid: string): Promise<number> {
  let total = 0;
  for (const { collection, field } of NETID_KEYED_REFERENCE_FIELDS) {
    total += await countWhere(db, collection, { [field]: netid });
  }
  return total;
}

function emptyRefusals(): Record<LocalPartMergeRefusalReason, number> {
  return Object.fromEntries(
    LOCAL_PART_MERGE_REFUSAL_REASONS.map((reason) => [reason, 0]),
  ) as Record<LocalPartMergeRefusalReason, number>;
}

async function refusalFor(
  db: Db,
  localPart: Document,
  netidAccount: Document,
): Promise<LocalPartMergeRefusalReason | undefined> {
  const researchers = db.collection('researchers');
  const localPartHolds = await researchers.countDocuments({ accountId: localPart._id });
  const netidHolds = await researchers.countDocuments({ accountId: netidAccount._id });
  if (localPartHolds > 0 && netidHolds > 0) return 'both-accounts-link-a-researcher';
  if (localPart.lastLoginAt != null) return 'local-part-account-has-login';
  if ((await researchers.countDocuments({ 'identifiers.netid': localPart.netid })) > 0) {
    return 'researcher-identifier-holds-local-part';
  }
  if ((await netidKeyedReferenceCount(db, localPart.netid)) > 0) return 'netid-keyed-references';
  return undefined;
}

export async function planLocalPartNetidMerges(db: Db): Promise<LocalPartMergePlan> {
  const groups = await db
    .collection('accounts')
    .aggregate<{ _id: string; accounts: Document[] }>([
      { $match: { archived: { $ne: true } } },
      {
        $group: {
          _id: { $trim: { input: { $toLower: { $ifNull: ['$email', ''] } } } },
          accounts: {
            $push: { _id: '$_id', netid: '$netid', email: '$email', lastLoginAt: '$lastLoginAt' },
          },
        },
      },
      { $match: { _id: { $ne: '' } } },
    ])
    .toArray();

  const plan: LocalPartMergePlan = {
    sharedEmailGroups: 0,
    merges: [],
    refusals: emptyRefusals(),
    localPartAccountsWithoutTwin: 0,
  };

  for (const group of groups) {
    if (group.accounts.length < 2) {
      if (group.accounts.some(isLocalPartAccount)) plan.localPartAccountsWithoutTwin += 1;
      continue;
    }
    plan.sharedEmailGroups += 1;
    const localParts = group.accounts.filter(isLocalPartAccount);
    const netidAccounts = group.accounts.filter((account) => looksLikeYaleNetid(account.netid));
    if (group.accounts.length !== 2 || localParts.length !== 1 || netidAccounts.length !== 1) {
      plan.refusals['off-shape-pair'] += 1;
      continue;
    }
    const [localPart] = localParts;
    const [netidAccount] = netidAccounts;
    const refusal = await refusalFor(db, localPart, netidAccount);
    if (refusal) {
      plan.refusals[refusal] += 1;
      continue;
    }
    plan.merges.push({
      localPartAccountId: localPart._id as ObjectId,
      netidAccountId: netidAccount._id as ObjectId,
    });
  }
  return plan;
}

async function repointResearchPlans(
  db: Db,
  merge: LocalPartAccountMerge,
): Promise<{ repointed: number; kept: number }> {
  if (!(await collectionExists(db, 'research_plans'))) return { repointed: 0, kept: 0 };
  const plans = db.collection('research_plans');
  const held = await plans
    .find({ accountId: merge.localPartAccountId }, { projection: { target: 1 } })
    .toArray();
  let repointed = 0;
  let kept = 0;
  for (const plan of held) {
    const twinHoldsTarget = await plans.countDocuments({
      accountId: merge.netidAccountId,
      'target.kind': plan.target?.kind,
      'target.id': plan.target?.id,
    });
    if (twinHoldsTarget > 0) {
      kept += 1;
      continue;
    }
    const result = await plans.updateOne(
      { _id: plan._id, accountId: merge.localPartAccountId },
      { $set: { accountId: merge.netidAccountId } },
    );
    repointed += result.matchedCount;
  }
  return { repointed, kept };
}

export async function applyLocalPartNetidMerges(
  db: Db,
  merges: readonly LocalPartAccountMerge[],
  now: Date = new Date(),
): Promise<LocalPartMergeApplyResult> {
  const result: LocalPartMergeApplyResult = {
    merged: 0,
    referencesRepointed: Object.fromEntries(
      ACCOUNT_ID_REFERENCE_FIELDS.map((reference) => [referenceKey(reference), 0]),
    ),
    researchPlansKeptOnArchivedAccount: 0,
  };
  for (const merge of merges) {
    for (const reference of ACCOUNT_ID_REFERENCE_FIELDS) {
      if (reference.collection === 'research_plans') {
        const plans = await repointResearchPlans(db, merge);
        result.referencesRepointed[referenceKey(reference)] += plans.repointed;
        result.researchPlansKeptOnArchivedAccount += plans.kept;
        continue;
      }
      if (!(await collectionExists(db, reference.collection))) continue;
      const updated = await db
        .collection(reference.collection)
        .updateMany(
          { [reference.field]: merge.localPartAccountId },
          { $set: { [reference.field]: merge.netidAccountId } },
        );
      result.referencesRepointed[referenceKey(reference)] += updated.matchedCount;
    }
    const archived = await db.collection('accounts').updateOne(
      { _id: merge.localPartAccountId, archived: { $ne: true } },
      {
        $set: {
          archived: true,
          archivedReason: LOCAL_PART_TWIN_ARCHIVED_REASON,
          archivedAt: now,
          mergedIntoAccountId: merge.netidAccountId,
          updatedAt: now,
        },
      },
    );
    result.merged += archived.matchedCount;
  }
  return result;
}

export async function countReferencesToRepoint(
  db: Db,
  merges: readonly LocalPartAccountMerge[],
): Promise<Record<string, number>> {
  const localPartIds = merges.map((merge) => merge.localPartAccountId);
  const counts: Record<string, number> = {};
  for (const reference of ACCOUNT_ID_REFERENCE_FIELDS) {
    counts[referenceKey(reference)] = await countWhere(db, reference.collection, {
      [reference.field]: { $in: localPartIds },
    });
  }
  return counts;
}

export function projectedSharedEmailGroupsAfterApply(plan: LocalPartMergePlan): number {
  return plan.sharedEmailGroups - plan.merges.length;
}
