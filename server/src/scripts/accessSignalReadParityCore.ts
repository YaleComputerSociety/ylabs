import {
  ACCEPTANCE_VERIFIED_CONFIDENCE_FLOOR,
  NEGATIVE_ACCESS_SIGNAL_TYPES,
  POSITIVE_ACCESS_SIGNAL_TYPES,
  canonicalAcceptanceLevelFromSignals,
  signalConfidenceScore,
  type AccessAcceptanceLevel,
  type AccessSignalConfidenceInput,
} from '../services/accessAcceptanceLevel';

export {
  ACCEPTANCE_VERIFIED_CONFIDENCE_FLOOR,
  NEGATIVE_ACCESS_SIGNAL_TYPES,
  POSITIVE_ACCESS_SIGNAL_TYPES,
  canonicalAcceptanceLevelFromSignals,
  signalConfidenceScore,
};

export type { AccessAcceptanceLevel, AccessSignalConfidenceInput };

export interface LegacyAccessFields {
  acceptingUndergrads?: boolean;
  acceptanceConfidence?: number;
  offersIndependentStudy?: boolean;
  currentUndergradCount?: number;
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
