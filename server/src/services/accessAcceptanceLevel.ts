import { accessSignalTypes } from '../models/researchAccessTypes';

export type AccessAcceptanceLevel = 'verified' | 'likely' | 'none';

export const ACCESS_ACCEPTANCE_LEVELS: readonly AccessAcceptanceLevel[] = [
  'verified',
  'likely',
  'none',
];

export const ACCEPTANCE_VERIFIED_CONFIDENCE_FLOOR = 0.7;

export const NEGATIVE_ACCESS_SIGNAL_TYPES: ReadonlySet<string> = new Set([
  'NOT_CURRENTLY_AVAILABLE',
  'NO_EVIDENCE',
]);

export const POSITIVE_ACCESS_SIGNAL_TYPES: ReadonlySet<string> = new Set(
  accessSignalTypes.filter((type) => !NEGATIVE_ACCESS_SIGNAL_TYPES.has(type)),
);

export const ORGANIZATIONAL_HOME_WAYS_IN_DERIVATION_KEY =
  'signal:REACH_OUT_PLAUSIBLE:ORGANIZATIONAL_HOME';
export const IDENTIFIED_FACULTY_LEAD_WAYS_IN_DERIVATION_KEY =
  'signal:REACH_OUT_PLAUSIBLE:IDENTIFIED_FACULTY_LEAD';

// A bare "there is an identified PI / organizational home" fact is a discovery
// hint (it keeps the entity visible), not undergraduate-access evidence, so the
// identified-lead fallback REACH_OUT_PLAUSIBLE signals must not lift an entity to
// the `likely` acceptance tier. See #696.
//
// The producer was retired in #2578, so these keys now name stored legacy rows
// rather than a live contract. DO NOT delete this denylist before
// `retire:identified-lead-ways-in` has run in every environment: all 4183 stored
// rows carry an excerpt, so the #1343 excerpt rule would admit every one of them
// and silently promote 4174 entities' acceptance level. Delete the data first,
// then this.
export const IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS: ReadonlySet<string> = new Set([
  ORGANIZATIONAL_HOME_WAYS_IN_DERIVATION_KEY,
  IDENTIFIED_FACULTY_LEAD_WAYS_IN_DERIVATION_KEY,
]);

export interface AccessSignalConfidenceInput {
  type?: string;
  confidence?: string;
  confidenceScore?: number;
  derivationKey?: string;
  excerpt?: string;
}

export function signalConfidenceScore(signal: AccessSignalConfidenceInput): number {
  if (typeof signal.confidenceScore === 'number') return signal.confidenceScore;
  if (signal.confidence === 'HIGH') return 0.9;
  if (signal.confidence === 'MEDIUM') return 0.6;
  if (signal.confidence === 'LOW') return 0.3;
  return 0;
}

// REACH_OUT_PLAUSIBLE is a catch-all outreach-plausibility type: a bare
// derivationKey (e.g. the legacy research-entity-cache-backfill provenance
// recovery) carries no guarantee it is backed by real invitation language, so
// it must not lift the acceptance tier just because it isn't on the
// identified-lead-fallback denylist below. Fail closed: require a real,
// source-backed excerpt. See #1343.
function hasSourceBackedExcerpt(signal: AccessSignalConfidenceInput): boolean {
  return typeof signal.excerpt === 'string' && signal.excerpt.trim().length > 0;
}

export function signalCountsTowardAcceptance(signal: AccessSignalConfidenceInput): boolean {
  if (typeof signal.type !== 'string' || !POSITIVE_ACCESS_SIGNAL_TYPES.has(signal.type)) {
    return false;
  }
  if (
    typeof signal.derivationKey === 'string' &&
    IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS.has(signal.derivationKey)
  ) {
    return false;
  }
  if (signal.type === 'REACH_OUT_PLAUSIBLE') {
    return hasSourceBackedExcerpt(signal);
  }
  return true;
}

export function canonicalAcceptanceLevelFromSignals(
  signals: AccessSignalConfidenceInput[],
): AccessAcceptanceLevel {
  const positive = signals.filter(signalCountsTowardAcceptance);
  if (positive.length === 0) return 'none';
  const strongest = Math.max(...positive.map(signalConfidenceScore));
  return strongest >= ACCEPTANCE_VERIFIED_CONFIDENCE_FLOOR ? 'verified' : 'likely';
}

export function hasPastUndergradAdvisees(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((row) => {
    if (!row || typeof row !== 'object') return false;
    const count = Number((row as { count?: unknown }).count ?? 1);
    return count > 0;
  });
}

/**
 * The one definition of "Has hosted undergraduate researchers" (#3593): evidence that
 * undergraduates have been in the lab. The served flag behind the browse card, the pathway
 * badge and saved plans, and the stored flag the `hostsUndergrads` filter reads, are all this
 * predicate over `pastUndergradAdvisees`, so they cannot disagree about a row. Supervising
 * student projects is a separate claim with its own badge.
 *
 * CURRENT_UNDERGRADS is held out deliberately. Its only live source is the microsite lane's
 * `currentUndergradCount`, and a hand-read of 20 stored counts on Development (2026-09-28)
 * found 13 backed by the cited page; the lane's current, page-grounded code scored 6 of 6 on
 * the gold benchmark, so the gap is stale stored counts. Re-admit it once those are
 * re-derived and re-measured (#3789).
 */
export function entityHasHostedUndergraduates(entity: {
  pastUndergradAdvisees?: unknown;
}): boolean {
  return hasPastUndergradAdvisees(entity.pastUndergradAdvisees);
}
