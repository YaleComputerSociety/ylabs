import { describe, expect, it } from 'vitest';

import {
  auditWebsiteUrlRefusal,
  buildWebsiteUrlRefusalReport,
  refusalVerdict,
} from '../researchHomeWebsiteUrlRefusalAuditCore';
import {
  researchHomeWebsiteUrlDecision,
  sourceUrlToResearchHomeWebsiteUrl,
} from '../../utils/researchHomeWebsiteUrl';

const CENTRE_ON_SCHOOL_SUBDOMAIN = 'https://environment.yale.edu/research/centers/example-centre/';
const PERSONAL_PAGE_ON_LEGACY_DEPARTMENT_HOST = 'https://www.cs.yale.edu/homes/examplename/';
const PERSONAL_SUBDOMAIN_ROOT_UNSHARED_TRAILING = 'https://examplemodel.econ.yale.edu/';
const FACULTY_DIRECTORY_HOST = 'https://faculty.som.yale.edu/examplename/';
const CMS_PROFILE = 'https://medicine.yale.edu/profile/examplename/';
const ACCEPTED_PERSONAL_SUBDOMAIN = 'https://examplegrouphost.sites.yale.edu/';

describe('researchHomeWebsiteUrlDecision reports the arm that refused (#2582)', () => {
  it('names the path-vocabulary arm and the host shape for a centre on a school subdomain', () => {
    const decision = researchHomeWebsiteUrlDecision(CENTRE_ON_SCHOOL_SUBDOMAIN, {
      entityType: 'CENTER',
    });
    expect(decision.url).toBe('');
    expect(decision.refusal).toBe('yale-path-vocabulary');
    expect(decision.hostShape).toBe('school-or-department-subdomain');
  });

  it('distinguishes a www-plus-school host from an unrecognized trailing label', () => {
    expect(
      researchHomeWebsiteUrlDecision(PERSONAL_PAGE_ON_LEGACY_DEPARTMENT_HOST, {
        entityType: 'FACULTY_RESEARCH_AREA',
      }).hostShape,
    ).toBe('www-plus-school');
    expect(
      researchHomeWebsiteUrlDecision(PERSONAL_SUBDOMAIN_ROOT_UNSHARED_TRAILING, {
        entityType: 'FACULTY_RESEARCH_AREA',
      }).hostShape,
    ).toBe('unshared-trailing-label');
  });

  it('names the profile arm rather than the path vocabulary for a CMS profile page', () => {
    expect(researchHomeWebsiteUrlDecision(CMS_PROFILE, { entityType: 'LAB' }).refusal).toBe(
      'cms-profile-path',
    );
  });

  it('accepts a personal subdomain whose trailing label is a platform label', () => {
    const decision = researchHomeWebsiteUrlDecision(ACCEPTED_PERSONAL_SUBDOMAIN, {
      entityType: 'LAB',
    });
    expect(decision.refusal).toBeNull();
    expect(decision.url).toBe(ACCEPTED_PERSONAL_SUBDOMAIN);
  });

  it('agrees with the boolean resolver on every case, so the two cannot drift', () => {
    for (const value of [
      CENTRE_ON_SCHOOL_SUBDOMAIN,
      PERSONAL_PAGE_ON_LEGACY_DEPARTMENT_HOST,
      PERSONAL_SUBDOMAIN_ROOT_UNSHARED_TRAILING,
      FACULTY_DIRECTORY_HOST,
      CMS_PROFILE,
      ACCEPTED_PERSONAL_SUBDOMAIN,
      'not a url',
      '',
    ]) {
      expect(sourceUrlToResearchHomeWebsiteUrl(value, { entityType: 'LAB' })).toBe(
        researchHomeWebsiteUrlDecision(value, { entityType: 'LAB' }).url,
      );
    }
  });
});

describe('refusalVerdict separates a rule gap from a claim about the URL', () => {
  it('reads the three untaught host shapes as a rule gap', () => {
    for (const shape of [
      'school-or-department-subdomain',
      'www-plus-school',
      'unshared-trailing-label',
    ] as const) {
      expect(refusalVerdict('yale-path-vocabulary', shape)).toBe('untaught-shape');
    }
  });

  it('reads a faculty-directory host as a defect even on the same arm', () => {
    expect(refusalVerdict('yale-path-vocabulary', 'directory-host')).toBe('defect');
  });

  it('reads every other arm as a defect', () => {
    for (const reason of [
      'cms-profile-path',
      'person-profile-or-directory-path',
      'department-programme-page',
      'press-or-news-host',
      'file-or-document',
      'external-scholarly-platform',
      'multi-tenant-host-root',
    ] as const) {
      expect(refusalVerdict(reason)).toBe('defect');
    }
  });
});

describe('buildWebsiteUrlRefusalReport', () => {
  it('splits the refusal count into defects and untaught shapes', () => {
    const report = buildWebsiteUrlRefusalReport([
      { websiteUrl: CENTRE_ON_SCHOOL_SUBDOMAIN, entityType: 'CENTER' },
      { websiteUrl: PERSONAL_PAGE_ON_LEGACY_DEPARTMENT_HOST, entityType: 'FACULTY_RESEARCH_AREA' },
      { websiteUrl: FACULTY_DIRECTORY_HOST, entityType: 'FACULTY_RESEARCH_AREA' },
      { websiteUrl: CMS_PROFILE, entityType: 'LAB' },
      { websiteUrl: ACCEPTED_PERSONAL_SUBDOMAIN, entityType: 'LAB' },
      { websiteUrl: '', entityType: 'LAB' },
    ]);

    expect(report.servedRowsWithWebsiteUrl).toBe(5);
    expect(report.refused).toBe(4);
    expect(report.defects).toBe(2);
    expect(report.untaughtShapes).toBe(2);
    expect(report.byLabel['yale-path-vocabulary/school-or-department-subdomain']).toEqual({
      count: 1,
      verdict: 'untaught-shape',
    });
    expect(report.defectsByLabel).toEqual({
      'yale-path-vocabulary/directory-host': 1,
      'cms-profile-path': 1,
    });
    expect(report.byEntityType.CENTER).toEqual({ defects: 0, untaughtShapes: 1 });
  });

  it('reports no refusal for a row whose website the resolver accepts', () => {
    const report = buildWebsiteUrlRefusalReport([
      { websiteUrl: ACCEPTED_PERSONAL_SUBDOMAIN, entityType: 'LAB' },
    ]);
    expect(report.refused).toBe(0);
    expect(auditWebsiteUrlRefusal({ websiteUrl: ACCEPTED_PERSONAL_SUBDOMAIN })).toBeNull();
  });
});
