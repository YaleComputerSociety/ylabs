import { mergedGrantEvidenceFromEntities } from './researchEntityPiDedupeCore';

export interface StrandedFundingEntity {
  recentGrants?: unknown[];
  recentGrantCount?: number;
  fundingAgencies?: string[];
}

export interface StrandedFundingUnionPlan {
  recentGrants: unknown[];
  recentGrantCount: number;
  fundingAgencies: string[];
  addedGrants: number;
  addedAgencies: number;
}

const grantIdentity = (grant: unknown): string => {
  const record = (grant && typeof grant === 'object' ? grant : {}) as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  return id ? `id:${id.toLowerCase()}` : `record:${JSON.stringify(record)}`;
};

const agencyKeys = (entity: StrandedFundingEntity): Set<string> =>
  new Set(
    (Array.isArray(entity.fundingAgencies) ? entity.fundingAgencies : [])
      .filter((agency): agency is string => typeof agency === 'string')
      .map((agency) => agency.trim().toLowerCase())
      .filter(Boolean),
  );

/**
 * The funding evidence a merge should have carried to its survivor, or `null` when
 * the survivor already holds all of it.
 *
 * The union itself is `mergedGrantEvidenceFromEntities`, the same helper the dedupe
 * lane uses when it performs the merge, so a completed merge and a repaired one
 * agree on the result rather than converging on two different unions (#1928).
 *
 * `recentGrantCount` is the size of the union rather than the sum of the stored
 * counts. The sum is what the merge writes, and summing stored counts is not
 * idempotent: a second pass over an already-repaired survivor would add the
 * duplicate's count to a total that already includes it.
 */
export function planStrandedFundingUnion(
  canonical: StrandedFundingEntity,
  duplicates: StrandedFundingEntity[],
): StrandedFundingUnionPlan | null {
  if (duplicates.length === 0) return null;

  const merged = mergedGrantEvidenceFromEntities([canonical, ...duplicates] as any);
  const canonicalGrantKeys = new Set(
    (Array.isArray(canonical.recentGrants) ? canonical.recentGrants : []).map(grantIdentity),
  );
  const canonicalAgencies = agencyKeys(canonical);

  const addedGrants = merged.mergedRecentGrants.filter(
    (grant) => !canonicalGrantKeys.has(grantIdentity(grant)),
  ).length;
  const addedAgencies = merged.mergedFundingAgencies.filter(
    (agency) => !canonicalAgencies.has(agency.trim().toLowerCase()),
  ).length;

  if (addedGrants === 0 && addedAgencies === 0) return null;

  return {
    recentGrants: merged.mergedRecentGrants,
    recentGrantCount: merged.mergedRecentGrants.length,
    fundingAgencies: merged.mergedFundingAgencies,
    addedGrants,
    addedAgencies,
  };
}

/**
 * A union must never drop evidence the survivor already serves. The dedupe lane
 * replaces `recentGrants` outright, so a repair built on the same helper has to
 * prove the replacement is a superset before it writes.
 */
export function unionKeepsEveryCanonicalGrant(
  canonical: StrandedFundingEntity,
  plan: StrandedFundingUnionPlan,
): boolean {
  const planned = new Set(plan.recentGrants.map(grantIdentity));
  const canonicalGrants = Array.isArray(canonical.recentGrants) ? canonical.recentGrants : [];
  if (!canonicalGrants.every((grant) => planned.has(grantIdentity(grant)))) return false;
  const plannedAgencies = new Set(
    plan.fundingAgencies.map((agency) => agency.trim().toLowerCase()),
  );
  return [...agencyKeys(canonical)].every((agency) => plannedAgencies.has(agency));
}
