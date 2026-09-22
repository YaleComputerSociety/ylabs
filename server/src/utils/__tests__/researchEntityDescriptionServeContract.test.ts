import { describe, expect, it } from 'vitest';

import { sanitizeServedResearchEntityCopyFields } from '../researchEntityDescriptionText';

type ServeField = 'fullDescription' | 'shortDescription';

type Disposition = 'blank' | 'preserved' | 'transformed';

interface DescriptionFailureClassCase {
  id: string;
  issues: string;
  field: ServeField;
  entity: Record<string, any>;
  disposition: Disposition;
  expectContains?: string;
  expectNotContains?: string;
}

function servedField(entity: Record<string, any>, field: ServeField): string {
  const out = sanitizeServedResearchEntityCopyFields(entity);
  const value = out[field];
  return typeof value === 'string' ? value : '';
}

const withField = (
  field: ServeField,
  entity: Record<string, any>,
  text: string,
): Record<string, any> => ({ ...entity, [field]: text });

/**
 * The canonical catalogue of research-entity description failure classes and the
 * disposition every HTTP serve path must apply to each (#1269). This is the ONE
 * place a new bad-description class is encoded: add a row here (and, if a new
 * detector is needed, wire it into the layer that `sanitizeServedResearchEntityCopyFields`
 * composes). Because the DTO and embedded-summary serve paths both run that single
 * function, a class added here is covered on every student-facing surface at once,
 * which is what replaces the per-case `fix(descriptions)` treadmill.
 */
const FAILURE_CLASSES: DescriptionFailureClassCase[] = [
  {
    id: 'curation-rationale-prose',
    issues: '#671/#1183/#1053',
    field: 'fullDescription',
    entity: { entityType: 'PROGRAM' },
    disposition: 'blank',
    expectContains: 'This program is source-backed and safe to show prominently to students.',
  },
  {
    id: 'publications-list-dump',
    issues: '#676',
    field: 'fullDescription',
    entity: { entityType: 'CENTER', kind: 'center' },
    disposition: 'blank',
    expectContains: 'Selected Publications: Smith J. Nature. Doe A. Cell.',
  },
  {
    id: 'recipient-roster',
    issues: '#904/#1206/#1210',
    field: 'fullDescription',
    entity: { entityType: 'PROGRAM' },
    disposition: 'blank',
    expectContains:
      "Casey Parker '28 Mentor: Dr. A. Jordan Lee '27 Mentor: Dr. B. Sam Ray '26 Mentor: Dr. C.",
  },
  {
    id: 'institutional-center-graft-blurb',
    issues: '#893',
    field: 'fullDescription',
    entity: {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      displayName: 'Robin Hansen',
    },
    disposition: 'blank',
    expectContains:
      'This is a leading center of excellence for cancer research and teaching on the local, national, and international levels.',
  },
  {
    id: 'research-area-echo',
    issues: '#623',
    field: 'fullDescription',
    entity: {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      displayName: 'Robin Hansen',
    },
    disposition: 'blank',
    expectContains: 'Research fields include neoplasms, parathyroid disorders, and immunotherapy.',
  },
  {
    id: 'literal-html-markup',
    issues: '#909',
    field: 'fullDescription',
    entity: { entityType: 'CENTER', kind: 'center' },
    disposition: 'blank',
    expectContains: 'Studies proteins <span data-id="3">structure</span> and folding dynamics.',
  },
  {
    id: 'academic-appointment-only',
    issues: '#1010/#1161',
    field: 'fullDescription',
    entity: {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      displayName: 'Robin Hansen',
    },
    disposition: 'blank',
    expectContains: 'Robin Hansen is an Associate Professor of Immunobiology.',
  },
  {
    id: 'role-only-title-fragment',
    issues: '#1161',
    field: 'shortDescription',
    entity: { entityType: 'PROGRAM' },
    disposition: 'blank',
    expectContains: 'Program Director, Undergraduate Research',
  },
  {
    id: 'source-page-chrome',
    issues: '#569/#605',
    field: 'fullDescription',
    entity: {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      displayName: 'Robin Hansen',
    },
    disposition: 'blank',
    expectContains: 'View Full Profile Related Publications ORCID 0000-0000-0000-0000',
  },
  {
    id: 'synthetic-research-home-placeholder',
    issues: '#732',
    field: 'fullDescription',
    entity: { entityType: 'CENTER', kind: 'center' },
    disposition: 'blank',
    expectContains: 'Research home connected to.',
  },
  {
    id: 'opinion-poll-cta-ticker',
    issues: '#898/#932',
    field: 'shortDescription',
    entity: { entityType: 'CENTER', kind: 'center' },
    disposition: 'blank',
    expectContains:
      '76% of Americans say climate policy matters. Sign up today! Follow us on Twitter and Instagram.',
  },
  {
    id: 'doubled-synthesis-verb',
    issues: '#975',
    field: 'shortDescription',
    entity: { entityType: 'CENTER', kind: 'center' },
    disposition: 'transformed',
    expectContains: 'Studies neural circuits and memory formation.',
    expectNotContains: 'Studies Studies',
  },
  {
    id: 'first-person-revoice',
    issues: '#1109/#1117/#1168',
    field: 'fullDescription',
    entity: { entityType: 'INDIVIDUAL_RESEARCH', kind: 'individual', displayName: 'Robin Hansen' },
    disposition: 'transformed',
    expectContains: 'This research',
    expectNotContains: 'My research',
  },
  {
    id: 'lab-self-reference-relabel',
    issues: 'research-home self-reference',
    field: 'fullDescription',
    entity: { entityType: 'CENTER', kind: 'center' },
    disposition: 'transformed',
    expectContains: 'The center studies',
    expectNotContains: 'The lab studies',
  },
  {
    id: 'page-layout-referential-caveat',
    issues: '#994/#1158',
    field: 'fullDescription',
    entity: { entityType: 'PROGRAM' },
    disposition: 'transformed',
    expectContains: 'coral reef ecology',
    expectNotContains: 'right-hand column',
  },
  {
    id: 'we-verb-opener',
    issues: '#1526',
    field: 'fullDescription',
    entity: { entityType: 'LAB', kind: 'lab' },
    disposition: 'transformed',
    expectContains: 'This group investigates',
    expectNotContains: 'We investigate',
  },
  {
    id: 'our-other-noun-opener',
    issues: '#1526',
    field: 'fullDescription',
    entity: { entityType: 'LAB', kind: 'lab' },
    disposition: 'transformed',
    expectContains: 'This passion is to understand',
    expectNotContains: 'Our passion',
  },
  {
    id: 'i-verb-opener',
    issues: '#1526',
    field: 'fullDescription',
    entity: {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      displayName: 'Robin Hansen',
    },
    disposition: 'transformed',
    expectContains: 'This researcher studies',
    expectNotContains: 'I study',
  },
  {
    id: 'non-my-our-the-greeting',
    issues: '#1526',
    field: 'fullDescription',
    entity: { entityType: 'LAB', kind: 'lab' },
    disposition: 'transformed',
    expectContains: 'This group studies',
    expectNotContains: 'Welcome to',
  },
  {
    id: 'individual-cv-bio-recruiting-note',
    issues: '#1526',
    field: 'fullDescription',
    entity: {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      displayName: 'Robin Hansen',
    },
    disposition: 'blank',
    expectContains:
      'I would be happy to meet regularly with an undergraduate or two to do some directed reading in theoretical physics.',
  },
  {
    id: 'clinical-trial-recruitment-flyer',
    issues: '#1526',
    field: 'fullDescription',
    entity: { entityType: 'LAB', kind: 'lab' },
    disposition: 'blank',
    expectContains:
      'Be ages 18 to 65 Smoking cigarettes every day Please contact 203-737-2827 for more information. HIC: 0808004163',
  },
  {
    id: 'patient-care-marketing-copy',
    issues: '#1526',
    field: 'fullDescription',
    entity: { entityType: 'LAB', kind: 'lab' },
    disposition: 'blank',
    expectContains:
      'Our team of specialists will support and guide you on your wellness journey through compassionate, science-driven, dedicated lifelong care.',
  },
  {
    id: 'residual-i-verb-mid-sentence',
    issues: '#1745',
    field: 'fullDescription',
    entity: { entityType: 'LAB', kind: 'lab' },
    disposition: 'transformed',
    expectContains: 'this researcher is interested in the role of a specific pathway',
    expectNotContains: 'I am interested',
  },
  {
    id: 'first-person-department-appointment-cv',
    issues: '#1745',
    field: 'fullDescription',
    entity: { entityType: 'LAB', kind: 'lab' },
    disposition: 'blank',
    expectContains:
      'I am an Instructor in the Department of Medicine, Section of Infectious Diseases.',
  },
  {
    id: 'degree-receipt-cv-opener',
    issues: '#1745',
    field: 'fullDescription',
    entity: {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      displayName: 'Robin Hansen',
    },
    disposition: 'blank',
    expectContains:
      'Robin Hansen received her PhD in Linguistics from the University of Pennsylvania in 1991.',
  },
  {
    id: 'pronoun-awards-cv-opener',
    issues: '#1745',
    field: 'fullDescription',
    entity: {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      displayName: 'Robin Hansen',
    },
    disposition: 'blank',
    expectContains:
      'He has received the Best Economics PhD Advisor Award at Yale University in 2022 and 2023, and was a runner-up in 2024. Hansen is a fellow of the Econometric Society and has received several prestigious awards.',
  },
  {
    id: 'third-party-organization-body',
    issues: '#2480',
    field: 'fullDescription',
    entity: {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      displayName: 'Robin Hansen',
      slug: 'directory-faculty-robin-hansen',
    },
    disposition: 'blank',
    expectContains:
      'The Office of Health Equity Research is the organizing center of health equity research at the medical school and coordinates its investigators.',
  },
  {
    id: 'fra-credential-title-lead',
    issues: '#1793',
    field: 'fullDescription',
    entity: {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      displayName: 'Robin Hansen',
    },
    disposition: 'transformed',
    expectContains:
      "Robin Hansen's research focuses on big data and data-driven policy analyses and solutions.",
    expectNotContains: 'is a senior lecturer',
  },
  // Stripping the credential opener above is what LEAVES the pronoun leading the
  // body, so these three classes are reachable on rows whose stored text never
  // opened with a pronoun at all.
  {
    id: 'orphaned-third-person-possessive-lead',
    issues: '#1871',
    field: 'fullDescription',
    entity: {
      entityType: 'LAB',
      kind: 'lab',
      name: 'Analog and RF Circuits (ARC) Lab at Yale',
    },
    disposition: 'transformed',
    expectContains: "This lab's research focuses on analog, RF, and mm-wave integrated circuits",
    expectNotContains: 'His research',
  },
  {
    id: 'orphaned-third-person-subject-lead',
    issues: '#1871',
    field: 'fullDescription',
    entity: { entityType: 'CORE_FACILITY', kind: 'core_facility', name: 'Cellular Imaging Core' },
    disposition: 'transformed',
    expectContains: 'This researcher holds a joint appointment',
    expectNotContains: 'She holds',
  },
  {
    id: 'orphaned-first-person-adverb-lead',
    issues: '#1871',
    field: 'fullDescription',
    entity: {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      displayName: 'Robin Hansen',
    },
    disposition: 'transformed',
    expectContains: 'This researcher currently focuses on',
    expectNotContains: 'I currently focus',
  },
];

describe('research-entity description serve contract (#1269)', () => {
  for (const failureCase of FAILURE_CLASSES) {
    it(`${failureCase.id} [${failureCase.issues}] -> ${failureCase.disposition}`, () => {
      const rawText =
        failureCase.disposition === 'blank'
          ? (failureCase.expectContains as string)
          : SEED_TEXT[failureCase.id];
      const entity = withField(failureCase.field, failureCase.entity, rawText);
      const served = servedField(entity, failureCase.field);

      if (failureCase.disposition === 'blank') {
        expect(served).toBe('');
        return;
      }
      expect(served).not.toBe('');
      expect(served).not.toBe(rawText);
      if (failureCase.expectContains) expect(served).toContain(failureCase.expectContains);
      if (failureCase.expectNotContains)
        expect(served).not.toContain(failureCase.expectNotContains);
    });
  }

  it('every failure class has a disposition and issue reference', () => {
    for (const failureCase of FAILURE_CLASSES) {
      expect(failureCase.id).toBeTruthy();
      expect(failureCase.issues).toBeTruthy();
      expect(['blank', 'preserved', 'transformed']).toContain(failureCase.disposition);
    }
  });
});

const SEED_TEXT: Record<string, string> = {
  'doubled-synthesis-verb': 'Studies Studies neural circuits and memory formation.',
  'first-person-revoice':
    'I am a neuroscientist. My research examines how memory forms in the developing brain using fMRI.',
  'lab-self-reference-relabel':
    'The lab studies neural circuits underlying memory formation in mammals using electrophysiology.',
  'page-layout-referential-caveat':
    'Studies coral reef ecology across the Pacific basin. Application deadlines are listed in the right-hand column.',
  'we-verb-opener':
    'We investigate the brain changes in movement disorders, especially Parkinson’s disease, using imaging tools.',
  'our-other-noun-opener':
    'Our passion is to understand blood vessel dysfunction in the setting of critical illness.',
  'i-verb-opener':
    'I study the role of reporting regulation and transparency in the social and public sectors.',
  'non-my-our-the-greeting':
    'Welcome to Social Robotics at Yale! We study human behavior using computational and robotic models.',
  'residual-i-verb-mid-sentence':
    'This primary research focus is mechanisms of disease. In particular, I am interested in the role of a specific pathway.',
  'fra-credential-title-lead':
    'Robin Hansen is a senior lecturer at the Jackson School of Global Affairs. His research focuses on big data and data-driven policy analyses and solutions.',
  'orphaned-third-person-possessive-lead':
    'His research focuses on analog, RF, and mm-wave integrated circuits for wireless and imaging systems.',
  'orphaned-third-person-subject-lead':
    'She holds a joint appointment and studies the epidemiology of vector-borne disease in the tropics.',
  'orphaned-first-person-adverb-lead':
    'I currently focus on the statistical genetics of complex traits and their shared architecture.',
};

describe('research-entity description serve contract - clean prose preserved', () => {
  const CLEAN_CASES: Array<[string, Record<string, any>, ServeField, string]> = [
    [
      'center prose',
      { entityType: 'CENTER', kind: 'center' },
      'fullDescription',
      'The center studies climate adaptation in coastal communities using field surveys and remote sensing.',
    ],
    [
      'individual prose',
      { entityType: 'INDIVIDUAL_RESEARCH', kind: 'individual', displayName: 'Robin Hansen' },
      'fullDescription',
      'This researcher studies memory formation using functional imaging and behavioral experiments in children.',
    ],
    [
      'program prose',
      { entityType: 'PROGRAM' },
      'fullDescription',
      'The program supports undergraduates conducting summer research in marine biology alongside faculty mentors.',
    ],
    [
      'concise short summary',
      { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual', displayName: 'Robin Hansen' },
      'shortDescription',
      'Studies neoplasms, parathyroid disorders and treatments, and immunotherapy and immune responses.',
    ],
  ];

  for (const [name, entity, field, text] of CLEAN_CASES) {
    it(`preserves ${name}`, () => {
      const served = servedField(withField(field, entity, text), field);
      expect(served).toBe(text);
    });
  }
});

describe('research-entity serve contract - names and research-area chips (#1374)', () => {
  it('collapses a doubled research-home name suffix on name and displayName', () => {
    const out = sanitizeServedResearchEntityCopyFields({
      entityType: 'CENTER',
      kind: 'center',
      name: 'Systems Biology Institute Institute',
      displayName: 'Systems Biology Lab Lab',
    });
    expect(out.name).toBe('Systems Biology Institute');
    expect(out.displayName).toBe('Systems Biology Lab');
  });

  // Clients title the card with `displayName || name`, so filler stored on the
  // alias would render as the card's heading even though `name` identifies the
  // record. Withholding it makes every surface fall back to `name` (#2367).
  it('withholds a placeholder displayName so the card falls back to name', () => {
    const out = sanitizeServedResearchEntityCopyFields({
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      slug: 'ysm-faculty-fixture-loyal',
      name: 'Loyal Lab',
      displayName: 'n/a',
    });
    expect(out.displayName).toBe('');
    expect(out.name).toBe('Loyal Lab');
  });

  it('splits a bare comma-delimited research-area blob into chips', () => {
    const out = sanitizeServedResearchEntityCopyFields({
      entityType: 'CENTER',
      kind: 'center',
      researchAreas: ['genomics, proteomics, metabolomics'],
    });
    expect(out.researchAreas).toEqual(['genomics', 'proteomics', 'metabolomics']);
  });

  it('strips a glued role-label suffix and fails closed on prose/label-leak chips', () => {
    const out = sanitizeServedResearchEntityCopyFields({
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      researchAreas: [
        'Immunobiology YSM Researcher',
        'Research areas include cancer and immunotherapy',
        'We investigate how tumors evade the immune system across many patient cohorts.',
        'Cancer Immunology',
      ],
    });
    expect(out.researchAreas).toEqual(['Immunobiology', 'Cancer Immunology']);
  });

  it('sanitizes profileResearchAreas chips with the same rules', () => {
    const out = sanitizeServedResearchEntityCopyFields({
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      profileResearchAreas: ['Neuroscience YSM Researcher', 'a, b, c'],
    });
    expect(out.profileResearchAreas).toEqual(['Neuroscience', 'a', 'b', 'c']);
  });

  it('leaves clean names and chips untouched and stays idempotent', () => {
    const entity = {
      entityType: 'CENTER',
      kind: 'center',
      name: 'Center for Climate Science',
      researchAreas: ['Climate Modeling', 'Ocean Dynamics'],
    };
    const once = sanitizeServedResearchEntityCopyFields(entity);
    expect(once.name).toBe('Center for Climate Science');
    expect(once.researchAreas).toEqual(['Climate Modeling', 'Ocean Dynamics']);
    const twice = sanitizeServedResearchEntityCopyFields(once);
    expect(twice.name).toBe(once.name);
    expect(twice.researchAreas).toEqual(once.researchAreas);
  });
});

describe('research-entity description serve contract - idempotent', () => {
  it('a second pass never changes an already-served description', () => {
    const inputs: Array<[Record<string, any>, ServeField, string]> = [
      [
        { entityType: 'CENTER', kind: 'center' },
        'fullDescription',
        'The lab studies neural circuits underlying memory formation in mammals using electrophysiology.',
      ],
      [
        { entityType: 'INDIVIDUAL_RESEARCH', kind: 'individual', displayName: 'Robin Hansen' },
        'fullDescription',
        'I am a neuroscientist. My research examines how memory forms in the developing brain using fMRI.',
      ],
    ];
    for (const [entity, field, text] of inputs) {
      const once = sanitizeServedResearchEntityCopyFields(withField(field, entity, text));
      const twice = sanitizeServedResearchEntityCopyFields(once);
      expect(twice[field]).toBe(once[field]);
    }
  });
});

describe("research-entity serve contract - another organization's body (#2480)", () => {
  const INSTITUTIONAL_BODY =
    'The Northgate Measurement Based Care Collaborative is dedicated to implementation for systems, clinicians and clients, and advances measurement based care as an evidence-based practice through continued research.';

  it('withholds the body and serves the card on a person-scoped row', () => {
    const served = sanitizeServedResearchEntityCopyFields({
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      slug: 'directory-faculty-robin-hansen',
      name: 'Robin Hansen - Research',
      fullDescription: INSTITUTIONAL_BODY,
      shortDescription: 'Studies mental health services and measurement based care.',
    });
    expect(served.fullDescription).toBe('');
    expect(served.shortDescription).toBe(
      'Studies mental health services and measurement based care.',
    );
  });

  it('withholds a card that is itself the refused prose (#2915)', () => {
    const served = sanitizeServedResearchEntityCopyFields({
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      slug: 'directory-faculty-robin-hansen',
      name: 'Robin Hansen - Research',
      fullDescription: INSTITUTIONAL_BODY,
      shortDescription:
        'The Northgate Measurement Based Care Collaborative is dedicated to implementation for systems, clinicians and clients.',
    });
    expect(served.fullDescription).toBe('');
    expect(served.shortDescription).toBe('');
  });

  it('withholds a card that restates the refused prose as its own subject (#2915)', () => {
    const served = sanitizeServedResearchEntityCopyFields({
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      slug: 'directory-faculty-robin-hansen',
      name: 'Robin Hansen - Research',
      fullDescription: INSTITUTIONAL_BODY,
      shortDescription:
        'The Office of Health Equity Research is the organizing center of health equity research at the medical school.',
    });
    expect(served.shortDescription).toBe('');
  });

  it('withholds a profile synthesis body on the same terms', () => {
    const served = sanitizeServedResearchEntityCopyFields({
      entityType: 'LAB',
      kind: 'lab',
      slug: 'directory-faculty-robin-hansen',
      name: 'Hansen Lab',
      profileSynthesisDescription: INSTITUTIONAL_BODY,
    });
    expect(served.profileSynthesisDescription).toBe('');
  });

  it('leaves an organizational row describing itself alone', () => {
    for (const entity of [
      { entityType: 'CORE_FACILITY', kind: 'core-facility', name: 'Northgate Imaging Core' },
      { entityType: 'CENTER', kind: 'center', name: 'Northgate Center for Health Equity' },
      { entityType: 'INSTITUTE', kind: 'institute', name: 'Northgate Bioimaging Institute' },
    ]) {
      const served = sanitizeServedResearchEntityCopyFields({
        ...entity,
        fullDescription: INSTITUTIONAL_BODY,
      });
      expect(served.fullDescription, entity.entityType).toBe(INSTITUTIONAL_BODY);
    }
  });

  it('keeps a person-scoped row whose own name IS the organization', () => {
    const served = sanitizeServedResearchEntityCopyFields({
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      slug: 'northgate-measurement-based-care-collaborative',
      name: 'Northgate Measurement Based Care Collaborative',
      fullDescription: INSTITUTIONAL_BODY,
    });
    expect(served.fullDescription).toBe(INSTITUTIONAL_BODY);
  });

  it("keeps a core facility's own first-person prose on a person-scoped row", () => {
    const served = sanitizeServedResearchEntityCopyFields({
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      slug: 'directory-faculty-robin-hansen',
      name: 'Robin Hansen - Research',
      fullDescription:
        'We provide training and access to shared confocal microscopes, and support investigators designing quantitative imaging experiments.',
    });
    expect(served.fullDescription).toContain('confocal microscopes');
  });

  it('keeps a body that only mentions an organization in passing', () => {
    for (const body of [
      'Research in the Department of Psychiatry on adolescent sleep, mood regulation and the transition to college.',
      'At the Northgate Primary Care Center, Robin Hansen provides care for children and teaches residents.',
      'The clinical core of this research is patient-centred outcomes measurement in chronic disease.',
    ]) {
      const served = sanitizeServedResearchEntityCopyFields({
        entityType: 'FACULTY_RESEARCH_AREA',
        kind: 'individual',
        slug: 'directory-faculty-robin-hansen',
        name: 'Robin Hansen - Research',
        fullDescription: body,
      });
      expect(served.fullDescription, body).not.toBe('');
    }
  });

  it('is idempotent', () => {
    const entity = {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      slug: 'directory-faculty-robin-hansen',
      name: 'Robin Hansen - Research',
      fullDescription: INSTITUTIONAL_BODY,
      shortDescription: 'Studies mental health services and measurement based care.',
    };
    const once = sanitizeServedResearchEntityCopyFields(entity);
    const twice = sanitizeServedResearchEntityCopyFields(once);
    expect(twice.fullDescription).toBe(once.fullDescription);
    expect(twice.shortDescription).toBe(once.shortDescription);
  });
});

describe('research-entity serve contract - a withheld body changes nothing else (#2480)', () => {
  it("keeps the row's research-area chips when its body is withheld", () => {
    const entity = {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      slug: 'directory-faculty-robin-hansen',
      name: 'Robin Hansen - Research',
      departments: ['Internal Medicine', 'Endocrinology'],
      fullDescription:
        'The Northgate Weight Management Center focuses on novel pharmacological therapeutics for obesity treatment in clinical trials of adults.',
      shortDescription: 'Directs clinical trials and teaches residents in endocrinology.',
      researchAreas: ['Obesity', 'Weight Loss'],
    };
    const served = sanitizeServedResearchEntityCopyFields(entity);
    expect(served.fullDescription).toBe('');
    expect(served.researchAreas).toEqual(['Obesity', 'Weight Loss']);
    expect(served.shortDescription).toBe(
      'Directs clinical trials and teaches residents in endocrinology.',
    );
  });

  it("keeps the row's research-area chips when its card is withheld too (#2915)", () => {
    const entity = {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      slug: 'directory-faculty-robin-hansen',
      name: 'Robin Hansen - Research',
      fullDescription:
        'The Northgate Measurement Based Care Collaborative is dedicated to implementation for systems, clinicians and clients, and advances measurement based care as an evidence-based practice through continued research.',
      shortDescription:
        'The Office of Health Equity Research is the organizing center of health equity research at the medical school.',
      researchAreas: ['Health Equity'],
    };
    const served = sanitizeServedResearchEntityCopyFields(entity);
    expect(served.fullDescription).toBe('');
    expect(served.shortDescription).toBe('');
    expect(served.researchAreas).toEqual(['Health Equity']);
  });
});
