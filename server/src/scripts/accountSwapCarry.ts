import type { Db, Document, ObjectId } from 'mongodb';

/**
 * Target accounts a whole-collection `accounts` swap must carry: the Beta-to-
 * Production promotion and both Development/Beta syncs (#4091, #4130).
 *
 * Beta's accounts are the researcher identity spine, pseudonymized mirrors, and
 * since #4139 Beta's own logins. None of them is a Production login, so a plain
 * whole-collection swap deletes every account a real Production login created
 * while `research_plans`, which is not promoted, keeps pointing at the deleted
 * `_id` (#4091). An account carries login evidence when it has `lastLoginAt` or
 * owns a research plan. Read against Production that makes it authoritative and
 * carried; read against Beta it marks a Beta login the promotion must leave in
 * Beta rather than write into Production (#4244).
 *
 * The target's `_id` always survives, because private rows reference it:
 * where the source holds the same netid under another `_id`, the source row is
 * re-keyed to the target `_id` and every reference to the source `_id` is
 * rewritten, replacing any pseudonym the source holds under the target `_id`.
 * Otherwise, where the source holds the same `_id` under another netid, it is a
 * pseudonym the mirror minted for this very login, so the target row replaces it.
 */
const CARRIED_ACCOUNT_LOGIN_FIELDS = ['lastLoginAt', 'profile'] as const;

export const ACCOUNT_ID_REFERENCE_FIELDS: ReadonlyArray<{ collection: string; field: string }> = [
  { collection: 'researchers', field: 'accountId' },
  { collection: 'research_entities', field: 'studentVisibilityReviewedByAccountId' },
  { collection: 'fellowships', field: 'studentVisibilityReviewedByAccountId' },
  { collection: 'research_plans', field: 'accountId' },
];

export interface AccountCarryPlan {
  refreshes: Array<{ _id: ObjectId; set: Document }>;
  restores: Document[];
  rekeys: Array<{ fromId: ObjectId; document: Document; replacesPseudonym: boolean }>;
  inserts: Document[];
}

const idKey = (value: unknown): string => String(value);

function loginFields(account: Document): Document {
  const fields: Document = {};
  for (const field of CARRIED_ACCOUNT_LOGIN_FIELDS) {
    if (account[field] !== undefined) fields[field] = account[field];
  }
  return fields;
}

function isProductionLoginAccount(account: Document, planOwnerIds: ReadonlySet<string>): boolean {
  return account.lastLoginAt != null || planOwnerIds.has(idKey(account._id));
}

export function planAccountCarry(args: {
  productionAccounts: readonly Document[];
  promotedAccounts: readonly Document[];
  planOwnerIds: ReadonlySet<string>;
}): AccountCarryPlan {
  const promotedById = new Map(args.promotedAccounts.map((row) => [idKey(row._id), row]));
  const promotedByNetid = new Map(args.promotedAccounts.map((row) => [row.netid, row]));
  const plan: AccountCarryPlan = { refreshes: [], restores: [], rekeys: [], inserts: [] };

  for (const account of args.productionAccounts) {
    if (!isProductionLoginAccount(account, args.planOwnerIds)) continue;
    const sameId = promotedById.get(idKey(account._id));
    if (sameId && sameId.netid === account.netid) {
      const set = loginFields(account);
      if (Object.keys(set).length > 0) plan.refreshes.push({ _id: sameId._id, set });
      continue;
    }
    const sameNetid = promotedByNetid.get(account.netid);
    if (sameNetid) {
      plan.rekeys.push({
        fromId: sameNetid._id,
        document: { ...sameNetid, ...loginFields(account), _id: account._id },
        replacesPseudonym: sameId !== undefined,
      });
      continue;
    }
    if (sameId) {
      plan.restores.push(account);
      continue;
    }
    plan.inserts.push(account);
  }
  return plan;
}

export async function loadAccountCarryPlan(args: {
  targetDb: Db;
  targetAccountsCollection: string;
  loadPromotedAccounts: () => Promise<Document[]>;
}): Promise<AccountCarryPlan> {
  const planOwnerIds = new Set(
    (await args.targetDb.collection('research_plans').distinct('accountId')).map(idKey),
  );
  return planAccountCarry({
    productionAccounts: await args.targetDb
      .collection(args.targetAccountsCollection)
      .find({})
      .toArray(),
    promotedAccounts: await args.loadPromotedAccounts(),
    planOwnerIds,
  });
}

export interface AccountCarrySummary {
  refreshed: number;
  restored: number;
  rekeyed: number;
  merged: number;
  inserted: number;
}

export function summarizeAccountCarry(carry: AccountCarryPlan): AccountCarrySummary {
  return {
    refreshed: carry.refreshes.length,
    restored: carry.restores.length,
    rekeyed: carry.rekeys.length,
    merged: carry.rekeys.filter((rekey) => rekey.replacesPseudonym).length,
    inserted: carry.inserts.length,
  };
}

export function accountCountChange(summary: AccountCarrySummary): number {
  return summary.inserted - summary.merged;
}

export async function applyAccountCarry(targetDb: Db, plan: AccountCarryPlan): Promise<void> {
  const accounts = targetDb.collection('accounts');
  for (const refresh of plan.refreshes) {
    await accounts.updateOne({ _id: refresh._id }, { $set: refresh.set });
  }
  for (const restore of plan.restores) {
    await accounts.replaceOne({ _id: restore._id }, restore);
  }
  for (const rekey of plan.rekeys) {
    await accounts.deleteOne({ _id: rekey.fromId });
    await accounts.replaceOne({ _id: rekey.document._id }, rekey.document, { upsert: true });
    for (const { collection, field } of ACCOUNT_ID_REFERENCE_FIELDS) {
      await targetDb
        .collection(collection)
        .updateMany({ [field]: rekey.fromId }, { $set: { [field]: rekey.document._id } });
    }
  }
  if (plan.inserts.length > 0) {
    await accounts.insertMany(plan.inserts, { ordered: true });
  }
}
