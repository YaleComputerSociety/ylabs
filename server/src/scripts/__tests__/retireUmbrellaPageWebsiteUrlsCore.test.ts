import { describe, expect, it } from 'vitest';
import {
  isUmbrellaValuedWebsiteUrlObservation,
  planUmbrellaWebsiteUrlRepair,
} from '../retireUmbrellaPageWebsiteUrlsCore';

const GROUP_ROOT = 'http://het.yale.edu/';
const DEPARTMENT_JOBS = 'http://economics.yale.edu/undergraduate/employment-opportunities';
const LAB_HOME = 'https://ohernlab.yale.edu/';

describe('planUmbrellaWebsiteUrlRepair', () => {
  it('retires a group root from a person-scoped row and keeps the citation', () => {
    const plan = planUmbrellaWebsiteUrlRepair({
      entityType: 'FACULTY_RESEARCH_AREA',
      websiteUrl: GROUP_ROOT,
      sourceUrls: [GROUP_ROOT, 'https://physics.yale.edu/people/example-person'],
    });

    expect(plan).toEqual({ retiredWebsiteUrl: GROUP_ROOT, citationRetained: true });
  });

  it('retires a department audience page from a person-scoped row', () => {
    expect(
      planUmbrellaWebsiteUrlRepair({ entityType: 'LAB', websiteUrl: DEPARTMENT_JOBS })
        ?.retiredWebsiteUrl,
    ).toBe(DEPARTMENT_JOBS);
  });

  it('reports a row whose citation list does not carry the retired URL', () => {
    expect(
      planUmbrellaWebsiteUrlRepair({
        entityType: 'LAB',
        websiteUrl: GROUP_ROOT,
        sourceUrls: ['https://physics.yale.edu/people/example-person'],
      })?.citationRetained,
    ).toBe(false);
  });

  it('returns null for a real research home, so a no-op is not counted as a repair', () => {
    expect(
      planUmbrellaWebsiteUrlRepair({ entityType: 'LAB', websiteUrl: LAB_HOME, sourceUrls: [] }),
    ).toBeNull();
    expect(planUmbrellaWebsiteUrlRepair({ entityType: 'LAB', websiteUrl: '' })).toBeNull();
    expect(planUmbrellaWebsiteUrlRepair({ entityType: 'LAB' })).toBeNull();
  });

  it('leaves the group root on the organizational row that owns it', () => {
    for (const entityType of ['CENTER', 'INITIATIVE', 'INSTITUTE', 'ORGANIZATION']) {
      expect(planUmbrellaWebsiteUrlRepair({ entityType, websiteUrl: GROUP_ROOT })).toBeNull();
      expect(planUmbrellaWebsiteUrlRepair({ entityType, websiteUrl: DEPARTMENT_JOBS })).toBeNull();
    }
  });
});

describe('isUmbrellaValuedWebsiteUrlObservation', () => {
  it('retires the websiteUrl assertion that a rematerialize would re-project', () => {
    expect(
      isUmbrellaValuedWebsiteUrlObservation('websiteUrl', GROUP_ROOT, { entityType: 'LAB' }),
    ).toBe(true);
  });

  it('never retires the citation, because the page is real provenance for the person', () => {
    expect(
      isUmbrellaValuedWebsiteUrlObservation('sourceUrls', [GROUP_ROOT], { entityType: 'LAB' }),
    ).toBe(false);
    expect(
      isUmbrellaValuedWebsiteUrlObservation('websiteUrl', LAB_HOME, { entityType: 'LAB' }),
    ).toBe(false);
    expect(
      isUmbrellaValuedWebsiteUrlObservation('websiteUrl', GROUP_ROOT, { entityType: 'CENTER' }),
    ).toBe(false);
  });
});
