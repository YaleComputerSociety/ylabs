import { describe, it, expect } from 'vitest';
import {
  adoptableRetargetedName,
  decideForeignLabWebsiteRetarget,
  isSharedInstitutionalResourceUrl,
  isSynthesizedResearchHomeName,
  namesSeveralPeople,
  personNamesDenoteSamePerson,
  resolveRetargetTarget,
  type RetargetCandidateResearchHome,
} from '../foreignLabWebsiteRetarget';

const apolloHome: RetargetCandidateResearchHome = {
  slug: 'rakita-lab-dr877',
  name: 'Rakita Lab',
  entityType: 'LAB',
  kind: 'lab',
  websiteUrl: '',
  leadName: 'Daniel Rakita',
};

const khannaHolder: RetargetCandidateResearchHome = {
  slug: 'ysm-faculty-amit-khanna',
  name: 'APOLLO LAB, Yale University',
  entityType: 'LAB',
  kind: 'lab',
  leadName: 'Amit Khanna',
};

describe('personNamesDenoteSamePerson', () => {
  it('matches the same person across spacing and case', () => {
    expect(personNamesDenoteSamePerson('Daniel Rakita', 'daniel  rakita')).toBe(true);
    expect(personNamesDenoteSamePerson('Daniel Rakita', 'Daniel P. Rakita')).toBe(true);
  });

  it('refuses an initial, which cannot tell Daniel from Dana Rakita', () => {
    expect(personNamesDenoteSamePerson('D. Rakita', 'Daniel Rakita')).toBe(false);
  });

  it('refuses a shared surname alone, the #562/#579 collision shape', () => {
    expect(personNamesDenoteSamePerson('Hanming Zhang', 'Wei Zhang')).toBe(false);
    expect(personNamesDenoteSamePerson('Ke Xu', 'Mingrui Xu')).toBe(false);
  });

  it('refuses a bare surname, which identifies nobody', () => {
    expect(personNamesDenoteSamePerson('Rakita', 'Daniel Rakita')).toBe(false);
    expect(personNamesDenoteSamePerson('', 'Daniel Rakita')).toBe(false);
  });

  it('does not treat a title as a given name', () => {
    expect(personNamesDenoteSamePerson('Professor Rakita', 'Daniel Rakita')).toBe(false);
  });
});

describe('namesSeveralPeople', () => {
  it('flags a co-led lab, whose surname is whichever name happens to be last', () => {
    expect(namesSeveralPeople('Jeffrey A. Wickersham; Roman Shrestha')).toBe(true);
    expect(namesSeveralPeople('Erica Herzog and Naftali Kaminski')).toBe(true);
    expect(namesSeveralPeople('Wei Mi & Qin Yan')).toBe(true);
    expect(namesSeveralPeople('Ke Xu, Yang Liu')).toBe(true);
  });

  it('leaves one person alone, including a credential tail', () => {
    expect(namesSeveralPeople('Daniel Rakita')).toBe(false);
    expect(namesSeveralPeople('James E Rothman')).toBe(false);
    expect(namesSeveralPeople('Micha Sam Brickman Raredon')).toBe(false);
    expect(namesSeveralPeople('Rakita, Daniel')).toBe(false);
    expect(namesSeveralPeople('')).toBe(false);
  });
});

describe('isSharedInstitutionalResourceUrl', () => {
  it('flags a core, a clinical service, and a facility', () => {
    for (const url of [
      'https://research.yale.edu/cores/pet',
      'https://medicine.yale.edu/labmed/clinical-service/molecular-diagnostics/',
      'https://medicine.yale.edu/biomedical-imaging-institute/core-facilities/mr-core/',
    ]) {
      expect(isSharedInstitutionalResourceUrl(url)).toBe(true);
    }
  });

  it("leaves Yale's per-lab namespace and a lab's own domain alone", () => {
    for (const url of [
      'https://medicine.yale.edu/lab/escobar-hoyos/',
      'https://apollo-lab-yale.github.io',
      'https://www.burdlab.net',
      'https://campuspress.yale.edu/karatekinlab/',
      'https://try.yale.edu',
    ]) {
      expect(isSharedInstitutionalResourceUrl(url)).toBe(false);
    }
  });

  it('keys on a whole path segment, not a substring', () => {
    expect(isSharedInstitutionalResourceUrl('https://medicine.yale.edu/lab/corestone/')).toBe(
      false,
    );
    expect(isSharedInstitutionalResourceUrl('https://example-lab.org/services/')).toBe(true);
  });

  it('is not a URL guard for a value that is not a URL', () => {
    expect(isSharedInstitutionalResourceUrl('lab website')).toBe(false);
  });
});

describe('resolveRetargetTarget', () => {
  it('picks the single LAB home over the faculty-research-area duplicate', () => {
    const target = resolveRetargetTarget([
      apolloHome,
      {
        slug: 'faculty-research-area-daniel-rakita',
        entityType: 'FACULTY_RESEARCH_AREA',
        leadName: 'Daniel Rakita',
      },
    ]);
    expect(target?.slug).toBe('rakita-lab-dr877');
  });

  it('refuses two LAB homes rather than choosing arbitrarily', () => {
    expect(
      resolveRetargetTarget([apolloHome, { ...apolloHome, slug: 'rakita-lab-second' }]),
    ).toBeNull();
  });

  it('takes a lone non-lab home when that is all there is', () => {
    const target = resolveRetargetTarget([
      { slug: 'faculty-research-area-x', entityType: 'FACULTY_RESEARCH_AREA' },
    ]);
    expect(target?.slug).toBe('faculty-research-area-x');
  });

  it('refuses when there is nothing to pick', () => {
    expect(resolveRetargetTarget([])).toBeNull();
  });
});

describe('isSynthesizedResearchHomeName', () => {
  it('treats a scraper-minted eponym as a placeholder the site name may replace', () => {
    expect(isSynthesizedResearchHomeName('Rakita Lab', 'Daniel Rakita')).toBe(true);
    expect(isSynthesizedResearchHomeName('Daniel Rakita Research', 'Daniel Rakita')).toBe(true);
    expect(isSynthesizedResearchHomeName('', 'Daniel Rakita')).toBe(true);
  });

  it('leaves a stated branded name alone', () => {
    expect(
      isSynthesizedResearchHomeName(
        'Applied Planning, Learning, and Optimization (APOLLO) Lab',
        'Daniel Rakita',
      ),
    ).toBe(false);
    expect(isSynthesizedResearchHomeName('Belief Lab', 'Joshua Kenney')).toBe(false);
  });

  it('does not call another person eponym a placeholder for this lead', () => {
    expect(isSynthesizedResearchHomeName('Micevic Lab', 'Simon Milette')).toBe(false);
  });
});

describe('adoptableRetargetedName', () => {
  it("adopts the lab site's own branded name over a synthesized eponym", () => {
    expect(
      adoptableRetargetedName({
        siteName: 'Applied Planning, Learning, and Optimization (APOLLO) Lab',
        target: apolloHome,
        websiteUrl: 'https://apollo-lab-yale.github.io',
      }),
    ).toBe('Applied Planning, Learning, and Optimization (APOLLO) Lab');
  });

  it('refuses an umbrella organization name even on the right record', () => {
    expect(
      adoptableRetargetedName({
        siteName: 'Yale Center for Customer Insights',
        target: apolloHome,
        websiteUrl: 'https://apollo-lab-yale.github.io',
      }),
    ).toBeUndefined();
  });

  it('leaves a target that already states its own name unrenamed', () => {
    expect(
      adoptableRetargetedName({
        siteName: 'Applied Planning, Learning, and Optimization (APOLLO) Lab',
        target: { ...apolloHome, name: 'Yale Robotics Collective' },
        websiteUrl: 'https://apollo-lab-yale.github.io',
      }),
    ).toBeUndefined();
  });
});

describe('decideForeignLabWebsiteRetarget', () => {
  const apolloCase = {
    holder: khannaHolder,
    websiteUrl: 'https://apollo-lab-yale.github.io',
    siteName: 'Applied Planning, Learning, and Optimization (APOLLO) Lab',
    declaredLead: 'Daniel Rakita',
    researchHomesByLead: [apolloHome],
  };

  it('re-homes the Apollo Lab site from the surgeon to the lab that declares him (#2385)', () => {
    expect(decideForeignLabWebsiteRetarget(apolloCase)).toEqual({
      action: 'RETARGET',
      targetSlug: 'rakita-lab-dr877',
      declaredLead: 'Daniel Rakita',
      adoptableName: 'Applied Planning, Learning, and Optimization (APOLLO) Lab',
    });
  });

  it("leaves a site that declares the holder's own lead where it is", () => {
    expect(
      decideForeignLabWebsiteRetarget({
        ...apolloCase,
        holder: { ...khannaHolder, leadName: 'Daniel Rakita' },
      }),
    ).toEqual({ action: 'KEEP_ON_HOLDER', declaredLead: 'Daniel Rakita' });
  });

  it("refuses an institutional site, whose declared lead is its chair rather than a lab's PI", () => {
    for (const siteName of [
      'Department of Pediatrics',
      'Yale Center for Clinical Investigation (YCCI)',
      'Center of Molecular and Cellular Oncology',
      'Reproductive and Placental Research Unit',
      'Program for Specialized Treatment Early in Psychosis (STEP)',
      'Magnetic Resonance Core',
      'The Education Collaboratory at Yale',
    ]) {
      expect(decideForeignLabWebsiteRetarget({ ...apolloCase, siteName })).toEqual({
        action: 'REFUSE',
        reason: 'SITE_IS_AN_AFFILIATED_ORGANIZATION',
      });
    }
  });

  it('still re-homes a site that reads as a lab, however topical its name', () => {
    for (const siteName of [
      'Applied Planning, Learning, and Optimization (APOLLO) Lab',
      'Pain and Addiction Interaction Neuroscience (PAIN) Lab',
    ]) {
      expect(decideForeignLabWebsiteRetarget({ ...apolloCase, siteName }).action).toBe('RETARGET');
    }
  });

  it("falls back to the holder's harvested name when the site states none", () => {
    expect(
      decideForeignLabWebsiteRetarget({
        ...apolloCase,
        siteName: '',
        holder: { ...khannaHolder, name: 'Yale Center for Clinical Investigation' },
      }),
    ).toEqual({ action: 'REFUSE', reason: 'SITE_IS_AN_AFFILIATED_ORGANIZATION' });
  });

  it('refuses a shared core, whose director does not own it the way a PI owns a lab', () => {
    expect(
      decideForeignLabWebsiteRetarget({
        ...apolloCase,
        websiteUrl: 'https://research.yale.edu/cores/pet',
        siteName: 'Positron Emission Tomography (PET)',
      }),
    ).toEqual({ action: 'REFUSE', reason: 'SITE_IS_A_SHARED_INSTITUTIONAL_RESOURCE' });
  });

  it('refuses a co-led site rather than handing it to one of the two', () => {
    expect(
      decideForeignLabWebsiteRetarget({
        ...apolloCase,
        declaredLead: 'Jeffrey A. Wickersham; Roman Shrestha',
      }),
    ).toEqual({ action: 'REFUSE', reason: 'DECLARED_LEAD_IS_SEVERAL_PEOPLE' });
  });

  it('refuses when the site states no lead, rather than guessing one', () => {
    expect(decideForeignLabWebsiteRetarget({ ...apolloCase, declaredLead: '' })).toEqual({
      action: 'REFUSE',
      reason: 'NO_DECLARED_LEAD',
    });
  });

  it('refuses an unresolved holder lead instead of falling back to slug tokens (#2384)', () => {
    expect(
      decideForeignLabWebsiteRetarget({
        ...apolloCase,
        holder: { ...khannaHolder, leadName: '' },
      }),
    ).toEqual({ action: 'REFUSE', reason: 'HOLDER_LEAD_UNRESOLVED' });
  });

  it('refuses a declared lead with no research home to move the site to', () => {
    expect(decideForeignLabWebsiteRetarget({ ...apolloCase, researchHomesByLead: [] })).toEqual({
      action: 'REFUSE',
      reason: 'DECLARED_LEAD_HAS_NO_RESEARCH_HOME',
    });
  });

  it('refuses a declared lead whose homes cannot be narrowed to one', () => {
    expect(
      decideForeignLabWebsiteRetarget({
        ...apolloCase,
        researchHomesByLead: [apolloHome, { ...apolloHome, slug: 'rakita-lab-second' }],
      }),
    ).toEqual({ action: 'REFUSE', reason: 'DECLARED_LEAD_AMBIGUOUS' });
  });

  it('never overwrites a website the target already states', () => {
    expect(
      decideForeignLabWebsiteRetarget({
        ...apolloCase,
        researchHomesByLead: [{ ...apolloHome, websiteUrl: 'https://dannyrakita.net' }],
      }),
    ).toEqual({ action: 'REFUSE', reason: 'TARGET_ALREADY_STATES_A_WEBSITE' });
  });

  it('treats a trailing-slash or www difference as the same website, not a conflict', () => {
    const decision = decideForeignLabWebsiteRetarget({
      ...apolloCase,
      researchHomesByLead: [{ ...apolloHome, websiteUrl: 'https://apollo-lab-yale.github.io/' }],
    });
    expect(decision.action).toBe('RETARGET');
  });

  it('refuses when the resolved target is the holder itself', () => {
    expect(
      decideForeignLabWebsiteRetarget({
        ...apolloCase,
        researchHomesByLead: [{ ...apolloHome, slug: 'ysm-faculty-amit-khanna' }],
      }),
    ).toEqual({ action: 'REFUSE', reason: 'TARGET_IS_THE_HOLDER' });
  });

  it('re-homes a trainee row to the PI whose lab site it links', () => {
    const decision = decideForeignLabWebsiteRetarget({
      holder: {
        slug: 'ysm-faculty-simon-milette',
        name: 'Micevic Lab',
        entityType: 'LAB',
        kind: 'lab',
        leadName: 'Simon Milette',
      },
      websiteUrl: 'https://miceviclab.github.io/home/',
      siteName: 'Micevic Lab',
      declaredLead: 'Goran Micevic',
      researchHomesByLead: [
        {
          slug: 'ysm-faculty-goran-micevic',
          name: 'Goran Micevic Faculty Research',
          entityType: 'LAB',
          kind: 'lab',
          leadName: 'Goran Micevic',
        },
      ],
    });
    expect(decision).toMatchObject({
      action: 'RETARGET',
      targetSlug: 'ysm-faculty-goran-micevic',
      adoptableName: 'Micevic Lab',
    });
  });
});
