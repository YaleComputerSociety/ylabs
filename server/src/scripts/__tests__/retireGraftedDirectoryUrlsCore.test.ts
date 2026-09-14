import { describe, expect, it } from 'vitest';
import {
  isGraftValuedObservation,
  isGraftedDirectoryUrl,
  isRosterPageCitedByPerson,
  leavesEntityWithNoCitation,
  planGraftedUrlRepair,
} from '../retireGraftedDirectoryUrlsCore';

const AJAX = 'https://law.yale.edu/views/ajax';
const PROGRAMME = 'https://physics.yale.edu/academics/undergraduate-studies/undergraduate-research';
const REAL_HOME = 'https://ohernlab.yale.edu/';
const PROFILE = 'https://law.yale.edu/ian-ayres';

describe('isGraftedDirectoryUrl', () => {
  it('condemns a CMS internal endpoint on every entity type, because it is never a page', () => {
    for (const entityType of ['LAB', 'FACULTY_RESEARCH_AREA', 'CENTER', 'INITIATIVE']) {
      expect(isGraftedDirectoryUrl(AJAX, { entityType })).toBe(true);
    }
  });

  it('condemns a programme page only on person-scoped rows', () => {
    expect(isGraftedDirectoryUrl(PROGRAMME, { entityType: 'LAB' })).toBe(true);
    expect(isGraftedDirectoryUrl(PROGRAMME, { entityType: 'FACULTY_RESEARCH_AREA' })).toBe(true);
    expect(isGraftedDirectoryUrl(PROGRAMME, { entityType: 'CENTER' })).toBe(false);
    expect(isGraftedDirectoryUrl(PROGRAMME, { entityType: 'INITIATIVE' })).toBe(false);
  });

  it('never condemns a real research home or a person profile', () => {
    for (const entityType of ['LAB', 'CENTER']) {
      expect(isGraftedDirectoryUrl(REAL_HOME, { entityType })).toBe(false);
      expect(isGraftedDirectoryUrl(PROFILE, { entityType })).toBe(false);
    }
  });
});

describe('planGraftedUrlRepair', () => {
  it('returns null for a clean entity, so a no-op is not counted as a repair', () => {
    expect(
      planGraftedUrlRepair({
        entityType: 'LAB',
        websiteUrl: REAL_HOME,
        sourceUrls: [PROFILE, REAL_HOME],
      }),
    ).toBeNull();
  });

  it('removes only the grafted citation and keeps the rest, for the dept-physics shape', () => {
    const plan = planGraftedUrlRepair({
      entityType: 'LAB',
      websiteUrl: REAL_HOME,
      sourceUrls: [PROGRAMME, PROFILE],
    });
    expect(plan).not.toBeNull();
    expect(plan?.clearWebsiteUrl).toBe(false);
    expect(plan?.removedSourceUrls).toEqual([PROGRAMME]);
    expect(plan?.nextSourceUrls).toEqual([PROFILE]);
    expect(leavesEntityWithNoCitation(plan!)).toBe(false);
  });

  it('clears websiteUrl when that is the grafted value', () => {
    const plan = planGraftedUrlRepair({
      entityType: 'LAB',
      websiteUrl: PROGRAMME,
      sourceUrls: [PROFILE],
    });
    expect(plan?.clearWebsiteUrl).toBe(true);
    expect(plan?.retiredWebsiteUrl).toBe(PROGRAMME);
    expect(plan?.nextSourceUrls).toEqual([PROFILE]);
  });

  it('flags a row whose only citation was the graft, because that moves a gate input', () => {
    const plan = planGraftedUrlRepair({
      entityType: 'FACULTY_RESEARCH_AREA',
      sourceUrls: [AJAX],
    });
    expect(plan?.removedSourceUrls).toEqual([AJAX]);
    expect(plan?.nextSourceUrls).toEqual([]);
    expect(leavesEntityWithNoCitation(plan!)).toBe(true);
  });

  it('leaves an organizational row citing the same programme page untouched', () => {
    expect(
      planGraftedUrlRepair({
        entityType: 'CENTER',
        sourceUrls: [PROGRAMME, PROFILE],
      }),
    ).toBeNull();
  });
});

describe('isGraftValuedObservation', () => {
  it('matches the observation that asserted the graft, on either field', () => {
    expect(isGraftValuedObservation('websiteUrl', PROGRAMME, { entityType: 'LAB' })).toBe(true);
    expect(isGraftValuedObservation('sourceUrls', [PROFILE, AJAX], { entityType: 'LAB' })).toBe(
      true,
    );
  });

  it('does not match a clean observation, or an unrelated field', () => {
    expect(isGraftValuedObservation('websiteUrl', REAL_HOME, { entityType: 'LAB' })).toBe(false);
    expect(isGraftValuedObservation('sourceUrls', [PROFILE], { entityType: 'LAB' })).toBe(false);
    expect(isGraftValuedObservation('name', AJAX, { entityType: 'LAB' })).toBe(false);
  });

  it('does not match a programme page asserted on an organizational row', () => {
    expect(isGraftValuedObservation('sourceUrls', [PROGRAMME], { entityType: 'CENTER' })).toBe(
      false,
    );
  });
});

describe('roster pages cited by a person (#2630)', () => {
  const YSPH = 'https://ysph.yale.edu/school-of-public-health-faculty/directory-name/';
  const DEPT_ROSTER = 'https://mbb.yale.edu/people/faculty';
  const AZ_INDEX = 'https://medicine.yale.edu/about/a-to-z-index/lab-websites/';
  const LAB_SITE = 'https://ohernlab.yale.edu/';

  it('refuses a faculty roster on person-scoped rows', () => {
    for (const entityType of ['LAB', 'FACULTY_RESEARCH_AREA', 'FACULTY_PROJECT']) {
      for (const url of [YSPH, DEPT_ROSTER]) {
        expect(isRosterPageCitedByPerson(url, { entityType })).toBe(true);
        expect(isGraftedDirectoryUrl(url, { entityType })).toBe(true);
      }
    }
  });

  it('keeps a roster on organizational rows, which the roster is genuinely about', () => {
    for (const entityType of ['CENTER', 'INSTITUTE', 'INITIATIVE', 'CORE_FACILITY']) {
      for (const url of [YSPH, DEPT_ROSTER]) {
        expect(isRosterPageCitedByPerson(url, { entityType })).toBe(false);
      }
    }
  });

  it('never refuses a real lab site on any entity type', () => {
    for (const entityType of ['LAB', 'FACULTY_RESEARCH_AREA', 'CENTER']) {
      expect(isRosterPageCitedByPerson(LAB_SITE, { entityType })).toBe(false);
      expect(isGraftedDirectoryUrl(LAB_SITE, { entityType })).toBe(false);
    }
  });

  it('removes only the roster citation and keeps the real evidence', () => {
    const plan = planGraftedUrlRepair({
      entityType: 'FACULTY_RESEARCH_AREA',
      websiteUrl: LAB_SITE,
      sourceUrls: [YSPH, 'https://ysph.yale.edu/profile/some-person/'],
    });
    expect(plan?.removedSourceUrls).toEqual([YSPH]);
    expect(plan?.nextSourceUrls).toEqual(['https://ysph.yale.edu/profile/some-person/']);
    expect(plan?.clearWebsiteUrl).toBe(false);
    expect(leavesEntityWithNoCitation(plan!)).toBe(false);
  });

  it('REFUSES to repair a person row whose only citation is the roster, rather than stranding it', () => {
    // Corpus-wide, an unguarded version stranded 318 rows. Trading a duplicate-risk
    // block for a missing-evidence block is not an improvement.
    expect(planGraftedUrlRepair({ entityType: 'LAB', sourceUrls: [DEPT_ROSTER] })).toBeNull();
  });

  it('still repairs a stranding row when its websiteUrl is also being cleared', () => {
    const plan = planGraftedUrlRepair({
      entityType: 'LAB',
      websiteUrl: DEPT_ROSTER,
      sourceUrls: [DEPT_ROSTER],
    });
    expect(plan?.clearWebsiteUrl).toBe(true);
    expect(plan?.nextSourceUrls).toEqual([]);
  });

  it('also catches the A-Z index page, which the roster predicates already recognise', () => {
    expect(isRosterPageCitedByPerson(AZ_INDEX, { entityType: 'LAB' })).toBe(true);
    expect(isRosterPageCitedByPerson(AZ_INDEX, { entityType: 'CENTER' })).toBe(false);
  });
});
