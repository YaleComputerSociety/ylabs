import { accessSignalTypes } from '../models/researchAccessTypes';
import { RETIRED_UNDERGRAD_QUOTE_CACHE_SOURCE } from '../scrapers/undergradEvidenceQuoteValidation';

export type AccessAcceptanceLevel = 'verified' | 'likely' | 'none';

export const ACCESS_ACCEPTANCE_LEVELS: readonly AccessAcceptanceLevel[] = [
  'verified',
  'likely',
  'none',
];

export const ACCEPTANCE_VERIFIED_CONFIDENCE_FLOOR = 0.7;

const ACCESS_SIGNAL_TYPE_SET: ReadonlySet<string> = new Set(accessSignalTypes);

export const ORGANIZATIONAL_HOME_WAYS_IN_DERIVATION_KEY =
  'signal:REACH_OUT_PLAUSIBLE:ORGANIZATIONAL_HOME';
export const IDENTIFIED_FACULTY_LEAD_WAYS_IN_DERIVATION_KEY =
  'signal:REACH_OUT_PLAUSIBLE:IDENTIFIED_FACULTY_LEAD';

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

export function signalCountsTowardAcceptance(signal: AccessSignalConfidenceInput): boolean {
  return typeof signal.type === 'string' && ACCESS_SIGNAL_TYPE_SET.has(signal.type);
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
 * predicate, so they cannot disagree about a row. Supervising student projects is a separate
 * claim with its own badge.
 *
 * A current roster count joined the predicate once it was re-derived from grounded roster
 * lines (#3789): after that re-run, 28 of 30 stored positive counts sampled on Development
 * (2026-09-28) were backed by the cited page, against 13 of 20 before it. A count held only by
 * the retired cache backfill carried no roster to check, so it still does not count.
 */
export function entityHasHostedUndergraduates(entity: {
  pastUndergradAdvisees?: unknown;
  currentUndergradCount?: unknown;
  fieldProvenance?: { currentUndergradCount?: { sourceName?: unknown } };
}): boolean {
  if (hasPastUndergradAdvisees(entity.pastUndergradAdvisees)) return true;
  const count = Number(entity.currentUndergradCount);
  return (
    Number.isFinite(count) &&
    count > 0 &&
    entity.fieldProvenance?.currentUndergradCount?.sourceName !==
      RETIRED_UNDERGRAD_QUOTE_CACHE_SOURCE
  );
}
