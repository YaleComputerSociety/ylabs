import { describe, it, expect } from 'vitest';
import {
  claimsAnotherPersonsLab,
  classifyHarvestedResearchHomeName,
  stripResearchHomeNameLinkWrapper,
  corroboratedLabNameEponyms,
  entityKeyPersonTokens,
  eponymousLabNameSurname,
  isNonIdentifyingLinkLabelName,
  isPersonScopedResearchEntity,
  isUmbrellaOrganizationName,
} from '../researchHomeNameIdentityAuthority';

describe('isUmbrellaOrganizationName', () => {
  it('flags the umbrella organizations that were grafted onto people (#2234)', () => {
    for (const name of [
      'Yale Center for Customer Insights',
      'The Center for Industrial Ecology',
      'Center for Outcomes Research and Evaluation (CORE)',
      'Equity Research and Innovation Center',
      'Yale Measurement Based Care Collaborative',
      'Yale Pancreas Cancer Early Detection Clinic',
      'Alzheimer’s Disease Research Unit',
      'HPV Working Group',
      'PRIME Clinic',
      'Department of Pediatrics',
      'Yale School of Management',
      'The Cowles Foundation for Research in Economics',
      'Tropical Resources Institute',
      'Yale Viral Hepatitis Program',
      'Center for Cell and Molecular Imaging (CCMI)',
    ]) {
      expect(isUmbrellaOrganizationName(name), name).toBe(true);
    }
  });

  it('does not flag a genuine research home, including one that also reads clinical', () => {
    for (const name of [
      'The Yale GRAB Lab',
      'The Clinical Affective Neuroscience & Development Lab (CANDLab)',
      'Yale Rheumatology Clinical & Translational Research Laboratory',
      'Computational Biomechanics Laboratory',
      'Yale NLP Lab',
      'Social Robotics Lab',
      'Yale Cardiovascular Research Group',
      'Rivers Lab',
    ]) {
      expect(isUmbrellaOrganizationName(name), name).toBe(false);
    }
  });
});

describe('isNonIdentifyingLinkLabelName', () => {
  it('rejects a CMS link label that identifies nothing', () => {
    for (const label of ['Lab Website', 'Website', 'Lab Page', 'Personal Website', 'My Lab']) {
      expect(isNonIdentifyingLinkLabelName(label), label).toBe(true);
    }
  });

  it('keeps a real name that happens to contain a label-ish word', () => {
    expect(isNonIdentifyingLinkLabelName('Rivers Lab')).toBe(false);
    expect(isNonIdentifyingLinkLabelName('Yale Stress Center')).toBe(false);
  });
});

describe('eponymousLabNameSurname', () => {
  it('reads the single surname an eponymous lab name claims', () => {
    expect(eponymousLabNameSurname('The Liu Lab')).toBe('liu');
    expect(eponymousLabNameSurname('Kliman Laboratories')).toBe('kliman');
    expect(eponymousLabNameSurname('Xiong Laboratory')).toBe('xiong');
    expect(eponymousLabNameSurname('De Camilli Lab')).toBe('camilli');
    expect(eponymousLabNameSurname('Mu Lab')).toBe('mu');
  });

  it('is not an eponym when more than one word precedes the head noun', () => {
    expect(eponymousLabNameSurname('Computational Biomechanics Laboratory')).toBe('');
    expect(eponymousLabNameSurname('Yale NLP Lab')).toBe('');
    expect(eponymousLabNameSurname('Integrative Cardiac Biomechanics Lab')).toBe('');
  });
});

describe('corroboratedLabNameEponyms', () => {
  it('corroborates an eponym only from the URL path', () => {
    expect(
      corroboratedLabNameEponyms('The Liu Lab', 'https://medicine.example.edu/lab/jun-liu/'),
    ).toEqual(['liu']);
    expect(
      corroboratedLabNameEponyms(
        'Kliman Laboratories',
        'https://medicine.example.edu/obgyn/kliman/',
      ),
    ).toEqual(['kliman']);
  });

  it('never corroborates from the host, so a topical name whose host echoes it is left alone', () => {
    expect(corroboratedLabNameEponyms('Belief Lab', 'https://belieflab.example.edu/')).toEqual([]);
    expect(
      corroboratedLabNameEponyms('The Thinking Lab', 'https://thinkinglab.example.edu/'),
    ).toEqual([]);
  });
});

describe('entityKeyPersonTokens', () => {
  it('keeps person tokens and drops source and identifier tokens', () => {
    expect(entityKeyPersonTokens('ysm-faculty-huaxin-yu')).toEqual(['huaxin', 'yu']);
    expect(entityKeyPersonTokens('ysm-jun-liu')).toEqual(['jun', 'liu']);
  });

  it('yields nothing for an opaque grant-derived key so the eponym rule cannot fire on it', () => {
    expect(entityKeyPersonTokens('nsf-pi-67d891e550621bcef434811d')).toEqual([]);
  });
});

describe('classifyHarvestedResearchHomeName', () => {
  it('refuses an affiliated organization as a person identity', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'Equity Research and Innovation Center',
        personName: 'Tara Rizzo',
        websiteUrl: 'https://medicine.example.edu/eric/',
      }),
    ).toBe('AFFILIATED_ORGANIZATION');
  });

  it('refuses another person’s lab when the URL path corroborates whose lab it is', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'The Liu Lab',
        personName: 'Huaxin Yu',
        websiteUrl: 'https://medicine.example.edu/lab/jun-liu/',
      }),
    ).toBe('ANOTHER_PERSONS_LAB');
  });

  it('accepts an organization name that carries the person’s own name', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'Waxman Center for Neuroscience',
        personName: 'Stephen Waxman',
        websiteUrl: 'https://example.edu/waxman/',
      }),
    ).toBe('OWN_IDENTITY');
  });

  it('accepts a topical research home that is not an umbrella organization', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'The Yale GRAB Lab',
        personName: 'Aaron Dollar',
        websiteUrl: 'https://eng.example.edu/grablab/',
      }),
    ).toBe('OWN_IDENTITY');
  });

  it('reports a bare CMS link label separately from an affiliation', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'Lab Website',
        personName: 'Jordan Rivers',
        websiteUrl: 'https://medicine.example.edu/lab/rivers/',
      }),
    ).toBe('NON_IDENTIFYING_LABEL');
  });
});

describe('isPersonScopedResearchEntity', () => {
  it('treats labs and faculty research areas as person-scoped and centers as not', () => {
    expect(isPersonScopedResearchEntity({ entityType: 'LAB' })).toBe(true);
    expect(isPersonScopedResearchEntity({ entityType: 'FACULTY_RESEARCH_AREA' })).toBe(true);
    expect(isPersonScopedResearchEntity({ entityType: 'CENTER' })).toBe(false);
    expect(isPersonScopedResearchEntity({ entityType: 'CORE_FACILITY' })).toBe(false);
    expect(isPersonScopedResearchEntity({ kind: 'individual' })).toBe(true);
  });
});

describe('claimsAnotherPersonsLab', () => {
  it('tolerates a compressed initial-plus-surname eponym for the same person', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'XLiu Lab',
        websiteUrl: 'https://medicine.example.edu/lab/xliu/',
        identityTokens: ['xiaofeng', 'liu'],
      }),
    ).toBe(false);
  });

  it('still flags a genuinely different surname', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'The Liu Lab',
        websiteUrl: 'https://medicine.example.edu/lab/jun-liu/',
        identityTokens: ['huaxin', 'yu'],
      }),
    ).toBe(true);
  });

  it('cannot fire when the entity carries no person identity at all', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'The Liu Lab',
        websiteUrl: 'https://medicine.example.edu/lab/jun-liu/',
        identityTokens: [],
      }),
    ).toBe(false);
  });
});

describe('link-label names and wrappers (#2285)', () => {
  it('classifies a portfolio link label as non-identifying', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'Portfolio Website',
        personName: 'Imran Iqbal',
      }),
    ).toBe('NON_IDENTIFYING_LABEL');
  });

  it('classifies the name a wrapper wraps, not the wrapper', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'Link to Boggon Lab',
        personName: 'Titus Boggon',
      }),
    ).toBe('OWN_IDENTITY');
    expect(stripResearchHomeNameLinkWrapper('Link to Boggon Lab')).toBe('Boggon Lab');
    expect(stripResearchHomeNameLinkWrapper('Visit the Geha Research Group \u00bb')).toBe(
      'Geha Research Group',
    );
  });

  it('reduces a wrapper around nothing to a bare label rather than adopting it', () => {
    expect(
      classifyHarvestedResearchHomeName({ harvestedName: 'Link to Website', personName: 'Ada Lovelace' }),
    ).toBe('NON_IDENTIFYING_LABEL');
  });

  it('leaves a real name and a trailing markup fragment alone', () => {
    expect(stripResearchHomeNameLinkWrapper('Vanderlick Lab')).toBe('Vanderlick Lab');
    expect(stripResearchHomeNameLinkWrapper('Smith Lab <span class="title">')).toBe(
      'Smith Lab <span class="title">',
    );
  });
});
