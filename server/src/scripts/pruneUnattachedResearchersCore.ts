export interface PrunableResearcher {
  id: string;
  accountId?: string;
  displayName?: string;
  hasDedupedInto: boolean;
}

export interface ResearcherPrunePlanInput {
  researchers: PrunableResearcher[];
  rolePersonIds: Iterable<string>;
  dedupeTargetIds: Iterable<string>;
  accountsWithLogin: Iterable<string>;
}

export interface ResearcherPrunePlan {
  scanned: number;
  attached: number;
  dedupeInvolved: number;
  researcherIdsToDelete: string[];
  accountIdsToDelete: string[];
  accountsRetainedForLogin: number;
  sample: { id: string; displayName: string; accountId?: string }[];
}

export function planUnattachedResearcherPrune(input: ResearcherPrunePlanInput): ResearcherPrunePlan {
  const rolePersonIds = new Set(input.rolePersonIds);
  const dedupeTargetIds = new Set(input.dedupeTargetIds);
  const accountsWithLogin = new Set(input.accountsWithLogin);

  const isAttached = (r: PrunableResearcher) => rolePersonIds.has(r.id);
  const isDedupeInvolved = (r: PrunableResearcher) => dedupeTargetIds.has(r.id) || r.hasDedupedInto;

  const toDelete = input.researchers.filter((r) => !isAttached(r) && !isDedupeInvolved(r));
  const deleteIds = new Set(toDelete.map((r) => r.id));

  const survivingAccountIds = new Set(
    input.researchers
      .filter((r) => !deleteIds.has(r.id) && r.accountId)
      .map((r) => r.accountId as string),
  );

  const accountIdsToDelete: string[] = [];
  let accountsRetainedForLogin = 0;
  const seenAccounts = new Set<string>();
  for (const r of toDelete) {
    if (!r.accountId || seenAccounts.has(r.accountId)) continue;
    seenAccounts.add(r.accountId);
    if (survivingAccountIds.has(r.accountId)) continue;
    if (accountsWithLogin.has(r.accountId)) {
      accountsRetainedForLogin += 1;
      continue;
    }
    accountIdsToDelete.push(r.accountId);
  }

  return {
    scanned: input.researchers.length,
    attached: input.researchers.filter(isAttached).length,
    dedupeInvolved: input.researchers.filter((r) => !isAttached(r) && isDedupeInvolved(r)).length,
    researcherIdsToDelete: [...deleteIds],
    accountIdsToDelete,
    accountsRetainedForLogin,
    sample: toDelete.slice(0, 50).map((r) => ({
      id: r.id,
      displayName: r.displayName || '',
      accountId: r.accountId,
    })),
  };
}
