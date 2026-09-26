import { describe, expect, it } from 'vitest';
import {
  decideListingItemAreaRepair,
  planListingItemAreaRepair,
  type ListingItemAreaProbe,
} from '../retireListingItemResearchAreasCore';

const probe = (overrides: Partial<ListingItemAreaProbe> = {}): ListingItemAreaProbe => ({
  entityId: '6a8ebb78e409f6d48fff2c2d',
  slug: 'center-example-region',
  observationId: '6a915f260ee129ad7cc69275',
  sourceUrl: 'https://example.yale.edu/region',
  assertedAreas: ['Artificial Intelligence'],
  storedAreas: ['Artificial Intelligence'],
  rederivedAreas: [],
  ...overrides,
});

describe('decideListingItemAreaRepair', () => {
  it('retires the observation and clears the stored field when the page supports no area', () => {
    const decision = decideListingItemAreaRepair(probe());
    expect(decision.verdict).toBe('emptied');
    expect(decision.withdrawnAreas).toEqual(['Artificial Intelligence']);
    expect(decision.retiresObservation).toBe(true);
    expect(decision.appendsCorrectedObservation).toBe(false);
    expect(decision.clearsStoredAreas).toBe(true);
  });

  it('leaves the stored field alone when another source contributed to it', () => {
    const decision = decideListingItemAreaRepair(
      probe({ storedAreas: ['Artificial Intelligence', 'Asian Studies'] }),
    );
    expect(decision.verdict).toBe('emptied');
    expect(decision.retiresObservation).toBe(true);
    expect(decision.clearsStoredAreas).toBe(false);
  });

  it('replaces the observation with the surviving subset when the page still supports some', () => {
    const decision = decideListingItemAreaRepair(
      probe({
        assertedAreas: ['Genomics', 'Cardiology', 'Immunology'],
        storedAreas: ['Genomics', 'Cardiology', 'Immunology'],
        rederivedAreas: ['Genomics', 'Immunology'],
      }),
    );
    expect(decision.verdict).toBe('narrowed');
    expect(decision.correctedAreas).toEqual(['Genomics', 'Immunology']);
    expect(decision.withdrawnAreas).toEqual(['Cardiology']);
    expect(decision.retiresObservation).toBe(true);
    expect(decision.appendsCorrectedObservation).toBe(true);
    expect(decision.clearsStoredAreas).toBe(false);
  });

  it('writes nothing on a re-run because the probe now agrees with the assertion', () => {
    const decision = decideListingItemAreaRepair(
      probe({
        assertedAreas: ['Genomics', 'Immunology'],
        storedAreas: ['Genomics', 'Immunology'],
        rederivedAreas: ['Immunology', 'genomics'],
      }),
    );
    expect(decision.verdict).toBe('unchanged');
    expect(decision.retiresObservation).toBe(false);
    expect(decision.clearsStoredAreas).toBe(false);
  });

  it('writes nothing when the page now names a topic it never asserted', () => {
    const decision = decideListingItemAreaRepair(
      probe({
        assertedAreas: ['Genomics', 'Cardiology'],
        storedAreas: ['Genomics', 'Cardiology'],
        rederivedAreas: ['Genomics', 'Proteomics'],
      }),
    );
    expect(decision.verdict).toBe('page-drift');
    expect(decision.retiresObservation).toBe(false);
    expect(decision.withdrawnAreas).toEqual([]);
  });

  it('writes nothing when the page could not be read', () => {
    const decision = decideListingItemAreaRepair(probe({ rederivedAreas: null }));
    expect(decision.verdict).toBe('unfetchable');
    expect(decision.retiresObservation).toBe(false);
    expect(decision.clearsStoredAreas).toBe(false);
  });
});

describe('planListingItemAreaRepair', () => {
  it('counts every arm so a dry run reports what each would do', () => {
    const plan = planListingItemAreaRepair([
      probe({ slug: 'a' }),
      probe({ slug: 'b', storedAreas: ['Artificial Intelligence', 'Asian Studies'] }),
      probe({
        slug: 'c',
        assertedAreas: ['Genomics', 'Cardiology'],
        storedAreas: ['Genomics', 'Cardiology'],
        rederivedAreas: ['Genomics'],
      }),
      probe({
        slug: 'd',
        assertedAreas: ['Genomics'],
        storedAreas: ['Genomics'],
        rederivedAreas: ['Genomics'],
      }),
      probe({ slug: 'e', rederivedAreas: null }),
    ]);
    expect(plan.counts).toEqual({
      unfetchable: 1,
      unchanged: 1,
      'page-drift': 0,
      narrowed: 1,
      emptied: 2,
    });
    expect(plan.observationsToRetire).toBe(3);
    expect(plan.correctedObservationsToAppend).toBe(1);
    expect(plan.storedFieldsToClear).toBe(1);
    expect(plan.areasWithdrawn).toBe(3);
  });
});
