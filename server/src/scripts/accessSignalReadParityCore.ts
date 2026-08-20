import { accessSignalTypes } from '../models/researchAccessTypes';

export type AccessAcceptanceLevel = 'verified' | 'likely' | 'none';

export const ACCEPTANCE_VERIFIED_CONFIDENCE_FLOOR = 0.7;

export const NEGATIVE_ACCESS_SIGNAL_TYPES: ReadonlySet<string> = new Set([
  'NOT_CURRENTLY_AVAILABLE',
  'NO_EVIDENCE',
]);

export const POSITIVE_ACCESS_SIGNAL_TYPES: ReadonlySet<string> = new Set(
  accessSignalTypes.filter((type) => !NEGATIVE_ACCESS_SIGNAL_TYPES.has(type)),
);

export interface AccessSignalConfidenceInput {
  type?: string;
  confidence?: string;
  confidenceScore?: number;
}

export interface LegacyAccessFields {
  acceptingUndergrads?: boolean;
  acceptanceConfidence?: number;
  offersIndependentStudy?: boolean;
  currentUndergradCount?: number;
}

export function signalConfidenceScore(signal: AccessSignalConfidenceInput): number {
  if (typeof signal.confidenceScore === 'number') return signal.confidenceScore;
  if (signal.confidence === 'HIGH') return 0.9;
  if (signal.confidence === 'MEDIUM') return 0.6;
  if (signal.confidence === 'LOW') return 0.3;
  return 0;
}

export function canonicalAcceptanceLevelFromSignals(
  signals: AccessSignalConfidenceInput[],
): AccessAcceptanceLevel {
  const positive = signals.filter(
    (signal) => typeof signal.type === 'string' && POSITIVE_ACCESS_SIGNAL_TYPES.has(signal.type),
  );
  if (positive.length === 0) return 'none';
  const strongest = Math.max(...positive.map(signalConfidenceScore));
  return strongest >= ACCEPTANCE_VERIFIED_CONFIDENCE_FLOOR ? 'verified' : 'likely';
}

export function legacyAcceptanceLevelFromEntity(entity: LegacyAccessFields): AccessAcceptanceLevel {
  const verified =
    entity.acceptingUndergrads === true &&
    (entity.acceptanceConfidence ?? 0) >= ACCEPTANCE_VERIFIED_CONFIDENCE_FLOOR;
  if (verified) return 'verified';
  const likely =
    entity.acceptingUndergrads === true ||
    entity.offersIndependentStudy === true ||
    (entity.currentUndergradCount ?? 0) > 0;
  return likely ? 'likely' : 'none';
}
