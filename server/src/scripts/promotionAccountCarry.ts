import type { Collection, Db, Document, ObjectId } from 'mongodb';

/**
 * Production accounts a promotion must carry across its `accounts` swap.
 *
 * Beta's accounts are the researcher identity spine plus pseudonymized mirrors
 * and never carry a Production login, so a plain whole-collection swap deletes
 * every account a real Production login created while `research_plans`, which
 * is not promoted, keeps pointing at the deleted `_id` (#4091). An account is a
 * Production login when it carries `lastLoginAt` or owns a research plan.
 *
 * The Production `_id` always survives, because private rows reference it:
 * where Beta holds the same netid under another `_id`, the Beta row is re-keyed
 * to the Production `_id` and every reference to the Beta `_id` is rewritten.
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
  rekeys: Array<{ fromId: ObjectId; document: Document }>;
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
  const plan: AccountCarryPlan = { refreshes: [], rekeys: [], inserts: [] };

  for (const account of args.productionAccounts) {
    if (!isProductionLoginAccount(account, args.planOwnerIds)) continue;
    const sameId = promotedById.get(idKey(account._id));
    if (sameId) {
      const set = loginFields(account);
      if (Object.keys(set).length > 0) plan.refreshes.push({ _id: sameId._id, set });
      continue;
    }
    const sameNetid = promotedByNetid.get(account.netid);
    if (sameNetid) {
      plan.rekeys.push({
        fromId: sameNetid._id,
        document: { ...sameNetid, ...loginFields(account), _id: account._id },
      });
      continue;
    }
    plan.inserts.push(account);
  }
  return plan;
}

export async function loadAccountCarryPlan(args: {
  productionDb: Db;
  productionAccountsCollection: string;
  promotedAccounts: Collection;
  promotedAccountFilter: Document;
}): Promise<AccountCarryPlan> {
  const planOwnerIds = new Set(
    (await args.productionDb.collection('research_plans').distinct('accountId')).map(idKey),
  );
  return planAccountCarry({
    productionAccounts: await args.productionDb
      .collection(args.productionAccountsCollection)
      .find({})
      .toArray(),
    promotedAccounts: await args.promotedAccounts.find(args.promotedAccountFilter).toArray(),
    planOwnerIds,
  });
}

export async function applyAccountCarry(targetDb: Db, plan: AccountCarryPlan): Promise<void> {
  const accounts = targetDb.collection('accounts');
  for (const refresh of plan.refreshes) {
    await accounts.updateOne({ _id: refresh._id }, { $set: refresh.set });
  }
  for (const rekey of plan.rekeys) {
    await accounts.deleteOne({ _id: rekey.fromId });
    await accounts.insertOne(rekey.document);
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
