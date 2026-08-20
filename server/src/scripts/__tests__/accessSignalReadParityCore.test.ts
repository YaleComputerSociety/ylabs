import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_VERIFIED_CONFIDENCE_FLOOR,
  POSITIVE_ACCESS_SIGNAL_TYPES,
  canonicalAcceptanceLevelFromSignals,
  legacyAcceptanceLevelFromEntity,
  signalConfidenceScore,
} from '../accessSignalReadParityCore';

describe('signalConfidenceScore', () => {
  it('prefers a numeric confidenceScore when present', () => {
    expect(signalConfidenceScore({ confidenceScore: 0.42, confidence: 'HIGH' })).toBe(0.42);
  });

  it('maps the HIGH/MEDIUM/LOW gradient to numeric scores', () => {
    expect(signalConfidenceScore({ confidence: 'HIGH' })).toBe(0.9);
    expect(signalConfidenceScore({ confidence: 'MEDIUM' })).toBe(0.6);
    expect(signalConfidenceScore({ confidence: 'LOW' })).toBe(0.3);
  });

  it('scores an unknown confidence as zero', () => {
    expect(signalConfidenceScore({})).toBe(0);
  });
});

describe('canonicalAcceptanceLevelFromSignals', () => {
  it('treats an empty signal set as none', () => {
    expect(canonicalAcceptanceLevelFromSignals([])).toBe('none');
  });

  it('treats only negative signals as none', () => {
    expect(
      canonicalAcceptanceLevelFromSignals([
        { type: 'NOT_CURRENTLY_AVAILABLE', confidence: 'HIGH' },
        { type: 'NO_EVIDENCE', confidence: 'HIGH' },
      ]),
    ).toBe('none');
  });

  it('classifies a HIGH-confidence positive signal as verified', () => {
    expect(
      canonicalAcceptanceLevelFromSignals([{ type: 'CURRENT_UNDERGRADS', confidence: 'HIGH' }]),
    ).toBe('verified');
  });

  it('classifies a positive signal below the floor as likely', () => {
    expect(
      canonicalAcceptanceLevelFromSignals([{ type: 'REACH_OUT_PLAUSIBLE', confidence: 'MEDIUM' }]),
    ).toBe('likely');
  });

  it('takes the strongest positive signal, ignoring negatives', () => {
    expect(
      canonicalAcceptanceLevelFromSignals([
        { type: 'NOT_CURRENTLY_AVAILABLE', confidenceScore: 0.95 },
        { type: 'REACH_OUT_PLAUSIBLE', confidenceScore: 0.5 },
        { type: 'CURRENT_UNDERGRADS', confidenceScore: 0.8 },
      ]),
    ).toBe('verified');
  });

  it('uses the floor as an inclusive boundary', () => {
    expect(
      canonicalAcceptanceLevelFromSignals([
        { type: 'POSTED_OPENING', confidenceScore: ACCEPTANCE_VERIFIED_CONFIDENCE_FLOOR },
      ]),
    ).toBe('verified');
  });

  it('excludes the negative types from the positive set', () => {
    expect(POSITIVE_ACCESS_SIGNAL_TYPES.has('NOT_CURRENTLY_AVAILABLE')).toBe(false);
    expect(POSITIVE_ACCESS_SIGNAL_TYPES.has('NO_EVIDENCE')).toBe(false);
    expect(POSITIVE_ACCESS_SIGNAL_TYPES.has('CURRENT_UNDERGRADS')).toBe(true);
  });
});

describe('legacyAcceptanceLevelFromEntity', () => {
  it('classifies accepting with high confidence as verified', () => {
    expect(
      legacyAcceptanceLevelFromEntity({ acceptingUndergrads: true, acceptanceConfidence: 0.8 }),
    ).toBe('verified');
  });

  it('classifies accepting below the confidence floor as likely', () => {
    expect(
      legacyAcceptanceLevelFromEntity({ acceptingUndergrads: true, acceptanceConfidence: 0.3 }),
    ).toBe('likely');
  });

  it('classifies independent study or current undergrads as likely', () => {
    expect(legacyAcceptanceLevelFromEntity({ offersIndependentStudy: true })).toBe('likely');
    expect(legacyAcceptanceLevelFromEntity({ currentUndergradCount: 2 })).toBe('likely');
  });

  it('classifies an entity with no positive legacy fields as none', () => {
    expect(
      legacyAcceptanceLevelFromEntity({
        acceptingUndergrads: false,
        acceptanceConfidence: 1,
        offersIndependentStudy: false,
        currentUndergradCount: 0,
      }),
    ).toBe('none');
    expect(legacyAcceptanceLevelFromEntity({})).toBe('none');
  });
});
