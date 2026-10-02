const MS_PER_DAY = 86_400_000;

export const CURRENT_FUNDING_FIELDS = [
  'recentGrants',
  'recentGrantCount',
  'fundingAgencies',
] as const;

export type CurrentFundingField = (typeof CURRENT_FUNDING_FIELDS)[number];

export type ServedCurrentFunding = Partial<Record<CurrentFundingField, unknown>>;

const CURRENT_FUNDING_FIELD_SET: ReadonlySet<string> = new Set(CURRENT_FUNDING_FIELDS);

export function isCurrentFundingField(field: string): field is CurrentFundingField {
  return CURRENT_FUNDING_FIELD_SET.has(field);
}

function awardEndDayHasPassed(award: unknown, now: number): boolean {
  if (!award || typeof award !== 'object') return false;
  const endDate = (award as { endDate?: unknown }).endDate;
  if (endDate === undefined || endDate === null || endDate === '') return false;
  const endTime = new Date(endDate as string | number | Date).getTime();
  return Number.isFinite(endTime) && endTime + MS_PER_DAY <= now;
}

function agencyKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function awardAgencyKey(award: unknown): string {
  return award && typeof award === 'object'
    ? agencyKey((award as { agency?: unknown }).agency)
    : '';
}

function agenciesBackedByRunningAwards(
  agencies: unknown,
  storedAwards: readonly unknown[],
  runningAwards: readonly unknown[],
): unknown {
  if (!Array.isArray(agencies)) return agencies;
  const listedAgencyKeys = new Set(agencies.map(agencyKey).filter(Boolean));
  const agencyKeysNamedByAnAward = new Set(
    storedAwards.map(awardAgencyKey).filter((key) => listedAgencyKeys.has(key)),
  );
  const runningAgencyKeys = new Set(runningAwards.map(awardAgencyKey));
  const aRunningAwardNamesNoListedAgency = runningAwards.some(
    (award) => !listedAgencyKeys.has(awardAgencyKey(award)),
  );
  return agencies.filter((agency) => {
    const key = agencyKey(agency);
    if (!key) return false;
    return agencyKeysNamedByAnAward.has(key)
      ? runningAgencyKeys.has(key)
      : aRunningAwardNamesNoListedAgency;
  });
}

function awardIdentity(award: unknown): string {
  const id = award && typeof award === 'object' ? (award as { id?: unknown }).id : undefined;
  return typeof id === 'string' && id.trim()
    ? `id:${id.trim().toLowerCase()}`
    : `record:${JSON.stringify(award)}`;
}

function distinctAwards(...awardLists: readonly (readonly unknown[])[]): unknown[] {
  const awards = new Map<string, unknown>();
  for (const award of awardLists.flat()) {
    const identity = awardIdentity(award);
    if (!awards.has(identity)) awards.set(identity, award);
  }
  return [...awards.values()];
}

function periodsCoveringEveryAward(group: Record<string, unknown>): unknown[] | undefined {
  const periods = group.recentGrantPeriods;
  if (!Array.isArray(periods) || periods.length === 0) return undefined;
  return periods.length === group.recentGrantCount ? periods : undefined;
}

function servedFromDatedAwards(
  group: Record<string, unknown>,
  storedAwards: readonly unknown[],
  periods: readonly unknown[],
  now: number,
): ServedCurrentFunding {
  const evidenceAwards = distinctAwards(periods, storedAwards);
  const runningEvidence = evidenceAwards.filter((award) => !awardEndDayHasPassed(award, now));
  const runningAwards = storedAwards.filter((award) => !awardEndDayHasPassed(award, now));
  if (runningEvidence.length === 0) return { recentGrants: [] };
  const anAwardEnded = runningEvidence.length < evidenceAwards.length;
  return {
    recentGrants: runningAwards.length === storedAwards.length ? group.recentGrants : runningAwards,
    recentGrantCount: runningEvidence.length,
    fundingAgencies: anAwardEnded
      ? agenciesBackedByRunningAwards(group.fundingAgencies, evidenceAwards, runningEvidence)
      : group.fundingAgencies,
  };
}

export function servedCurrentFunding(
  group: Record<string, unknown>,
  now: number = Date.now(),
): ServedCurrentFunding {
  const stored: ServedCurrentFunding = {
    recentGrants: group.recentGrants,
    recentGrantCount: group.recentGrantCount,
    fundingAgencies: group.fundingAgencies,
  };
  const storedAwards = group.recentGrants;
  if (!Array.isArray(storedAwards)) return stored;
  const periods = periodsCoveringEveryAward(group);
  if (periods) return servedFromDatedAwards(group, storedAwards, periods, now);
  const runningAwards = storedAwards.filter((award) => !awardEndDayHasPassed(award, now));
  if (runningAwards.length === storedAwards.length) return stored;
  if (runningAwards.length === 0) return { recentGrants: [] };
  const storedListHoldsEveryAward =
    typeof group.recentGrantCount === 'number' && group.recentGrantCount <= storedAwards.length;
  return {
    recentGrants: runningAwards,
    ...(storedListHoldsEveryAward ? { recentGrantCount: runningAwards.length } : {}),
    fundingAgencies: agenciesBackedByRunningAwards(
      group.fundingAgencies,
      storedAwards,
      runningAwards,
    ),
  };
}
