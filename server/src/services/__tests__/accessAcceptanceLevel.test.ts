import { describe, expect, it } from 'vitest';
import {
  ACCESS_ACCEPTANCE_LEVELS,
  ACCEPTANCE_VERIFIED_CONFIDENCE_FLOOR,
  canonicalAcceptanceLevelFromSignals,
  entityHasHostedUndergraduates,
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

  it('counts no retired access type toward acceptance (#4637)', () => {
    for (const type of [
      'REACH_OUT_PLAUSIBLE',
      'CONTACT_INSTRUCTIONS_EXIST',
      'FELLOWSHIP_COMPATIBLE',
      'COURSE_CREDIT_PATHWAY',
    ]) {
      expect(
        canonicalAcceptanceLevelFromSignals([
          { type, confidenceScore: 0.9, excerpt: 'Undergraduates should reach out by email.' },
        ]),
      ).toBe('none');
    }
  });
});

describe('entityHasHostedUndergraduates (#3593)', () => {
  it('is true for a row with past undergraduate advisees', () => {
    expect(
      entityHasHostedUndergraduates({
        pastUndergradAdvisees: [{ name: 'Synthetic Advisee', count: 2 }],
      }),
    ).toBe(true);
    expect(
      entityHasHostedUndergraduates({ pastUndergradAdvisees: [{ name: 'Synthetic Advisee' }] }),
    ).toBe(true);
  });

  it('is false with no advisees or only zero counts', () => {
    expect(entityHasHostedUndergraduates({})).toBe(false);
    expect(entityHasHostedUndergraduates({ pastUndergradAdvisees: [] })).toBe(false);
    expect(
      entityHasHostedUndergraduates({
        pastUndergradAdvisees: [{ name: 'Synthetic Advisee', count: 0 }],
      }),
    ).toBe(false);
  });
});

describe('entityHasHostedUndergraduates with a current roster count (#3789)', () => {
  it('counts a grounded roster count from the microsite lane', () => {
    expect(
      entityHasHostedUndergraduates({
        currentUndergradCount: 2,
        fieldProvenance: { currentUndergradCount: { sourceName: 'lab-microsite-undergrad-llm' } },
      }),
    ).toBe(true);
  });

  it('does not count a zero, or a count held only by the retired cache backfill', () => {
    expect(entityHasHostedUndergraduates({ currentUndergradCount: 0 })).toBe(false);
    expect(
      entityHasHostedUndergraduates({
        currentUndergradCount: 5,
        fieldProvenance: {
          currentUndergradCount: { sourceName: 'research-entity-cache-backfill' },
        },
      }),
    ).toBe(false);
  });
});
