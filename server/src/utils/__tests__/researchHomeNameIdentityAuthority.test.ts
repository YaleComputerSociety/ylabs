import { describe, it, expect } from 'vitest';
import {
  NO_SURNAME_ROSTER,
  claimsAnotherPersonsLab,
  claimsAnotherPersonsLabByUrlPath,
  personScopedResearchEntityNameNamesSomethingElseByUrlPath,
  classifyHarvestedResearchHomeName,
  describesAffiliatedOrganization,
  stripResearchHomeNameLinkWrapper,
  corroboratedLabNameEponyms,
  eponymousLabNameSurnameCandidates,
  entityKeyPersonTokens,
  eponymousLabNameSurname,
  isNonIdentifyingLinkLabelName,
  isPlaceholderEntityName,
  isPersonScopedResearchEntity,
  isUmbrellaOrganizationName,
  personScopedResearchEntityNameNamesSomethingElse,
  personSurnamesFromDisplayNames,
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

// The roster arm's precision depends on the CALLER supplying a resolved lead name.
// Half the live refusals ran on the slug-token fallback instead, which is a silent
// downgrade: a slug like `ysm-leveylab` yields no token matching an eponym the lead
// name would have matched. Pinned so the dependency is visible in the code.
describe('roster corroboration depends on a resolved lead name (#2361)', () => {
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

  it('refuses it on slug tokens alone, which is the degraded path', () => {
    expect(claimsAnotherPersonsLab({ ...eponymHolderOwnLab, identityTokens: ['leveylab'] })).toBe(
      true,
    );
  });
});
