import { describe, expect, it } from 'vitest';
import {
  isAdvancementValuedObservation,
  leavesEntityWithNoCitation,
  planAdvancementWebsiteRepair,
} from '../retireAdvancementPageWebsiteUrlsCore';

const DONOR_PAGE =
  'https://sph.yale.edu/about/charitable-opportunities/donors-make-a-difference/example-fund/';
const DIRECTORY = 'https://sph.yale.edu/faculty/directory-name/';
const LAB = 'https://marlowelab.example.org/';

describe('planAdvancementWebsiteRepair', () => {
  it('clears an advancement websiteUrl and drops it from sourceUrls', () => {
    const plan = planAdvancementWebsiteRepair({
      websiteUrl: DONOR_PAGE,
      sourceUrls: [DIRECTORY, DONOR_PAGE],
    });
    expect(plan).toEqual({
      clearWebsiteUrl: true,
      retiredWebsiteUrl: DONOR_PAGE,
      nextSourceUrls: [DIRECTORY],
      removedSourceUrls: [DONOR_PAGE],
    });
  });

  it('leaves an entity with a genuine research home untouched', () => {
    expect(
      planAdvancementWebsiteRepair({ websiteUrl: LAB, sourceUrls: [DIRECTORY, LAB] }),
    ).toBeNull();
  });

  it('drops an advancement citation even when websiteUrl is already clean', () => {
    const plan = planAdvancementWebsiteRepair({
      websiteUrl: LAB,
      sourceUrls: [LAB, DONOR_PAGE],
    });
    expect(plan?.clearWebsiteUrl).toBe(false);
    expect(plan?.retiredWebsiteUrl).toBeUndefined();
    expect(plan?.nextSourceUrls).toEqual([LAB]);
  });

  it('clears an advancement websiteUrl an entity never cited', () => {
    const plan = planAdvancementWebsiteRepair({ websiteUrl: DONOR_PAGE, sourceUrls: [] });
    expect(plan?.clearWebsiteUrl).toBe(true);
    expect(plan?.removedSourceUrls).toEqual([]);
  });

  it('ignores non-string entries in sourceUrls', () => {
    const plan = planAdvancementWebsiteRepair({
      websiteUrl: DONOR_PAGE,
      sourceUrls: [null, 42, DIRECTORY],
    });
    expect(plan?.nextSourceUrls).toEqual([DIRECTORY]);
  });

  it('is a no-op for an entity with no urls at all', () => {
    expect(planAdvancementWebsiteRepair({})).toBeNull();
  });
});

describe('leavesEntityWithNoCitation', () => {
  it('flags a repair that empties sourceUrls', () => {
    const plan = planAdvancementWebsiteRepair({
      websiteUrl: DONOR_PAGE,
      sourceUrls: [DONOR_PAGE],
    })!;
    expect(leavesEntityWithNoCitation(plan)).toBe(true);
  });

  it('does not flag a repair that keeps a citation', () => {
    const plan = planAdvancementWebsiteRepair({
      websiteUrl: DONOR_PAGE,
      sourceUrls: [DIRECTORY, DONOR_PAGE],
    })!;
    expect(leavesEntityWithNoCitation(plan)).toBe(false);
  });

  it('does not flag a websiteUrl-only clear that removed no citation', () => {
    const plan = planAdvancementWebsiteRepair({ websiteUrl: DONOR_PAGE, sourceUrls: [] })!;
    expect(leavesEntityWithNoCitation(plan)).toBe(false);
  });
});

describe('isAdvancementValuedObservation', () => {
  it('selects a websiteUrl observation whose value is an advancement page', () => {
    expect(isAdvancementValuedObservation('websiteUrl', DONOR_PAGE)).toBe(true);
    expect(isAdvancementValuedObservation('websiteUrl', LAB)).toBe(false);
  });

  it('selects a sourceUrls observation containing an advancement page', () => {
    expect(isAdvancementValuedObservation('sourceUrls', [DIRECTORY, DONOR_PAGE])).toBe(true);
    expect(isAdvancementValuedObservation('sourceUrls', [DIRECTORY, LAB])).toBe(false);
  });

  it('never selects an unrelated field', () => {
    expect(isAdvancementValuedObservation('fullDescription', DONOR_PAGE)).toBe(false);
    expect(isAdvancementValuedObservation('name', DONOR_PAGE)).toBe(false);
  });
});
