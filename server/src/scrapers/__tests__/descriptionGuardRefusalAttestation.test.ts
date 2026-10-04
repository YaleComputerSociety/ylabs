import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_SLOT_ATTESTATION_VOCABULARY,
  descriptionSlotAttestation,
  describeDescriptionExtraction,
  groundDescriptionExtraction,
  emptyDescriptionSlotAttestationMetrics,
  recordDescriptionSlotAttestation,
  withDescriptionSlotAttestation,
  type DescriptionGuardRefusal,
} from '../sources/labMicrositeDescriptionLLMExtractor';

const RESEARCH_PROSE =
  'The laboratory studies how microglia clear protein aggregates in the ageing brain, combining two-photon imaging in mouse models with single-nucleus sequencing of post-mortem cortex.';

const context = {
  sourceUrl: 'https://medicine.example.edu/lab/microglia/',
  entityKey: 'fixture-guard-refusal-lab',
  entityType: 'LAB',
  kind: 'group',
  knownPersonSurnames: new Set<string>(),
};

const extraction = (fullDescription: string, overrides: Record<string, unknown> = {}) => ({
  name: '',
  fullDescription,
  shortDescription: '',
  topics: [],
  methods: [],
  ...overrides,
});

const wholeRead = {
  primaryPageTextLength: 4_000,
  llmRan: true,
  crawlIncomplete: false,
  unopposedCrawledProseSuppressed: false,
  foreignLabPage: false,
};

const refusalFor = (
  fullDescription: string,
  contextOverrides: Record<string, unknown> = {},
  extractionOverrides: Record<string, unknown> = {},
) =>
  describeDescriptionExtraction(extraction(fullDescription, extractionOverrides), {
    ...context,
    ...contextOverrides,
  });

describe('a description guard refusal is recorded as refused, never empty (#3739)', () => {
  const guardCases: Record<
    Exclude<DescriptionGuardRefusal, 'unopposed_crawled_prose'>,
    () => ReturnType<typeof refusalFor>
  > = {
    rejected_source_url: () => refusalFor(RESEARCH_PROSE, { sourceUrl: 'not a url' }),
    shared_evidence_url: () =>
      refusalFor(RESEARCH_PROSE, {
        descriptionSourceForeignCiterNames: ['Marrowind Center', 'Peltasker Institute'],
      }),
    institution_landing_url: () => refusalFor(RESEARCH_PROSE, { institutionLandingUrl: true }),
    another_persons_lab: () =>
      refusalFor(
        'The Zephyr laboratory is dedicated to developing a high-throughput cryo-electron tomography pipeline for structure determination of molecular machines in cells.',
        {
          sourceUrl: 'https://medicine.yale.edu/lab/quill-zephyr/',
          entityKey: 'ysm-faculty-fixture-member',
        },
        { name: 'The Zephyr Lab' },
      ),
    subject_not_named_entity: () =>
      refusalFor(RESEARCH_PROSE, {}, { subject: 'parent_organization' }),
    bio_directory_dump: () =>
      refusalFor(
        'About Avery Quill is a postdoctoral fellow studying microglia. About Blake Rowan is a graduate student studying cortex imaging.',
      ),
    interest_chip_list: () =>
      refusalFor(
        'Research Interests: Geophysical and geological fluid dynamics Continuum mechanics Multiphase physics Glaciology',
      ),
    navigation_chrome: () =>
      refusalFor(
        'Main Menu Sub Menu home publications Research people alum/theses Outreach contact links Welcome to the laboratory, which studies microglia.',
      ),
    profile_template_chrome: () =>
      refusalFor(
        'Medical Research Interests Blood Platelets; Liver Diseases ORCID 0000-0000-0000-0000 Research at a Glance Yale Co-Authors Frequent collaborators of a fixture person.',
      ),
    career_timeline: () =>
      refusalFor(
        'She received her Ph.D. degree from Example University in chemistry and biology. She did her postdoctoral training at another institute. She joined the Example School faculty in 2005.',
      ),
    another_organization_body: () =>
      refusalFor(
        'The department supports undergraduate research through paid research assistantships and summer programs.',
        {
          entityKey: 'directory-faculty-fixture-person',
          entityType: 'FACULTY_RESEARCH_AREA',
          kind: 'individual',
        },
      ),
    bibliography_entry: () =>
      refusalFor(
        'Microglia and the Ageing Brain: Clearance Pathways in Tauopathy and Related Disorders, Example University Press, 2019.',
      ),
  };
  const cases = Object.entries(guardCases);

  it.each(cases)('names the %s guard and so attests refused', (guard, run) => {
    const outcome = run();

    expect(outcome.observations).toEqual([]);
    expect(outcome.refusal).toBe(guard);
    expect(descriptionSlotAttestation({ ...wholeRead, guardRefusal: outcome.refusal })).toBe(
      'refused',
    );
  });

  it('keeps empty only for an extraction that produced no usable prose at all', () => {
    const outcome = refusalFor('Too short to judge.');

    expect(outcome).toEqual({ observations: [] });
    expect(descriptionSlotAttestation({ ...wholeRead, guardRefusal: outcome.refusal })).toBe(
      'empty',
    );
  });

  it('keeps empty for a grounded read that returned no prose, whatever subject it names', () => {
    const outcome = describeDescriptionExtraction(
      groundDescriptionExtraction(
        extraction('', { subject: 'parent_organization' }),
        RESEARCH_PROSE,
      ),
      context,
    );

    expect(outcome).toEqual({ observations: [] });
    expect(descriptionSlotAttestation({ ...wholeRead, guardRefusal: outcome.refusal })).toBe(
      'empty',
    );
  });

  it('refuses a grounded read whose prose names a subject other than the entity', () => {
    const outcome = describeDescriptionExtraction(
      groundDescriptionExtraction(
        extraction(RESEARCH_PROSE, { subject: 'parent_organization' }),
        RESEARCH_PROSE,
      ),
      context,
    );

    expect(outcome).toEqual({ observations: [], refusal: 'subject_not_named_entity' });
  });

  it('writes no absence claim for a refused read, so the refusal pass cannot read it as empty', () => {
    const carrier = {
      entityType: 'researchEntity' as const,
      entityKey: context.entityKey,
      field: 'sourceContentHash',
      value: 'abc',
      sourceUrl: context.sourceUrl,
    };
    const attestation = descriptionSlotAttestation({
      ...wholeRead,
      guardRefusal: refusalFor(RESEARCH_PROSE, {
        descriptionSourceForeignCiterNames: ['Marrowind Center', 'Peltasker Institute'],
      }).refusal,
    });

    expect(
      withDescriptionSlotAttestation([carrier], attestation)[0].assertsNoValueFor,
    ).toBeUndefined();
  });

  it('counts empty, refused, and unclaimed reads apart, with the guard behind each refusal', () => {
    const metrics = emptyDescriptionSlotAttestationMetrics();
    recordDescriptionSlotAttestation(metrics, 'empty');
    recordDescriptionSlotAttestation(metrics, 'refused', 'shared_evidence_url');
    recordDescriptionSlotAttestation(metrics, 'refused', 'shared_evidence_url');
    recordDescriptionSlotAttestation(metrics, undefined);

    expect(metrics).toEqual({
      vocabulary: DESCRIPTION_SLOT_ATTESTATION_VOCABULARY,
      empty: 1,
      refused: 2,
      unclaimed: 1,
      refusedByGuard: { shared_evidence_url: 2 },
    });
  });

  const usableProseReads: Array<[string, () => ReturnType<typeof refusalFor>]> = [
    ['an unnamed lab page', () => refusalFor(RESEARCH_PROSE)],
    [
      'a page listing its topics',
      () => refusalFor(RESEARCH_PROSE, {}, { topics: ['Neuroimmunology'] }),
    ],
    [
      'a person-scoped page',
      () =>
        refusalFor(RESEARCH_PROSE, {
          entityKey: 'directory-faculty-fixture-person',
          entityType: 'FACULTY_RESEARCH_AREA',
          kind: 'individual',
        }),
    ],
    [
      'a page with a subject of the entity itself',
      () => refusalFor(RESEARCH_PROSE, {}, { subject: 'named_entity' }),
    ],
  ];

  it.each(usableProseReads)('emits observations for %s that no guard refuses', (_label, run) => {
    const outcome = run();

    expect(outcome.refusal).toBeUndefined();
    expect(outcome.observations.map((observation) => observation.field)).toContain(
      'fullDescription',
    );
  });

  it('leaves no unnamed early return in the extraction, so a new guard has to name itself', () => {
    const source = fs.readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../sources/labMicrositeDescriptionLLMExtractor.ts',
      ),
      'utf8',
    );
    const start = source.indexOf('export function describeDescriptionExtraction(');
    const end = source.indexOf('\n}\n', start);
    const body = source
      .slice(start, end)
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    const returns = (body.match(/\breturn\b[^;]*;/g) ?? []).map((statement) =>
      statement.replace(/\s+/g, ' '),
    );
    const unnamed = returns.filter((statement) => !/^return refusedBy\([^)]*\);$/.test(statement));

    expect(start).toBeGreaterThan(-1);
    expect(returns.length).toBeGreaterThan(unnamed.length);
    expect(unnamed).toEqual(['return { observations: [] };', 'return { observations };']);
  });
});
