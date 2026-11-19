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

describe('entityHasHostedUndergraduates with an official roster (#5232)', () => {
  const observedAt = new Date('2020-01-01T00:00:00Z');
  const longExpired = new Date('2020-02-01T00:00:00Z');
  const roster = (overrides: Record<string, unknown>) => ({
    state: 'current',
    observedAt,
    freshnessExpiresAt: longExpired,
    undergraduates: [],
    ...overrides,
  });

  it('counts a roster that lists a current undergraduate, whatever its freshness window', () => {
    expect(
      entityHasHostedUndergraduates({
        rosterEnrichment: roster({
          undergraduates: [{ name: 'Synthetic Student', status: 'current' }],
        }),
      }),
    ).toBe(true);
  });

  it('counts a partial roster that lists only past undergraduates', () => {
    expect(
      entityHasHostedUndergraduates({
        rosterEnrichment: roster({
          state: 'partial',
          undergraduates: [{ name: 'Synthetic Alumna', status: 'past', endYear: 2019 }],
        }),
      }),
    ).toBe(true);
  });

  it('reads the last successful snapshot when the latest read failed', () => {
    expect(
      entityHasHostedUndergraduates({
        rosterEnrichment: roster({
          state: 'failed',
          undergraduates: [],
          lastSuccessfulSnapshot: {
            state: 'current',
            observedAt,
            undergraduates: [{ name: 'Synthetic Student', status: 'current' }],
          },
        }),
      }),
    ).toBe(true);
    expect(
      entityHasHostedUndergraduates({
        rosterEnrichment: roster({
          state: 'failed',
          undergraduates: [{ name: 'Synthetic Student', status: 'current' }],
        }),
      }),
    ).toBe(false);
  });

  it('does not count an empty roster or entries without a name or a known status', () => {
    expect(entityHasHostedUndergraduates({ rosterEnrichment: roster({}) })).toBe(false);
    expect(
      entityHasHostedUndergraduates({ rosterEnrichment: roster({ undergraduates: undefined }) }),
    ).toBe(false);
    expect(
      entityHasHostedUndergraduates({
        rosterEnrichment: roster({
          undergraduates: [
            { name: '   ', status: 'current' },
            { name: 'Synthetic Student', status: 'visiting' },
            { name: 'x'.repeat(81), status: 'past' },
            { status: 'current' },
            null,
          ],
        }),
      }),
    ).toBe(false);
  });

  it('does not count a roster whose state names no listing', () => {
    for (const state of ['withheld', 'empty', 'stale']) {
      expect(
        entityHasHostedUndergraduates({
          rosterEnrichment: roster({
            state,
            undergraduateWithheldCount: 4,
            undergraduates: [{ name: 'Synthetic Student', status: 'current' }],
          }),
        }),
      ).toBe(false);
    }
  });
});
