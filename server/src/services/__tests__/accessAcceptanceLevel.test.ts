import { describe, expect, it } from 'vitest';
import {
  ACCESS_ACCEPTANCE_LEVELS,
  ACCEPTANCE_VERIFIED_CONFIDENCE_FLOOR,
  IDENTIFIED_FACULTY_LEAD_WAYS_IN_DERIVATION_KEY,
  ORGANIZATIONAL_HOME_WAYS_IN_DERIVATION_KEY,
  canonicalAcceptanceLevelFromSignals,
} from '../accessAcceptanceLevel';

describe('accessAcceptanceLevel', () => {
  it('enumerates the acceptance levels', () => {
    expect(ACCESS_ACCEPTANCE_LEVELS).toEqual(['verified', 'likely', 'none']);
  });

  it('is none without any positive access signal', () => {
    expect(canonicalAcceptanceLevelFromSignals([])).toBe('none');
    expect(
      canonicalAcceptanceLevelFromSignals([
        { type: 'NOT_CURRENTLY_AVAILABLE', confidence: 'HIGH' },
      ]),
    ).toBe('none');
  });

  it('is verified only when the strongest positive signal meets the floor', () => {
    expect(
      canonicalAcceptanceLevelFromSignals([
        { type: 'CURRENT_UNDERGRADS', confidenceScore: ACCEPTANCE_VERIFIED_CONFIDENCE_FLOOR },
      ]),
    ).toBe('verified');
    expect(
      canonicalAcceptanceLevelFromSignals([{ type: 'CURRENT_UNDERGRADS', confidence: 'MEDIUM' }]),
    ).toBe('likely');
  });

  it('does not count the identified-lead fallback toward the likely tier (#696)', () => {
    expect(
      canonicalAcceptanceLevelFromSignals([
        {
          type: 'REACH_OUT_PLAUSIBLE',
          confidenceScore: 0.4,
          derivationKey: IDENTIFIED_FACULTY_LEAD_WAYS_IN_DERIVATION_KEY,
        },
      ]),
    ).toBe('none');
    expect(
      canonicalAcceptanceLevelFromSignals([
        {
          type: 'REACH_OUT_PLAUSIBLE',
          confidenceScore: 0.4,
          derivationKey: ORGANIZATIONAL_HOME_WAYS_IN_DERIVATION_KEY,
        },
      ]),
    ).toBe('none');
  });

  it('still counts an evidence-backed REACH_OUT_PLAUSIBLE toward the likely tier', () => {
    expect(
      canonicalAcceptanceLevelFromSignals([
        {
          type: 'REACH_OUT_PLAUSIBLE',
          confidenceScore: 0.5,
          derivationKey: 'signal:REACH_OUT_PLAUSIBLE',
        },
      ]),
    ).toBe('likely');
  });
});
