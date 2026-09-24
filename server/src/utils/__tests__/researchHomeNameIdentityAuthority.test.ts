import { describe, it, expect } from 'vitest';
import {
  NO_SURNAME_ROSTER,
  bodySubjectOrganizationName,
  personScopedResearchEntityBodyDescribesAnotherOrganization,
  claimsAnotherPersonsLab,
  claimsAnotherPersonsLabByUrlPath,
  personScopedResearchEntityNameNamesSomethingElseByUrlPath,
  classifyHarvestedResearchHomeName,
  describesAffiliatedOrganization,
  stripResearchHomeNameLinkChrome,
  stripResearchHomeNameLinkWrapper,
  corroboratedLabNameEponyms,
  eponymousLabNameSurnameCandidates,
  entityKeyNamesOnlyThisPerson,
  entityKeyPersonTokens,
  eponymousLabNameSurname,
  isNonIdentifyingLinkLabelName,
  isPersonPageLinkLabelName,
  isBarePersonNameEntityName,
  isExternalScholarlyPlatformLinkLabelName,
  isPlaceholderEntityName,
  isPersonScopedResearchEntity,
  isUnrecoverablePersonScopedEntityName,
  personScopedResearchEntityNameFromPersonName,
  isUmbrellaOrganizationName,
  nameNamesACitedSharedAcademicHost,
  namesASelfDeclaredLaboratory,
  namesAServiceFacility,
  personIdentityTokens,
  personScopedResearchEntityNameNamesSomethingElse,
  personSurnamesFromDisplayNames,
  researchHomeIdentityTokens,
} from '../researchHomeNameIdentityAuthority';

describe('namesAServiceFacility', () => {
  it('flags a diagnostic, specimen or shared-instrumentation service', () => {
    for (const name of [
      'Yale Pathology Labs',
      'Hematology Tissue Bank',
      'Yale Autopsy Service',
      'Cytology Laboratory',
      'Emergency Medicine Specimen Biobank',
      'Keck Proteomics Resource',
      'Molecular Diagnostics Lab',
      'Clinical Virology Laboratory',
      'Biostatistics Shared Resource',
      'Chemical Metabolism Core',
    ]) {
      expect(namesAServiceFacility(name), name).toBe(true);
    }
  });

  it('does not flag a research lab named after the modality it studies', () => {
    for (const name of [
      'Developmental Electrophysiology Laboratory',
      'Chemical & Biomedical Imaging Lab',
      'Yale Behavioral Pharmacology Laboratory',
      'Cognitive and Neural Computation Lab',
      'Xiong Laboratory',
      'Yale Cardiovascular Research Group',
      '',
    ]) {
      expect(namesAServiceFacility(name), name).toBe(false);
    }
  });

  it('is what keeps a service out of namesASelfDeclaredLaboratory', () => {
    expect(namesASelfDeclaredLaboratory('Yale Pathology Labs')).toBe(false);
    expect(namesASelfDeclaredLaboratory('Cytology Laboratory')).toBe(false);
    expect(namesASelfDeclaredLaboratory('Developmental Electrophysiology Laboratory')).toBe(true);
  });
});

describe('namesASelfDeclaredLaboratory', () => {
  it('accepts a laboratory or research group, including one that also reads clinical', () => {
    for (const name of [
      'Cognitive and Neural Computation Lab',
      'Yale Rheumatology Clinical & Translational Research Laboratory',
      'Computational Biomechanics Laboratory',
      'Yale Cardiovascular Research Group',
      'The Yale GRAB Lab',
      'Rivers Lab',
    ]) {
      expect(namesASelfDeclaredLaboratory(name), name).toBe(true);
    }
  });

  it('refuses a name that may not become a person-scoped record identity either', () => {
    for (const name of [
      'Yale Center for Customer Insights',
      'Department of Pediatrics',
      'HPV Working Group',
      'Tropical Resources Institute',
      'Lab Website',
      'Research Page',
      'n/a',
      'Rivers Research',
      'Early Modern Manuscripts Project',
      '',
      null,
      undefined,
    ]) {
      expect(namesASelfDeclaredLaboratory(name), String(name)).toBe(false);
    }
  });
});

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
        knownPersonSurnames: NO_SURNAME_ROSTER,
      }),
    ).toBe('AFFILIATED_ORGANIZATION');
  });

  it('refuses another person’s lab when the URL path corroborates whose lab it is', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'The Liu Lab',
        personName: 'Huaxin Yu',
        websiteUrl: 'https://medicine.example.edu/lab/jun-liu/',
        knownPersonSurnames: NO_SURNAME_ROSTER,
      }),
    ).toBe('ANOTHER_PERSONS_LAB');
  });

  it('accepts an organization name that carries the person’s own name', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'Waxman Center for Neuroscience',
        personName: 'Stephen Waxman',
        websiteUrl: 'https://example.edu/waxman/',
        knownPersonSurnames: NO_SURNAME_ROSTER,
      }),
    ).toBe('OWN_IDENTITY');
  });

  it('accepts a topical research home that is not an umbrella organization', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'The Yale GRAB Lab',
        personName: 'Aaron Dollar',
        websiteUrl: 'https://eng.example.edu/grablab/',
        knownPersonSurnames: NO_SURNAME_ROSTER,
      }),
    ).toBe('OWN_IDENTITY');
  });

  it('reports a bare CMS link label separately from an affiliation', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'Lab Website',
        personName: 'Jordan Rivers',
        websiteUrl: 'https://medicine.example.edu/lab/rivers/',
        knownPersonSurnames: NO_SURNAME_ROSTER,
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
      claimsAnotherPersonsLabByUrlPath({
        harvestedName: 'XLiu Lab',
        websiteUrl: 'https://medicine.example.edu/lab/xliu/',
        identityTokens: ['xiaofeng', 'liu'],
      }),
    ).toBe(false);
  });

  it('still flags a genuinely different surname', () => {
    expect(
      claimsAnotherPersonsLabByUrlPath({
        harvestedName: 'The Liu Lab',
        websiteUrl: 'https://medicine.example.edu/lab/jun-liu/',
        identityTokens: ['huaxin', 'yu'],
      }),
    ).toBe(true);
  });

  it('cannot fire when the entity carries no person identity at all', () => {
    expect(
      claimsAnotherPersonsLabByUrlPath({
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
        knownPersonSurnames: NO_SURNAME_ROSTER,
      }),
    ).toBe('NON_IDENTIFYING_LABEL');
  });

  it('classifies the name a wrapper wraps, not the wrapper', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'Link to Boggon Lab',
        personName: 'Titus Boggon',
        knownPersonSurnames: NO_SURNAME_ROSTER,
      }),
    ).toBe('OWN_IDENTITY');
    expect(stripResearchHomeNameLinkWrapper('Link to Boggon Lab')).toBe('Boggon Lab');
    expect(stripResearchHomeNameLinkWrapper('Visit the Geha Research Group \u00bb')).toBe(
      'Geha Research Group',
    );
  });

  it('reduces a wrapper around nothing to a bare label rather than adopting it', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'Link to Website',
        personName: 'Ada Lovelace',
        knownPersonSurnames: NO_SURNAME_ROSTER,
      }),
    ).toBe('NON_IDENTIFYING_LABEL');
  });

  it('leaves a real name and a trailing markup fragment alone', () => {
    expect(stripResearchHomeNameLinkWrapper('Vanderlick Lab')).toBe('Vanderlick Lab');
    expect(stripResearchHomeNameLinkWrapper('Smith Lab <span class="title">')).toBe(
      'Smith Lab <span class="title">',
    );
  });
});

describe('possessive lab names', () => {
  const roster = new Set(['vandermolen', 'castellano']);

  it('reads the eponym through a trailing possessive', () => {
    expect(eponymousLabNameSurnameCandidates("Vandermolen's Lab")).toEqual(['vandermolen']);
    expect(
      corroboratedLabNameEponyms(
        "Vandermolen's Lab",
        'https://medicine.example.edu/lab/vandermolen/',
      ),
    ).toEqual(['vandermolen']);
  });

  it('refuses a possessive naming somebody other than the record subject', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: "Vandermolen's Lab",
        websiteUrl: 'https://medicine.example.edu/lab/vandermolen/',
        identityTokens: personIdentityTokens('Priya Raghunathan'),
        knownPersonSurnames: roster,
      }),
    ).toBe(true);
  });

  it('refuses a possessive that follows a full name rather than a bare surname', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: "Aurelio T Castellano' lab",
        websiteUrl: 'https://medicine.example.edu/lab/castellano/',
        identityTokens: personIdentityTokens('Mei-Lin Fairbrother'),
        knownPersonSurnames: roster,
      }),
    ).toBe(true);
  });

  it("keeps a subject's own lab named possessively", () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: "Lena Vandermolen's laboratory",
        websiteUrl: 'https://medicine.example.edu/lab/vandermolen/',
        identityTokens: personIdentityTokens('Lena Vandermolen'),
        knownPersonSurnames: roster,
      }),
    ).toBe(false);
  });

  it('leaves an interior apostrophe in the surname intact', () => {
    expect(eponymousLabNameSurnameCandidates("O'Brannigan Lab")).toEqual(["o'brannigan"]);
  });

  it('reads a curly possessive the same as a straight one', () => {
    expect(eponymousLabNameSurnameCandidates('Vandermolen\u2019s Lab')).toEqual(['vandermolen']);
    expect(eponymousLabNameSurnameCandidates('Aurelio T Castellano\u2019 lab')).toEqual([
      'castellano',
    ]);
  });

  it('reads a bare possessive apostrophe carrying no s', () => {
    expect(eponymousLabNameSurnameCandidates("Vandermolen' Lab")).toEqual(['vandermolen']);
  });

  it('does not read a disease eponym as a person claiming ownership', () => {
    for (const name of [
      "Alzheimer's Disease Research Center",
      'Alzheimer\u2019s Disease Research Center',
      "Parkinson's Disease Research Group",
    ]) {
      expect(eponymousLabNameSurnameCandidates(name), name).toEqual([]);
    }
  });

  it('does not turn a topical name into an eponym via the possessive arm', () => {
    expect(eponymousLabNameSurnameCandidates('Computational Biomechanics Laboratory')).toEqual([]);
    expect(eponymousLabNameSurnameCandidates('Yale NLP Lab')).toEqual([]);
  });
});

describe('nobiliary-particle surnames (#2285)', () => {
  it('corroborates the URL spelling of a particle surname', () => {
    expect(eponymousLabNameSurnameCandidates('De Camilli Lab')).toEqual(['camilli', 'decamilli']);
    expect(
      corroboratedLabNameEponyms('De Camilli Lab', 'https://medicine.example.edu/lab/decamilli/'),
    ).toEqual(['decamilli']);
  });

  it('flags a particle surname claimed on another person row', () => {
    expect(
      claimsAnotherPersonsLabByUrlPath({
        harvestedName: 'De Camilli Lab',
        websiteUrl: 'https://medicine.example.edu/lab/decamilli/',
        identityTokens: ['hongyan', 'hao'],
      }),
    ).toBe(true);
  });

  it('leaves the eponym holder own row alone', () => {
    expect(
      claimsAnotherPersonsLabByUrlPath({
        harvestedName: 'De Camilli Lab',
        websiteUrl: 'https://medicine.example.edu/lab/decamilli/',
        identityTokens: ['pietro', 'decamilli'],
      }),
    ).toBe(false);
  });

  it('does not widen the rule to a topical name whose host echoes it', () => {
    expect(corroboratedLabNameEponyms('Belief Lab', 'https://belieflab.example.edu/')).toEqual([]);
  });
});

describe('personScopedResearchEntityNameNamesSomethingElse', () => {
  const duguay = {
    entityType: 'FACULTY_RESEARCH_AREA',
    kind: 'individual',
    slug: 'dept-econ-raphael-duguay',
  };

  it('refuses the affiliation line a person site led with (#2351)', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElseByUrlPath({
        ...duguay,
        candidateName: 'Yale School of Management',
      }),
    ).toBe(true);
  });

  it('keeps the record own name', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElseByUrlPath({
        ...duguay,
        candidateName: 'Raphael Duguay Faculty Research',
      }),
    ).toBe(false);
  });

  it('keeps an organization name that carries the person own identity', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElseByUrlPath({
        entityType: 'LAB',
        slug: 'dept-earth-planetary-sciences-alan-rooney',
        candidateName: 'Rooney Center for Metal Geochemistry',
      }),
    ).toBe(false);
  });

  it('refuses another person lab corroborated by the page it came from', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElseByUrlPath({
        entityType: 'FACULTY_RESEARCH_AREA',
        slug: 'ysm-faculty-huaxin-yu',
        candidateName: 'The Liu Lab',
        websiteUrl: 'https://medicine.example.edu/lab/liu/',
      }),
    ).toBe(true);
  });

  it('leaves an organization-shaped record own organization name alone', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElseByUrlPath({
        entityType: 'CENTER',
        kind: 'center',
        slug: 'center-customer-insights',
        candidateName: 'Yale Center for Customer Insights',
      }),
    ).toBe(false);
  });

  it('refuses an umbrella organization that only shares a topical word with the slug', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElseByUrlPath({
        entityType: 'LAB',
        slug: 'cancer-research-lab',
        candidateName: 'Yale Cancer Center',
      }),
    ).toBe(true);
  });

  it('refuses an umbrella organization whose topical word trails the head noun', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElseByUrlPath({
        entityType: 'LAB',
        slug: 'aging-lab',
        candidateName: 'Yale Center on Aging',
      }),
    ).toBe(true);
  });

  it('uses the lead person name over the slug when one is known', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElseByUrlPath({
        entityType: 'LAB',
        slug: 'nih-pi-a1b2c3',
        personName: 'Erica Herzog',
        candidateName: 'Herzog Research Program',
      }),
    ).toBe(false);
  });
});

describe('isPlaceholderEntityName', () => {
  // The whole point of a separate predicate: `nameWords` splits on
  // non-alphanumerics, so these reduce to ['n','a'] and the link-label check can
  // never reject them however many placeholder tokens that word set gains (#2367).
  it('rejects a punctuated placeholder that word-splitting cannot catch', () => {
    for (const value of ['n/a', 'N/A', 'N / A', 'n.a.', '- -', '???']) {
      expect(isPlaceholderEntityName(value)).toBe(true);
      expect(isNonIdentifyingLinkLabelName(value)).toBe(false);
    }
  });

  it('rejects single-word filler a source emitted in place of a name', () => {
    for (const value of [
      'none',
      'None',
      'null',
      'unknown',
      'Unnamed',
      'untitled',
      'TBD',
      'to be determined',
      'not applicable',
      'placeholder',
    ]) {
      expect(isPlaceholderEntityName(value)).toBe(true);
    }
  });

  it('keeps a real name that merely contains a placeholder word', () => {
    for (const value of [
      'Unknown Pathogens Laboratory',
      'None So Blind Reading Group',
      'Null Hypothesis Lab',
      'Test Tube Research Group',
      'Loyal Lab',
    ]) {
      expect(isPlaceholderEntityName(value)).toBe(false);
    }
  });

  // Absence is a different failure from filler, and `name` is `required` on the
  // schema with 0 records storing an empty one, so this predicate deliberately
  // does not claim it.
  it('treats an absent or blank name as not-a-placeholder', () => {
    for (const value of [undefined, null, '', '   ']) {
      expect(isPlaceholderEntityName(value)).toBe(false);
    }
  });
});

describe('personSurnamesFromDisplayNames', () => {
  it('keeps the surname each display name ends on', () => {
    expect(
      personSurnamesFromDisplayNames(['Monika Sharma', 'Clemens R. Scherzer', 'Daniel F. Levey']),
    ).toEqual(new Set(['sharma', 'scherzer', 'levey']));
  });

  it('ignores credential and honorific tails so they never read as surnames', () => {
    const surnames = personSurnamesFromDisplayNames(['Amit Khanna, MD', 'Dr. Jing Hughes, PhD']);
    expect(surnames.has('khanna')).toBe(true);
    expect(surnames.has('hughes')).toBe(true);
    expect(surnames.has('md')).toBe(false);
    expect(surnames.has('phd')).toBe(false);
  });

  it('skips a display name with no usable token', () => {
    expect(personSurnamesFromDisplayNames(['', '  ', 'Dr', 42, null])).toEqual(new Set());
  });

  it('keeps a two-letter surname rather than recording the given name instead', () => {
    const surnames = personSurnamesFromDisplayNames(['Sheng Wu', 'Ling Xu']);
    expect(surnames).toEqual(new Set(['wu', 'xu']));
  });

  it('drops a single-letter initial so it never stands in as a surname', () => {
    expect(personSurnamesFromDisplayNames(['Avery Sloan H'])).toEqual(new Set(['sloan']));
  });

  it('peels a comma-delimited credential clause the same way normalizeName does', () => {
    expect(
      personSurnamesFromDisplayNames([
        'Avery Sloan, MS',
        'Rohan Vasquez, JD',
        'Dana Whitfield, EdD',
        'Ms. Jane Kim',
        'Priya Raghunathan, MA',
      ]),
    ).toEqual(new Set(['sloan', 'vasquez', 'whitfield', 'kim', 'raghunathan']));
  });

  it('keeps a two-letter surname that reads like a credential when no clause delimits it', () => {
    expect(personSurnamesFromDisplayNames(['Jing Ma'])).toEqual(new Set(['ma']));
  });
});

describe('a credential recorded as a surname would corrupt the roster (#2361)', () => {
  const roster = personSurnamesFromDisplayNames(['Avery Sloan, MS', 'Patrick Cudahy']);

  it('leaves a topical name that collides with the credential alone', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'MS Lab',
        websiteUrl: 'https://mslab.example.org/home',
        identityTokens: ['patrick', 'cudahy'],
        knownPersonSurnames: roster,
      }),
    ).toBe(false);
  });

  it('still refuses the surname that clause was hiding', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'Sloan Lab',
        websiteUrl: 'https://sloanlab.example.org/home',
        identityTokens: ['patrick', 'cudahy'],
        knownPersonSurnames: roster,
      }),
    ).toBe(true);
  });
});

// A trainee's PI's lab sits on its own eponymous host with a bare or generic
// path, so the path rule sees no surname and the roster is the only corroboration
// available (#2361).
describe('claimsAnotherPersonsLab corroborated by a surname roster', () => {
  const roster = new Set(['girgenti', 'scherzer', 'verhaak', 'cohen', 'sharma', 'sliby']);

  it('flags a foreign eponymous lab whose surname only shows up in the host', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'Girgenti Lab',
        websiteUrl: 'https://www.girgentilab.org/home',
        identityTokens: ['alexa', 'sliby'],
        knownPersonSurnames: roster,
      }),
    ).toBe(true);
  });

  it('flags a foreign eponymous lab whose site path is generic', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'Scherzer Lab',
        websiteUrl: 'https://www.scherzerlaboratory.org/index.html',
        identityTokens: ['monika', 'sharma'],
        knownPersonSurnames: roster,
      }),
    ).toBe(true);
  });

  it('leaves the eponym holder own row alone', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'Scherzer Lab',
        websiteUrl: 'https://www.scherzerlaboratory.org/index.html',
        identityTokens: ['clemens', 'scherzer'],
        knownPersonSurnames: roster,
      }),
    ).toBe(false);
  });

  it('leaves a topical name alone however its host reads', () => {
    for (const [name, url] of [
      ['Belief Lab', 'https://belieflab.example.edu/'],
      ['The UPLiFT Lab', 'https://theupliftlab.example.com/'],
      ['CMB Lab', 'https://www.cmblab.example.org'],
    ]) {
      expect(
        claimsAnotherPersonsLab({
          harvestedName: name,
          websiteUrl: url,
          identityTokens: ['joshua', 'kenney'],
          knownPersonSurnames: roster,
        }),
      ).toBe(false);
    }
  });

  it('stays path-only when no roster is supplied', () => {
    expect(
      claimsAnotherPersonsLabByUrlPath({
        harvestedName: 'Girgenti Lab',
        websiteUrl: 'https://www.girgentilab.org/home',
        identityTokens: ['alexa', 'sliby'],
      }),
    ).toBe(false);
  });

  it('flags a two-letter foreign surname the roster knows', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'Wu Lab',
        websiteUrl: 'https://www.wulab.example.org/home',
        identityTokens: ['alexa', 'sliby'],
        knownPersonSurnames: personSurnamesFromDisplayNames(['Sheng Wu', 'Alexa Sliby']),
      }),
    ).toBe(true);
  });

  it('leaves a two-letter eponym holder own row alone', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'Wu Lab',
        websiteUrl: 'https://www.wulab.example.org/home',
        identityTokens: ['sheng', 'wu'],
        knownPersonSurnames: personSurnamesFromDisplayNames(['Sheng Wu']),
      }),
    ).toBe(false);
  });

  it('still flags a path-corroborated foreign eponym the roster has never heard of', () => {
    expect(roster.has('okonkwo')).toBe(false);
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'Okonkwo Lab',
        websiteUrl: 'https://medicine.example.edu/lab/okonkwo/',
        identityTokens: ['patrick', 'cudahy'],
        knownPersonSurnames: roster,
      }),
    ).toBe(true);
  });

  it('lets the path clear the eponym holder own row even against a roster', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'Cohen Lab',
        websiteUrl: 'https://medicine.example.edu/lab/cohen/',
        identityTokens: ['tara', 'cohen'],
        knownPersonSurnames: roster,
      }),
    ).toBe(false);
  });
});

describe('classifyHarvestedResearchHomeName with lab-slot evidence', () => {
  it('reads a slot describing a collaborative as an affiliation, not a lab', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'APOLLO LAB, Northgate University',
        personName: 'Rohan Vasquez',
        websiteUrl: 'https://apollo-lab-northgate.github.io',
        harvestedDescription: 'Applied Learning AI, Robotics AI Northgate Surgery Collaborative',
        knownPersonSurnames: NO_SURNAME_ROSTER,
      }),
    ).toBe('AFFILIATED_ORGANIZATION');
  });

  it('adopts the same name when the slot carries no organizational blurb', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'APOLLO LAB, Northgate University',
        personName: 'Rohan Vasquez',
        websiteUrl: 'https://apollo-lab-northgate.github.io',
        knownPersonSurnames: NO_SURNAME_ROSTER,
      }),
    ).toBe('OWN_IDENTITY');
  });

  it('keeps a lab whose blurb merely names its host organization', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'HAIR Lab',
        personName: 'Amanda Trelling',
        websiteUrl: 'https://medicine.example.edu/childstudy/collaborative-labs/',
        harvestedDescription: 'The lab is part of the Northgate Child Study Center',
        knownPersonSurnames: NO_SURNAME_ROSTER,
      }),
    ).toBe('OWN_IDENTITY');
  });

  it('refuses a foreign eponymous lab once the roster corroborates the surname', () => {
    expect(
      classifyHarvestedResearchHomeName({
        harvestedName: 'Scherzer Lab',
        personName: 'Monika Sharma',
        websiteUrl: 'https://www.scherzerlaboratory.org/index.html',
        knownPersonSurnames: new Set(['scherzer', 'sharma']),
      }),
    ).toBe('ANOTHER_PERSONS_LAB');
  });

  it('keeps a lab whose blurb only mentions an organization in passing', () => {
    for (const blurb of [
      'Research in the Department of Psychiatry on adolescent sleep',
      'We study immune signaling with the Section of Rheumatology and clinical partners',
      'Studies of memory run in collaboration with the Yale Center for Brain Imaging',
    ]) {
      expect(
        classifyHarvestedResearchHomeName({
          harvestedName: 'HAIR Lab',
          personName: 'Amanda Trelling',
          websiteUrl: 'https://www.hairlab.example.org/',
          harvestedDescription: blurb,
          knownPersonSurnames: NO_SURNAME_ROSTER,
        }),
      ).toBe('OWN_IDENTITY');
    }
  });
});

describe('describesAffiliatedOrganization', () => {
  it('flags a blurb that names what it links as an organization', () => {
    for (const blurb of [
      'Applied Learning AI, Robotics AI Northgate Surgery Collaborative',
      'Northgate Pediatric Sleep Consortium.',
      'A multi-site cardiometabolic registry',
    ]) {
      expect(describesAffiliatedOrganization(blurb)).toBe(true);
    }
  });

  it('does not flag a blurb that merely mentions an organization', () => {
    for (const blurb of [
      'Research in the Department of Psychiatry on adolescent sleep',
      'Yale Center for Brain Imaging collaborators contribute the scanning time',
      'The lab is part of the Northgate Child Study Center',
      '',
      undefined,
    ]) {
      expect(describesAffiliatedOrganization(blurb)).toBe(false);
    }
  });

  // A mention can fall at the end of the blurb too, so trailing position alone reads
  // "where this lab sits" as "what this slot links" and costs a genuine lab its name,
  // type, and website. A locative lead-in is what tells the two apart (#2368).
  it('does not flag a trailing organization a locative lead-in introduces', () => {
    for (const blurb of [
      'Clinical research at Northgate Children’s Hospital',
      'Translational immunology within the Northgate Cancer Center',
      'Sleep and circadian studies based in the Psychiatry Department',
      'A cardiometabolic cohort run by the Northgate Pediatric Sleep Consortium',
    ]) {
      expect(describesAffiliatedOrganization(blurb)).toBe(false);
    }
  });

  it('still flags a declaration whose preposition sits in an earlier clause', () => {
    for (const blurb of [
      'Sleep research in adolescents, the Northgate Pediatric Sleep Consortium',
      'Applied Learning AI, hosted at Northgate, Robotics AI Surgery Collaborative',
    ]) {
      expect(describesAffiliatedOrganization(blurb)).toBe(true);
    }
  });
});

// The graft that writes the name writes the type in the same batch, so judging the
// name on `entityType` alone lets a graft disable the guard that would refuse it.
describe('a grafted entityType does not shield the name it arrived with (#2913)', () => {
  const roster = new Set(['fiellin', 'rooney']);
  const grafted = {
    candidateName: 'Program in Addiction Medicine',
    entityType: 'INITIATIVE',
    kind: 'initiative',
    slug: 'ysm-faculty-david-fiellin',
    personName: 'David Fiellin',
    knownPersonSurnames: roster,
  };

  it('refuses an organization name on a record whose key names nobody but its lead', () => {
    expect(personScopedResearchEntityNameNamesSomethingElse(grafted)).toBe(true);
  });

  it('still refuses it when the graft also rewrote the type to CENTER', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElse({
        ...grafted,
        candidateName: 'Yale Cancer Center',
        entityType: 'CENTER',
        kind: 'center',
      }),
    ).toBe(true);
  });

  it('reads a compressed key spelling as the same person', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElse({
        ...grafted,
        candidateName: 'Yale Cancer Center',
        entityType: 'CENTER',
        slug: 'ysm-faculty-redelson',
        personName: 'Richard L Edelson',
        knownPersonSurnames: new Set(['edelson']),
      }),
    ).toBe(true);
  });

  it('leaves an organization-keyed record own name alone even when its director shares a key token', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElse({
        candidateName: 'Rooney Center for Metal Geochemistry',
        entityType: 'CENTER',
        kind: 'center',
        slug: 'rooney-center-for-metal-geochemistry',
        personName: 'Alan Rooney',
        knownPersonSurnames: roster,
      }),
    ).toBe(false);
  });

  it('leaves the record own correctly derived name alone', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElse({
        ...grafted,
        candidateName: 'David Fiellin Faculty Research',
      }),
    ).toBe(false);
  });
});

describe('entityKeyNamesOnlyThisPerson', () => {
  it('accepts a key built from the lead given and family name', () => {
    expect(
      entityKeyNamesOnlyThisPerson({
        slug: 'faculty-research-area-irina-esterlis',
        personName: 'Irina Esterlis',
      }),
    ).toBe(true);
  });

  it('accepts a key that glues an initial onto the surname', () => {
    expect(
      entityKeyNamesOnlyThisPerson({ slug: 'ysm-faculty-redelson', personName: 'Richard Edelson' }),
    ).toBe(true);
  });

  it('refuses a key carrying a word the lead name does not account for', () => {
    expect(
      entityKeyNamesOnlyThisPerson({
        slug: 'rooney-center-for-metal-geochemistry',
        personName: 'Alan Rooney',
      }),
    ).toBe(false);
  });

  it('refuses an organization key that names no person at all', () => {
    expect(
      entityKeyNamesOnlyThisPerson({ slug: 'center-yale-cancer-center', personName: 'Eric Winer' }),
    ).toBe(false);
  });

  it('refuses when no lead is known, so a caller without one keeps the type-only judgement', () => {
    expect(entityKeyNamesOnlyThisPerson({ slug: 'ysm-faculty-david-fiellin' })).toBe(false);
  });
});

describe('personScopedResearchEntityNameNamesSomethingElse forwards the surname roster', () => {
  const storedGraft = {
    candidateName: 'Girgenti Lab',
    entityType: 'LAB',
    slug: 'ysm-faculty-alexa-sliby',
    personName: 'Alexa Sliby',
    websiteUrl: 'https://www.girgentilab.example.org/home',
  };

  it('refuses a stored foreign eponym on a generic path once the roster is supplied', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElse({
        ...storedGraft,
        knownPersonSurnames: new Set(['girgenti', 'sliby']),
      }),
    ).toBe(true);
  });

  it('stays path-only without a roster', () => {
    expect(personScopedResearchEntityNameNamesSomethingElseByUrlPath(storedGraft)).toBe(false);
  });

  it('leaves the eponym holder own stored name alone', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElse({
        ...storedGraft,
        slug: 'ysm-faculty-matthew-girgenti',
        personName: 'Matthew Girgenti',
        knownPersonSurnames: new Set(['girgenti', 'sliby']),
      }),
    ).toBe(false);
  });
});

// A surname roster contains chairs, directors and deans, so an institutional page's
// declared lead is a real person whose surname corroborates. That is a FALSE-NEGATIVE
// path: the eponym check concludes "corroborated, therefore their own lab" and stops
// refusing. Worse than a false positive, which withholds a name visibly. Constructed
// rather than drawn from observed rows, because observed rows assert today's corpus.
describe('roster corroboration does not authenticate an institutional lead (#2361)', () => {
  const roster = new Set(['brownlee', 'sloan', 'kestrel']);

  it('still refuses a departmental site named for its chair, not the record holder', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'Brownlee Lab',
        websiteUrl: 'https://medicine.example.edu/pediatrics/',
        identityTokens: ['avery', 'sloan'],
        knownPersonSurnames: roster,
      }),
    ).toBe(true);
  });

  it('does not let a roster surname in the URL path clear a name it does not match', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'Brownlee Lab',
        websiteUrl: 'https://medicine.example.edu/about/kestrel/',
        identityTokens: ['avery', 'sloan'],
        knownPersonSurnames: roster,
      }),
    ).toBe(true);
  });
});

// Half the live refusals ran on the slug-token fallback rather than a resolved lead
// name, and a slug glues the head noun onto the surname (`ysm-leveylab`), so the
// eponym check has to read the surname out of the compound or it renames a record
// whose name was right (#2368).
describe('roster corroboration reads a surname out of a slug compound (#2361)', () => {
  const roster = new Set(['levey', 'scherzer']);
  const eponymHolderOwnLab = {
    harvestedName: 'Levey Lab',
    websiteUrl: 'https://medicine.example.edu/lab/leveylab/',
    knownPersonSurnames: roster,
  };

  it('spares the holder own lab when the lead name is resolved', () => {
    expect(
      claimsAnotherPersonsLab({ ...eponymHolderOwnLab, identityTokens: ['daniel', 'levey'] }),
    ).toBe(false);
  });

  it('spares it on slug tokens alone too', () => {
    expect(claimsAnotherPersonsLab({ ...eponymHolderOwnLab, identityTokens: ['leveylab'] })).toBe(
      false,
    );
  });

  it('spares the stored name of a lead-less record whose slug is the compound', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElse({
        candidateName: 'Levey Lab',
        entityType: 'LAB',
        slug: 'ysm-leveylab',
        websiteUrl: 'https://medicine.example.edu/lab/leveylab/',
        knownPersonSurnames: roster,
      }),
    ).toBe(false);
  });

  it('still refuses a foreign eponym the slug compound does not name', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'Scherzer Lab',
        websiteUrl: 'https://www.scherzerlaboratory.org/index.html',
        identityTokens: ['leveylab'],
        knownPersonSurnames: roster,
      }),
    ).toBe(true);
  });
});

// Roster corroboration is only safe where the identity it compares against is
// complete. Both halves below were measured as live false refusals on Development
// when one identity source was preferred over the other instead of unioned (#2369).
describe('the lead name and the record key are both identity (#2369)', () => {
  it('unions the lead tokens with the key tokens', () => {
    expect(
      researchHomeIdentityTokens({ personName: 'Mei Lin', slug: 'ysm-meilin' }).sort(),
    ).toEqual(['lin', 'mei', 'meilin']);
  });

  it('spares a record own lab when only the key spells the surname', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElse({
        candidateName: 'Meunier Laboratory',
        entityType: 'LAB',
        slug: 'ysm-cmeunier',
        personName: 'Camille',
        websiteUrl: 'https://medicine.example.edu/about/a-to-z-index/lab-websites/',
        knownPersonSurnames: new Set(['meunier']),
      }),
    ).toBe(false);
  });

  it('spares a record own lab when only the lead spells the surname', () => {
    const ownBareEponymousHost = {
      candidateName: 'Ferreira Lab',
      entityType: 'LAB',
      slug: 'ysm-faculty-nadia-braga',
      websiteUrl: 'https://www.ferreiralab.example.com/',
      knownPersonSurnames: new Set(['ferreira', 'braga']),
    };
    expect(
      personScopedResearchEntityNameNamesSomethingElse({
        ...ownBareEponymousHost,
        personName: 'Nadia B. Ferreira',
      }),
    ).toBe(false);
    expect(personScopedResearchEntityNameNamesSomethingElse(ownBareEponymousHost)).toBe(true);
  });

  it('still refuses a foreign eponym neither the lead nor the key names', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElse({
        candidateName: 'Okonkwo Lab',
        entityType: 'LAB',
        slug: 'ysm-faculty-priya-raman',
        personName: 'Priya Raman',
        websiteUrl: 'https://medicine.example.edu/profile/priya-raman/',
        knownPersonSurnames: new Set(['okonkwo', 'raman']),
      }),
    ).toBe(true);
  });
});

// The roster arm's precision is a property of the roster, not of the rule: a topical
// name whose eponym-position token happens to be somebody's surname IS refused. Pinned
// so the next reader of a measured zero does not conclude the rule prevents collisions
// (#2369). The defense is complete identity tokens, not a thinner roster: the surnames
// that collide with ordinary words include real Yale surnames functioning as surnames,
// so removing them would cost genuine refusals.
describe('a topical name colliding with a roster surname is refused (#2369)', () => {
  it('refuses "Belief Lab" when the roster happens to carry the collision', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'Belief Lab',
        websiteUrl: 'https://www.belieflab.example.org/',
        identityTokens: ['avery', 'sloan'],
        knownPersonSurnames: new Set(['belief', 'sloan']),
      }),
    ).toBe(true);
  });

  it('leaves it alone when the roster does not carry the collision', () => {
    expect(
      claimsAnotherPersonsLab({
        harvestedName: 'Belief Lab',
        websiteUrl: 'https://www.belieflab.example.org/',
        identityTokens: ['avery', 'sloan'],
        knownPersonSurnames: new Set(['sloan']),
      }),
    ).toBe(false);
  });
});

describe('link chrome on a harvested research-home name (#2752)', () => {
  it('strips trailing chrome when a real name survives underneath', () => {
    const cases: Array<[string, string]> = [
      ['Patel Lab Website', 'Patel Lab'],
      ['Crews Laboratory Homepage', 'Crews Laboratory'],
      ['Chen Lab Page', 'Chen Lab'],
      ['Zhi Group Web Page', 'Zhi Group'],
      ['Soll Lab site', 'Soll Lab'],
      ['The Berro lab website', 'The Berro lab'],
      ['Yale Cancer Center homepage', 'Yale Cancer Center'],
    ];
    for (const [input, expected] of cases) {
      expect(stripResearchHomeNameLinkChrome(input), input).toBe(expected);
    }
  });

  it('leaves a name carrying no chrome untouched', () => {
    for (const name of [
      'Cognitive and Neural Computation Lab',
      'Hepar Lab',
      'Xiong Laboratory',
      'Yale Cardiovascular Research Group',
      'BrainWorks',
    ]) {
      expect(stripResearchHomeNameLinkChrome(name), name).toBe(name);
    }
  });

  it('does not reduce a person page label to a bare surname', () => {
    for (const name of ['Zucker Homepage', 'Bewersdorf Homepage', 'Warren Research Website']) {
      expect(stripResearchHomeNameLinkChrome(name), name).toBe(name);
    }
  });

  it('refuses the anchor text of a link to a person own page', () => {
    for (const name of [
      'Zucker Homepage',
      'Bewersdorf Homepage',
      'Ellman Homepage',
      'Mc Carthy Homepage',
      'Warren Research Website',
    ]) {
      expect(isPersonPageLinkLabelName(name), name).toBe(true);
    }
  });

  it('does not refuse a name that identifies a research home, with or without chrome', () => {
    for (const name of [
      'Patel Lab Website',
      'Crews Laboratory Homepage',
      'Cognitive and Neural Computation Lab',
      'Hepar Lab',
      'Yale Cancer Center',
      '',
    ]) {
      expect(isPersonPageLinkLabelName(name), name).toBe(false);
    }
  });

  it('keeps a person page label out of namesASelfDeclaredLaboratory', () => {
    expect(namesASelfDeclaredLaboratory('Zucker Homepage')).toBe(false);
    expect(namesASelfDeclaredLaboratory('Patel Lab Website')).toBe(true);
  });
});

describe('isExternalScholarlyPlatformLinkLabelName', () => {
  it('refuses a platform brand standing alone', () => {
    for (const name of ['Google Scholar', 'ORCID', 'ResearchGate', 'the google scholar']) {
      expect(isExternalScholarlyPlatformLinkLabelName(name), name).toBe(true);
    }
  });

  // The manufactured shape. No page emits it: measured over 15,273 stored name and
  // displayName observations on Development, zero carry a suffixed brand, while 2
  // stored documents do, so the value is produced downstream of ingest (#2285).
  it('refuses a platform brand wearing a research-home head noun', () => {
    for (const name of [
      'Google Scholar Lab',
      'Google Scholar Laboratory',
      'ORCID Faculty Research',
      'ResearchGate Group',
      'Semantic Scholar Research',
    ]) {
      expect(isExternalScholarlyPlatformLinkLabelName(name), name).toBe(true);
    }
  });

  // The other furniture a profile's links section hangs off the brand. One extra
  // word must not buy the label a place on a card: "Google Scholar Profile" is the
  // same link label as "Google Scholar", and the derivation would otherwise take it
  // for a person name and manufacture "Google Scholar Profile Lab" out of it.
  it('refuses a platform brand wearing page furniture', () => {
    for (const name of [
      'Google Scholar Profile',
      'ORCID Profile',
      'Google Scholar Citations',
      'Google Scholar Publications',
      'Google Scholar Research Group',
      'Google Scholar Lab Website',
      'LinkedIn Page',
    ]) {
      expect(isExternalScholarlyPlatformLinkLabelName(name), name).toBe(true);
    }
  });

  // The boundary the exact-match vocabulary was chosen for: a name that merely
  // CONTAINS a brand is usually a real research home saying where its output lives,
  // so the whole brand must survive stripping a trailing run of furniture words.
  it('leaves a real name that contains a brand alone', () => {
    for (const name of [
      'Onofrey Lab GitHub',
      'Google Scholar Prize Lecture Series',
      'Scholar Lab',
      'Yale Scholar Research Group',
      'Yale Scholar Profile',
      'NSF Research Traineeship Program',
      'Belief Lab',
      'Personal Website',
      '',
    ]) {
      expect(isExternalScholarlyPlatformLinkLabelName(name), name).toBe(false);
    }
  });
});

describe('isBarePersonNameEntityName', () => {
  it('flags a name that is nothing but a person name, in every ordering the corpus stores', () => {
    for (const name of [
      'Robin Roster',
      'Roster, Robin',
      'Marisol Echevarra Quintano',
      'Wen (Eric) Quandt',
      'Dana van Dorsen',
      'A. Fenner Quill',
      'Kestrel K. Marlow',
      'Alex Quill Jr',
    ]) {
      expect(isBarePersonNameEntityName(name), name).toBe(true);
    }
  });

  it('flags a name whose surname is itself a particle word (#3145)', () => {
    // A particle only ever precedes the surname it belongs to, so a trailing one is
    // the surname. Discounting it there left one counted word, below the two-word
    // floor, and refused these people outright.
    for (const name of ['Thang Le', 'Jing Du', 'Rohit De', 'Snigdha Das', 'Zhao Da', 'Dana Van']) {
      expect(isBarePersonNameEntityName(name), name).toBe(true);
      expect(
        personScopedResearchEntityNameFromPersonName({ candidateName: name, kind: 'individual' }),
      ).toBe(`${name} Faculty Research`);
    }
  });

  it('still refuses a surname carrying a leading particle and no given name', () => {
    for (const name of ['van Gogh', 'de Silva', 'Le', 'Du']) {
      expect(isBarePersonNameEntityName(name), name).toBe(false);
    }
  });

  it('still accepts a full name with a genuine leading particle', () => {
    for (const name of ['Vincent van Gogh', 'Maria de la Cruz', 'Dana van Dorsen']) {
      expect(isBarePersonNameEntityName(name), name).toBe(true);
    }
  });

  it('spares a branded research name that merely carries no research word', () => {
    for (const name of [
      'The Cogitorium',
      'ZyLab',
      'ZOTAR',
      'MiXCAST',
      'ExamplarTEAM',
      'Quiescence',
      'Law and Psychiatry',
      'The Letters of Quintus',
      'County OB / GYN',
      'Meridian MS & Proteomics Resource',
      'Biennale Architettura 2023',
      'Pediatric Functional Neurological Disorders at Yale',
      'Sight-Saving Engagement and Evaluation in Riverbend (SEEN)',
      '',
    ]) {
      expect(isBarePersonNameEntityName(name), name).toBe(false);
    }
  });

  it('spares a name that already names a research record', () => {
    for (const name of [
      'Robin Roster Lab',
      'Robin Roster Faculty Research',
      'Yale NLP Lab',
      'Quillfeather Lab',
      'Yale Center for Customer Insights',
    ]) {
      expect(isBarePersonNameEntityName(name), name).toBe(false);
    }
  });
});

describe('a platform brand is not a person name (#2285)', () => {
  // Two capitalised words, no head noun, no compound punctuation, so every person-name
  // test passed and the derivation below manufactured a research home out of a link
  // label the rest of the system refuses.
  it('is not read as a bare person name', () => {
    for (const name of ['Google Scholar', 'Semantic Scholar', 'Research Gate', 'NIH Reporter']) {
      expect(isBarePersonNameEntityName(name), name).toBe(false);
    }
    expect(isBarePersonNameEntityName('Robin Roster')).toBe(true);
  });

  it('derives no research-record name from it', () => {
    expect(
      personScopedResearchEntityNameFromPersonName({
        candidateName: 'Google Scholar',
        entityType: 'LAB',
      }),
    ).toBe('');
    expect(
      personScopedResearchEntityNameFromPersonName({
        candidateName: 'Robin Roster',
        entityType: 'LAB',
      }),
    ).toBe('Robin Roster Lab');
  });
});

// The derivation runs AFTER the refusals and on the value a refusal left behind, so
// every vocabulary the name authority refuses has to be unreachable from it. Each of
// these was a live laundering path: the refused value stayed on `name`, the
// derivation appended the naming convention's suffix, and the result wore a head
// noun that its own refusing predicate is anchored past and can no longer see.
describe('the derivation refuses every class the name authority refuses (#2285)', () => {
  const LAUNDERED_BY_DERIVATION = [
    'Not Available',
    'No Name',
    'Zucker Homepage',
    'Personal Website',
    'Google Scholar Profile',
  ];

  it('reads none of them as a bare person name', () => {
    for (const name of LAUNDERED_BY_DERIVATION) {
      expect(isBarePersonNameEntityName(name), name).toBe(false);
    }
  });

  it('derives no research-record name from any of them', () => {
    for (const name of LAUNDERED_BY_DERIVATION) {
      expect(
        personScopedResearchEntityNameFromPersonName({ candidateName: name, entityType: 'LAB' }),
        name,
      ).toBe('');
    }
  });
});

describe('personScopedResearchEntityNameFromPersonName', () => {
  it('derives the suffix the roster scrapers already write, per entity type', () => {
    expect(
      personScopedResearchEntityNameFromPersonName({
        candidateName: 'Robin Roster',
        entityType: 'LAB',
      }),
    ).toBe('Robin Roster Lab');
    expect(
      personScopedResearchEntityNameFromPersonName({
        candidateName: 'Robin Roster',
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toBe('Robin Roster Faculty Research');
    expect(
      personScopedResearchEntityNameFromPersonName({
        candidateName: 'Robin Roster',
        kind: 'lab',
      }),
    ).toBe('Robin Roster Lab');
  });

  it('restores natural order from an inverted stored name', () => {
    expect(
      personScopedResearchEntityNameFromPersonName({
        candidateName: 'Roster, Robin',
        entityType: 'LAB',
      }),
    ).toBe('Robin Roster Lab');
  });

  it('is idempotent, so a second serve pass never doubles the suffix', () => {
    const once = personScopedResearchEntityNameFromPersonName({
      candidateName: 'Robin Roster',
      entityType: 'LAB',
    });
    expect(
      personScopedResearchEntityNameFromPersonName({ candidateName: once, entityType: 'LAB' }),
    ).toBe('');
  });

  it('derives nothing for an organization-shaped record or a branded name', () => {
    expect(
      personScopedResearchEntityNameFromPersonName({
        candidateName: 'Robin Roster',
        entityType: 'CENTER',
      }),
    ).toBe('');
    expect(
      personScopedResearchEntityNameFromPersonName({
        candidateName: 'The Cogitorium',
        entityType: 'LAB',
      }),
    ).toBe('');
  });
});

describe('isUnrecoverablePersonScopedEntityName', () => {
  it('flags a named professorship and a bare host name', () => {
    for (const name of [
      'Rutherford Grange Professor of Economics',
      'Professor of Law',
      'Dean of the School of Fictional Studies',
      'ExampleHolidays.org',
      'www.example-person.com',
    ]) {
      expect(isUnrecoverablePersonScopedEntityName(name), name).toBe(true);
    }
  });

  it('spares a real research name and a bare person name the substitution repairs', () => {
    for (const name of [
      'Robin Roster',
      'Robin Roster Lab',
      'Yale NLP Lab',
      'Professorial Chair Lab',
      'Quiescence',
      '',
    ]) {
      expect(isUnrecoverablePersonScopedEntityName(name), name).toBe(false);
    }
  });
});
describe('personScopedResearchEntityBodyDescribesAnotherOrganization', () => {
  const personRow = {
    name: 'Robin Hansen - Research',
    slug: 'directory-faculty-robin-hansen',
  };

  it('refuses a body whose subject is a third-party organization', () => {
    for (const body of [
      'The department supports undergraduate research through paid research assistantships and summer programs.',
      'The Northgate Measurement Based Care Collaborative is dedicated to implementation for clinicians and clients.',
      'Housed under the Northgate Bioimaging Institute, the PET core is a revenue-neutral service provider.',
      'The Office of Health Equity Research is the organizing center of health equity research at the medical school.',
      'The Section of Endocrine Surgery is interested in health systems research and clinical outcomes.',
      'The Pancreatic Cancer Early Detection Clinic provides risk assessment, education and screening.',
      'Northgate Translational Research Imaging Center (Y-TRIC) was founded in 2010 to centralize animal imaging.',
      'The Northgate Program for Recovery and Community Health promotes self-determination and community inclusion.',
      'Northgate University Divinity School is a graduate professional school and an ecumenical community of faith.',
    ]) {
      expect(
        personScopedResearchEntityBodyDescribesAnotherOrganization({
          ...personRow,
          description: body,
        }),
        body,
      ).toBe(true);
    }
  });

  it("keeps a person's own research prose, whatever it sounds like", () => {
    for (const body of [
      'We provide training and access to shared confocal microscopes for investigators across the campus.',
      'Research in the Department of Psychiatry on adolescent sleep, mood regulation and the transition to college.',
      'The Hansen Lab studies the molecular basis of neurodegeneration using mouse genetics.',
      'This research focuses on the genetics of rare metabolic disease in children.',
      'The clinical core of this work is patient-centred outcomes research in chronic disease.',
      'Our laboratory investigates how immune cells sense infection.',
      'At the Northgate Primary Care Center, Robin Hansen provides health care for children and teaches residents.',
      'Collaborative studies with members of the Department of Obstetrics are addressing the biology of the embryo.',
      'The research program integrates clinical surgery with genomic analysis of aortic disease.',
      '',
    ]) {
      expect(
        personScopedResearchEntityBodyDescribesAnotherOrganization({
          ...personRow,
          description: body,
        }),
        body,
      ).toBe(false);
    }
  });

  it('keeps a body whose organization is the record itself', () => {
    expect(
      personScopedResearchEntityBodyDescribesAnotherOrganization({
        description: 'The Northgate PET Center is a registered radiotracer manufacturing facility.',
        name: 'Northgate PET Center',
        slug: 'northgate-pet-center',
      }),
    ).toBe(false);
  });

  it("keeps an eponymous organization named for the record's own person", () => {
    expect(
      personScopedResearchEntityBodyDescribesAnotherOrganization({
        description: 'The Hansen Center for Metal Geochemistry studies isotopes in deep time.',
        name: 'Robin Hansen - Research',
        personName: 'Robin Hansen',
        slug: 'directory-faculty-robin-hansen',
      }),
    ).toBe(false);
  });

  // The eponym arm judges on the same lead-and-key union `personScopedNameIdentityPrelude`
  // judges on. A lead-else-key ternary drops the key's spelling of the surname the moment
  // any lead resolves, and a directory that records only a given name leaves the key as
  // the only place the surname appears (#2384).
  it("keeps an eponymous organization the record's KEY names while its lead name does not", () => {
    expect(
      personScopedResearchEntityBodyDescribesAnotherOrganization({
        description: 'The Quorrow Center for Metal Geochemistry studies isotopes in deep time.',
        name: 'Faculty Research',
        personName: 'Pell',
        slug: 'directory-faculty-pellquorrow',
      }),
    ).toBe(false);
  });

  it('reports the subject it read, so a refusal can be explained', () => {
    expect(
      bodySubjectOrganizationName(
        'The Office of Health Equity Research is the organizing center of health equity research.',
      ),
    ).toBe('The Office of Health Equity Research');
    expect(
      bodySubjectOrganizationName('Our laboratory investigates how immune cells sense infection.'),
    ).toBe('');
  });
});

describe('a name that names a shared academic host the record cites (#2360)', () => {
  const member = {
    entityType: 'LAB',
    kind: 'lab',
    slug: 'nih-pi-quilla-marrowbane',
  };
  const HOST_ORGANIZATION_NAME = 'Computer Systems Lab at Yale';
  const DIRECTORY_URL =
    'https://engineering.yale.edu/research-and-faculty/faculty-directory/quilla-marrowbane/';

  it('refuses the host organization name on a member that cites the host root', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElseByUrlPath({
        ...member,
        candidateName: HOST_ORGANIZATION_NAME,
        websiteUrl: DIRECTORY_URL,
        recordCitedUrls: [DIRECTORY_URL, 'https://csl.yale.edu/'],
      }),
    ).toBe(true);
  });

  it('refuses a name carrying the host label on a tenant page too', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElseByUrlPath({
        ...member,
        candidateName: 'Ursula Group',
        websiteUrl: DIRECTORY_URL,
        recordCitedUrls: [DIRECTORY_URL, 'https://ursula.chem.yale.edu/~quilla/'],
      }),
    ).toBe(true);
  });

  it('keeps a member lab whose initials merely collide with the host label', () => {
    // Three letters are a coincidence a member's own lab in the host's own field can
    // reach, and a `~user` page is that member's own page rather than a claim on the
    // host, so an initials-only match there must not condemn a correct name.
    expect(
      personScopedResearchEntityNameNamesSomethingElseByUrlPath({
        ...member,
        candidateName: 'Cell Signaling Lab',
        websiteUrl: DIRECTORY_URL,
        recordCitedUrls: [DIRECTORY_URL, 'https://csl.yale.edu/~quilla/'],
      }),
    ).toBe(false);
    expect(
      nameNamesACitedSharedAcademicHost({
        harvestedName: 'Applied Institute for Data Analytics',
        recordCitedUrls: ['https://aida.econ.yale.edu/~quilla/'],
        identityTokens: entityKeyPersonTokens('nih-pi-quilla-marrowbane'),
      }),
    ).toBe(false);
  });

  it('is silent when the record cites no shared host, because nothing identifies the owner', () => {
    // The whole point of the arm: the name alone cannot tell a 13-faculty umbrella
    // from one person's lab, so with no citation there is no judgement to make.
    expect(
      personScopedResearchEntityNameNamesSomethingElseByUrlPath({
        ...member,
        candidateName: HOST_ORGANIZATION_NAME,
        websiteUrl: DIRECTORY_URL,
        recordCitedUrls: [DIRECTORY_URL],
      }),
    ).toBe(false);
  });

  it("keeps a member's own lab name on the same shared host", () => {
    // The row every name-axis candidate on #2360 regressed: a real lab named after
    // neither its PI nor the host, cited on the same shared host as the umbrella.
    expect(
      personScopedResearchEntityNameNamesSomethingElseByUrlPath({
        ...member,
        candidateName: 'Analog and RF Circuits (ARC) Lab at Yale',
        websiteUrl: DIRECTORY_URL,
        recordCitedUrls: [DIRECTORY_URL, 'https://csl.yale.edu/~quilla/'],
      }),
    ).toBe(false);
  });

  it('reads only a citation OF the host, not an ordinary page on it', () => {
    // A page that merely lives on the host is a directory reference and must not
    // stand in for citing the host. The host root is the claim on it.
    const named = { harvestedName: HOST_ORGANIZATION_NAME, identityTokens: [] };
    expect(
      nameNamesACitedSharedAcademicHost({
        ...named,
        recordCitedUrls: ['https://csl.yale.edu/people/faculty'],
      }),
    ).toBe(false);
    expect(
      nameNamesACitedSharedAcademicHost({ ...named, recordCitedUrls: ['https://csl.yale.edu/'] }),
    ).toBe(true);
    // A `~user` page is the member's own page, so only the stronger match reads on it:
    // the label standing among the name's own words, never an initialism.
    expect(
      nameNamesACitedSharedAcademicHost({
        ...named,
        recordCitedUrls: ['https://csl.yale.edu/~atenant/'],
      }),
    ).toBe(false);
    expect(
      nameNamesACitedSharedAcademicHost({
        harvestedName: 'Gauss Lab',
        recordCitedUrls: ['https://gauss.math.yale.edu/~atenant/'],
        identityTokens: [],
      }),
    ).toBe(true);
  });

  it('is silent on a deep page and on a discipline-word host label', () => {
    // A deep page on the host is a directory reference, not a claim on the host.
    expect(
      nameNamesACitedSharedAcademicHost({
        harvestedName: HOST_ORGANIZATION_NAME,
        recordCitedUrls: ['https://csl.yale.edu/people/faculty/'],
        identityTokens: entityKeyPersonTokens('nih-pi-quilla-marrowbane'),
      }),
    ).toBe(false);
    // `math` is a word a real lab name carries for its own reasons, so matching it is
    // coincidence rather than evidence, on the host root and on a tenant page alike.
    for (const citedUrl of ['https://math.mit.edu/', 'https://math.mit.edu/~atenant/']) {
      expect(
        nameNamesACitedSharedAcademicHost({
          harvestedName: 'Applied Math Lab',
          recordCitedUrls: [citedUrl],
          identityTokens: entityKeyPersonTokens('nih-pi-quilla-marrowbane'),
        }),
      ).toBe(false);
    }
    expect(
      nameNamesACitedSharedAcademicHost({
        harvestedName: 'Statistical Theory and Applied Topics',
        recordCitedUrls: ['https://stat.yale.edu/'],
        identityTokens: entityKeyPersonTokens('nih-pi-quilla-marrowbane'),
      }),
    ).toBe(false);
  });

  it('keeps a host label that is the record own surname', () => {
    expect(
      nameNamesACitedSharedAcademicHost({
        harvestedName: 'Ursula Laboratory',
        recordCitedUrls: ['https://ursula.chem.yale.edu/'],
        identityTokens: entityKeyPersonTokens('dept-chem-robin-ursula'),
      }),
    ).toBe(false);
  });

  it('says nothing about an organization-shaped record, which may own the host', () => {
    expect(
      personScopedResearchEntityNameNamesSomethingElseByUrlPath({
        entityType: 'CENTER',
        kind: 'center',
        slug: 'computer-systems-lab-at-yale',
        candidateName: HOST_ORGANIZATION_NAME,
        recordCitedUrls: ['https://csl.yale.edu/'],
      }),
    ).toBe(false);
  });
});
