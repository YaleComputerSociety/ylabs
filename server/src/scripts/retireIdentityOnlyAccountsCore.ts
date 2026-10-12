import type { Db, Document, ObjectId } from 'mongodb';

/**
 * Which accounts are identity records nobody ever signed into, and whether each can go (#5000).
 *
 * An account is retirable only when it carries no login evidence (`lastLoginAt`), owns no
 * research plan, and is named by no reviewer stamp and by no admin grant. Before the account
 * goes, its netid and email are copied onto every linked researcher that lacks them, archived
 * ones included, so removing it loses no identity a reader or a later restore needs; a linked
 * researcher holding a different value, or a netid another researcher holds, holds the account.
 */
export const REVIEWER_STAMP_REFERENCES = [
  { collection: 'research_entities', field: 'studentVisibilityReviewedByAccountId' },
  { collection: 'fellowships', field: 'studentVisibilityReviewedByAccountId' },
] as const;

export type RetirementHold =
  | 'research-plan'
  | 'reviewer-stamp'
  | 'admin-grant'
  | 'researcher-holds-another-netid'
  | 'netid-held-by-another-researcher'
  | 'researcher-holds-another-email';

export interface IdentityCopy {
  researcherId: ObjectId;
  set: { netid?: string; email?: string };
}

export interface IdentityOnlyAccountPlan {
  candidates: number;
  retirable: Array<{ accountId: ObjectId; linkedResearcherIds: ObjectId[] }>;
  identityCopies: IdentityCopy[];
  held: Record<RetirementHold, number>;
  loginAccountsKept: number;
}

const normalized = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const PLACEHOLDER_EMAIL_DOMAIN = '@example.invalid';

export async function planIdentityOnlyAccountRetirement(db: Db): Promise<IdentityOnlyAccountPlan> {
  const accounts = db.collection('accounts');
  const loginAccountsKept = await accounts.countDocuments({ lastLoginAt: { $ne: null } });
  const candidates = await accounts
    .find({ lastLoginAt: null }, { projection: { _id: 1, netid: 1, email: 1 } })
    .toArray();
  const candidateIds = candidates.map((account) => account._id);

  const planOwners = new Set(
    (
      await db
        .collection('research_plans')
        .distinct('accountId', { accountId: { $in: candidateIds } })
    ).map(String),
  );
  const reviewers = new Set<string>();
  for (const { collection, field } of REVIEWER_STAMP_REFERENCES) {
    for (const id of await db
      .collection(collection)
      .distinct(field, { [field]: { $in: candidateIds } }))
      reviewers.add(String(id));
  }
  const netidHolders = new Map<string, string>(
    (
      await db
        .collection('researchers')
        .find(
          { 'identifiers.netid': { $exists: true } },
          { projection: { 'identifiers.netid': 1 } },
        )
        .toArray()
    ).map((holder) => [normalized(holder.identifiers.netid), String(holder._id)]),
  );
  const grantedNetids = new Set(
    (await db.collection('admin_grants').distinct('netid')).map((netid) => normalized(netid)),
  );
  const linkedByAccount = new Map<string, Document[]>();
  for (const researcher of await db
    .collection('researchers')
    .find(
      { accountId: { $in: candidateIds } },
      { projection: { _id: 1, accountId: 1, identifiers: 1 } },
    )
    .toArray()) {
    const key = String(researcher.accountId);
    linkedByAccount.set(key, [...(linkedByAccount.get(key) ?? []), researcher]);
  }

  const plan: IdentityOnlyAccountPlan = {
    candidates: candidates.length,
    retirable: [],
    identityCopies: [],
    held: {
      'research-plan': 0,
      'reviewer-stamp': 0,
      'admin-grant': 0,
      'researcher-holds-another-netid': 0,
      'netid-held-by-another-researcher': 0,
      'researcher-holds-another-email': 0,
    },
    loginAccountsKept,
  };
  for (const account of candidates) {
    const key = String(account._id);
    const linked = linkedByAccount.get(key) ?? [];
    const accountNetid = normalized(account.netid);
    const rawEmail = normalized(account.email);
    const accountEmail = rawEmail.endsWith(PLACEHOLDER_EMAIL_DOMAIN) ? '' : rawEmail;
    const copies: IdentityCopy[] = [];
    let hold: RetirementHold | undefined = planOwners.has(key)
      ? 'research-plan'
      : reviewers.has(key)
        ? 'reviewer-stamp'
        : grantedNetids.has(accountNetid)
          ? 'admin-grant'
          : undefined;
    for (const researcher of hold ? [] : linked) {
      const set: IdentityCopy['set'] = {};
      const heldNetid = normalized(researcher.identifiers?.netid);
      const heldEmail = normalized(researcher.identifiers?.email);
      if (heldNetid && accountNetid && heldNetid !== accountNetid)
        hold = 'researcher-holds-another-netid';
      else if (!heldNetid && accountNetid) {
        const holder = netidHolders.get(accountNetid);
        if (holder && holder !== String(researcher._id)) hold = 'netid-held-by-another-researcher';
        else set.netid = accountNetid;
      }
      if (!hold && heldEmail && accountEmail && heldEmail !== accountEmail)
        hold = 'researcher-holds-another-email';
      else if (!hold && !heldEmail && accountEmail) set.email = accountEmail;
      if (hold) break;
      if (set.netid || set.email) copies.push({ researcherId: researcher._id, set });
    }
    if (hold) {
      plan.held[hold] += 1;
      continue;
    }
    for (const copy of copies)
      if (copy.set.netid) netidHolders.set(copy.set.netid, String(copy.researcherId));
    plan.identityCopies.push(...copies);
    plan.retirable.push({
      accountId: account._id,
      linkedResearcherIds: linked.map((researcher) => researcher._id),
    });
  }
  return plan;
}

export interface IdentityOnlyAccountRetirement {
  identityFieldsCopied: number;
  researchersUnlinked: number;
  accountsDeleted: number;
}

export async function applyIdentityOnlyAccountRetirement(
  db: Db,
  plan: IdentityOnlyAccountPlan,
): Promise<IdentityOnlyAccountRetirement> {
  const accountIds = plan.retirable.map((row) => row.accountId);
  if (accountIds.length === 0)
    return { identityFieldsCopied: 0, researchersUnlinked: 0, accountsDeleted: 0 };
  let identityFieldsCopied = 0;
  for (const { researcherId, set } of plan.identityCopies) {
    for (const [field, value] of Object.entries(set)) {
      const copied = await db
        .collection('researchers')
        .updateOne(
          { _id: researcherId, [`identifiers.${field}`]: { $exists: false } },
          { $set: { [`identifiers.${field}`]: value } },
        );
      identityFieldsCopied += copied.modifiedCount;
    }
  }
  const unlinked = await db
    .collection('researchers')
    .updateMany({ accountId: { $in: accountIds } }, { $unset: { accountId: '' } });
  const deleted = await db
    .collection('accounts')
    .deleteMany({ _id: { $in: accountIds }, lastLoginAt: null });
  return {
    identityFieldsCopied,
    researchersUnlinked: unlinked.modifiedCount,
    accountsDeleted: deleted.deletedCount,
  };
}
