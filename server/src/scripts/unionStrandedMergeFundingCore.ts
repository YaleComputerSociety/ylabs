/**
 * Fields whose observation is a complete restatement rather than a contribution to a set.
 *
 * A list is not a set, and the emitting lane decides which it is. The funding lanes emit
 * `recentGrants` as one full array, sorted by start date and capped at a top N, so an
 * award that stops appearing has left the window rather than gone missing. Unioning two
 * such statements manufactures a list no source made, which is what this module used to
 * do (#3242).
 *
 * Neither the schema type nor the shape of the value tells you which kind a field is,
 * so the classification is declared here and asserted by `assertNotACompleteRestatement`.
 * A future caller that assumes an array is a set fails loudly instead of quietly
 * resurrecting a withdrawn value.
 */
export const COMPLETE_RESTATEMENT_FIELDS = [
  'recentGrants',
  'recentGrantCount',
  'fundingAgencies',
] as const;

export function assertNotACompleteRestatement(field: string): void {
  if ((COMPLETE_RESTATEMENT_FIELDS as readonly string[]).includes(field)) {
    throw new Error(
      `${field} is a complete restatement, not a set: unioning it writes values the emitting lane withdrew (#3242).`,
    );
  }
}

const awardIdentity = (award: unknown): string => {
  const record = (award && typeof award === 'object' ? award : {}) as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  return id ? id.toLowerCase() : `json:${JSON.stringify(record)}`;
};

export interface UnbackedFundingRevocation {
  recentGrants: unknown[];
  recentGrantCount: number;
  fundingAgencies: string[];
  revokedAwards: number;
}

/**
 * The award records a row stores that no live observation on its key asserts, and the
 * funding values left once they are dropped.
 *
 * This is a retraction rather than a resolve, because the engine cannot perform it. A
 * materialize pass writes only the fields it holds observations for, so a row with no
 * funding observation at all has nothing contesting its stored awards: measured on
 * Development, 17 of 18 rows carrying an unbacked award held zero funding observations
 * and their `plannedSet` omitted the field entirely. A hand-written value with no
 * evidence behind it is therefore more durable than one with evidence, not less, and
 * re-materializing cannot clear it (#3242).
 */
export function planUnbackedFundingRevocation(
  stored: StrandedFundingEntity,
  observedAwardIds: ReadonlySet<string>,
): UnbackedFundingRevocation | null {
  const awards = Array.isArray(stored.recentGrants) ? stored.recentGrants : [];
  if (awards.length === 0) return null;
  const kept = awards.filter((award) => observedAwardIds.has(awardIdentity(award)));
  if (kept.length === awards.length) return null;

  const keptAgencies = new Set(
    kept
      .map((award) => (award && typeof award === 'object' ? (award as any).agency : undefined))
      .filter((agency): agency is string => typeof agency === 'string' && agency.trim() !== '')
      .map((agency) => agency.trim()),
  );
  const storedAgencies = Array.isArray(stored.fundingAgencies) ? stored.fundingAgencies : [];

  return {
    recentGrants: kept,
    recentGrantCount: kept.length,
    // An agency survives only while an award still names it, so the agency list narrows
    // with the awards rather than outliving them and leaving a funding pill with nothing
    // under it.
    fundingAgencies: storedAgencies.filter((agency) => keptAgencies.has(String(agency).trim())),
    revokedAwards: awards.length - kept.length,
  };
}

export interface StrandedFundingEntity {
  recentGrants?: unknown[];
  recentGrantCount?: number;
  fundingAgencies?: string[];
}

/**
 * The union arm this module used to carry is gone. It unioned `recentGrants` across a
 * merge's survivor and its archived duplicates, and because that field is a complete
 * restatement the union wrote awards the emitting lane had withdrawn from its window,
 * onto rows students read. `assertNotACompleteRestatement` above is what stands in its
 * place, so a future caller cannot reintroduce it by assuming an array is a set (#3242).
 */
