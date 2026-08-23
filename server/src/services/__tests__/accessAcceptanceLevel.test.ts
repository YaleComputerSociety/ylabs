import { describe, expect, it } from 'vitest';
import {
  ACCESS_ACCEPTANCE_LEVELS,
  ACCEPTANCE_VERIFIED_CONFIDENCE_FLOOR,
  IDENTIFIED_FACULTY_LEAD_WAYS_IN_DERIVATION_KEY,
  ORGANIZATIONAL_HOME_WAYS_IN_DERIVATION_KEY,
  canonicalAcceptanceLevelFromSignals,
  hasUndergradHostingEvidenceFromSignals,
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

describe('hasUndergradHostingEvidenceFromSignals (#1054)', () => {
  it('is true for any undergrad-specific hosting/supervision signal', () => {
    expect(hasUndergradHostingEvidenceFromSignals([{ type: 'PAST_UNDERGRADS' }])).toBe(true);
    expect(hasUndergradHostingEvidenceFromSignals([{ type: 'CURRENT_UNDERGRADS' }])).toBe(true);
    expect(
      hasUndergradHostingEvidenceFromSignals([{ type: 'FACULTY_SUPERVISES_STUDENT_PROJECTS' }]),
    ).toBe(true);
  });

  it('is false for generic outreach signals that only lift the broad acceptance tier', () => {
    expect(hasUndergradHostingEvidenceFromSignals([])).toBe(false);
    expect(
      hasUndergradHostingEvidenceFromSignals([
        { type: 'REACH_OUT_PLAUSIBLE' },
        { type: 'CONTACT_INSTRUCTIONS_EXIST' },
        { type: 'APPLICATION_FORM_EXISTS' },
        { type: 'NOT_CURRENTLY_AVAILABLE' },
      ]),
    ).toBe(false);
  });
});
