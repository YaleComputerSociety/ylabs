import { describe, expect, it } from 'vitest';
import { entityHasHostedUndergraduates } from '../hostedUndergraduates';

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
