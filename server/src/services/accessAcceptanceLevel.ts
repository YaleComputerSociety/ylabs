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
export const IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS: ReadonlySet<string> = new Set([
  ORGANIZATIONAL_HOME_WAYS_IN_DERIVATION_KEY,
  IDENTIFIED_FACULTY_LEAD_WAYS_IN_DERIVATION_KEY,
]);

export interface AccessSignalConfidenceInput {
  type?: string;
  confidence?: string;
  confidenceScore?: number;
  derivationKey?: string;
}

export function signalConfidenceScore(signal: AccessSignalConfidenceInput): number {
  if (typeof signal.confidenceScore === 'number') return signal.confidenceScore;
  if (signal.confidence === 'HIGH') return 0.9;
  if (signal.confidence === 'MEDIUM') return 0.6;
  if (signal.confidence === 'LOW') return 0.3;
  return 0;
}

export function signalCountsTowardAcceptance(signal: AccessSignalConfidenceInput): boolean {
  if (typeof signal.type !== 'string' || !POSITIVE_ACCESS_SIGNAL_TYPES.has(signal.type)) {
    return false;
  }
  return !(
    typeof signal.derivationKey === 'string' &&
    IDENTIFIED_LEAD_FALLBACK_DERIVATION_KEYS.has(signal.derivationKey)
  );
}

export function canonicalAcceptanceLevelFromSignals(
  signals: AccessSignalConfidenceInput[],
): AccessAcceptanceLevel {
  const positive = signals.filter(signalCountsTowardAcceptance);
  if (positive.length === 0) return 'none';
  const strongest = Math.max(...positive.map(signalConfidenceScore));
  return strongest >= ACCEPTANCE_VERIFIED_CONFIDENCE_FLOOR ? 'verified' : 'likely';
}
