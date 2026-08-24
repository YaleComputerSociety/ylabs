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
    entity: { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual', displayName: 'Robin Hansen' },
    disposition: 'blank',
    expectContains:
      'This is a leading center of excellence for cancer research and teaching on the local, national, and international levels.',
  },
  {
    id: 'research-area-echo',
    issues: '#623',
    field: 'fullDescription',
    entity: { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual', displayName: 'Robin Hansen' },
    disposition: 'blank',
    expectContains:
      'Research fields include neoplasms, parathyroid disorders, and immunotherapy.',
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
    entity: { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual', displayName: 'Robin Hansen' },
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
    entity: { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual', displayName: 'Robin Hansen' },
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
      if (failureCase.expectNotContains) expect(served).not.toContain(failureCase.expectNotContains);
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
