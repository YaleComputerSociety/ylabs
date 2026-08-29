/**
 * #2272: a page that may not NAME this record may not DESCRIBE it either.
 *
 * #2253 refused an affiliated organization's or another person's lab name as a
 * person-scoped record's identity, but left that page's prose in place. So every
 * lab member whose profile linked their principal investigator's lab site kept
 * the lab's research paragraph as their own research description, and one
 * paragraph was served by eight different records.
 *
 * The second and third cases here guard the deliberately narrow scope. Only a
 * provably foreign PERSON'S lab suppresses prose; an affiliated ORGANIZATION name
 * harvested off a person's own site does not, because that shape is usually a
 * correct description of the person under an affiliation line the model returned
 * as the name.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  LabMicrositeDescriptionLLMExtractor,
  descriptionExtractionToObservations,
  extractedPageDescribesAnotherPersonsLab,
  type DescriptionExtraction,
} from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';

const FOREIGN_LAB_PAGE = 'https://medicine.yale.edu/lab/rhea-vandermolen/';

const FOREIGN_LAB_PROSE =
  'The Vandermolen laboratory is dedicated to developing a high-throughput cryo-electron tomography pipeline for high-resolution structure determination of molecular machines in cells.';

const foreignLabExtraction = (): DescriptionExtraction => ({
  fullDescription: FOREIGN_LAB_PROSE,
  shortDescription: 'Builds a cryo-electron tomography pipeline for molecular machines in cells.',
  topics: ['cryo-electron tomography', 'molecular machines'],
  methods: ['cryo-electron tomography'],
  name: 'The Vandermolen Lab',
});

function makeContext(): { ctx: ScraperContext; emitted: ObservationInput[]; logs: string[] } {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  return {
    emitted,
    logs,
    ctx: {
      scrapeRunId: 'test-run',
      sourceId: 'source-1',
      sourceName: 'lab-microsite-description-llm',
      sourceWeight: 0.5,
      options: {
        dryRun: true,
        useCache: false,
        release: false,
        limit: 10,
        ignoreWorkPlanner: true,
      },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: (msg) => logs.push(msg),
    },
  };
}

describe('foreign lab prose guard (#2272)', () => {
  it('emits nothing from a principal investigator lab page onto a lab member record', () => {
    const observations = descriptionExtractionToObservations(foreignLabExtraction(), {
      entityId: 'entity-member',
      entityKey: 'ysm-faculty-tomasz-okonkwo',
      entityType: 'LAB',
      kind: 'lab',
      sourceUrl: FOREIGN_LAB_PAGE,
    });

    expect(observations).toEqual([]);
  });

  it('still adopts the same page for the principal investigator it belongs to', () => {
    const observations = descriptionExtractionToObservations(foreignLabExtraction(), {
      entityId: 'entity-pi',
      entityKey: 'ysm-rhea-vandermolen',
      entityType: 'LAB',
      kind: 'lab',
      sourceUrl: FOREIGN_LAB_PAGE,
    });

    const fields = observations.map((obs) => obs.field);
    expect(fields).toContain('fullDescription');
    expect(fields).toContain('researchAreas');
    expect(fields).toContain('name');
    expect(observations.find((obs) => obs.field === 'fullDescription')?.value).toBe(
      FOREIGN_LAB_PROSE,
    );
  });

  it('keeps a person description whose harvested name is only an affiliated organization', () => {
    const observations = descriptionExtractionToObservations(
      {
        fullDescription:
          'She studies how financial reporting regulation and the accessibility of information shape the behavior of organizations and the allocation of resources.',
        shortDescription:
          'Studies how financial reporting regulation shapes organizational behavior.',
        topics: [],
        methods: [],
        name: 'Yale Center for Customer Insights',
      },
      {
        entityId: 'entity-affiliated',
        entityKey: 'dept-econ-marisol-abarca',
        entityType: 'FACULTY_RESEARCH_AREA',
        kind: 'individual',
        sourceUrl: 'https://www.marisolabarca-example.org/',
      },
    );

    const fields = observations.map((obs) => obs.field);
    expect(fields).toContain('fullDescription');
    expect(fields).not.toContain('name');
    expect(fields).not.toContain('displayName');
  });

  it('keeps a description when the page states no name of its own', () => {
    const observations = descriptionExtractionToObservations(
      { ...foreignLabExtraction(), name: '' },
      {
        entityId: 'entity-member',
        entityKey: 'ysm-faculty-tomasz-okonkwo',
        entityType: 'LAB',
        kind: 'lab',
        sourceUrl: FOREIGN_LAB_PAGE,
      },
    );

    expect(observations.map((obs) => obs.field)).toContain('fullDescription');
  });

  it('leaves organization-shaped records untouched by the person-lab guard', () => {
    const observations = descriptionExtractionToObservations(foreignLabExtraction(), {
      entityId: 'entity-core',
      entityKey: 'research-yale-shared-imaging-core',
      entityType: 'CORE_FACILITY',
      kind: 'core_facility',
      sourceUrl: FOREIGN_LAB_PAGE,
    });

    expect(observations.map((obs) => obs.field)).toContain('fullDescription');
  });

  it('classifies the page so the methods-only fallback can refuse it too', () => {
    const memberContext = {
      entityKey: 'ysm-faculty-tomasz-okonkwo',
      entityType: 'LAB',
      kind: 'lab',
      sourceUrl: FOREIGN_LAB_PAGE,
    };
    expect(
      extractedPageDescribesAnotherPersonsLab({ name: 'The Vandermolen Lab' }, memberContext),
    ).toBe(true);
    expect(
      extractedPageDescribesAnotherPersonsLab({ name: 'The Vandermolen Lab' }, {
        ...memberContext,
        entityKey: 'ysm-rhea-vandermolen',
      }),
    ).toBe(false);
    expect(extractedPageDescribesAnotherPersonsLab({ name: '' }, memberContext)).toBe(false);
    expect(
      extractedPageDescribesAnotherPersonsLab({ name: 'Yale Center for Customer Insights' }, {
        ...memberContext,
        sourceUrl: 'https://www.marisolabarca-example.org/',
      }),
    ).toBe(false);
  });

  it('emits nothing but the content hash when the page belongs to another lab', async () => {
    const { ctx, emitted } = makeContext();
    ctx.options.only = ['ysm-faculty-tomasz-okonkwo'];
    ctx.options.limit = 1;
    const scraper = new LabMicrositeDescriptionLLMExtractor({
      apiKey: 'test-key',
      labFinder: async () => [
        {
          _id: 'entity-member',
          slug: 'ysm-faculty-tomasz-okonkwo',
          name: 'Vandermolen Lab',
          entityType: 'LAB',
          kind: 'lab',
          websiteUrl: FOREIGN_LAB_PAGE,
        },
      ],
      fetchPage: vi.fn().mockResolvedValue({
        url: FOREIGN_LAB_PAGE,
        html: `<main><h1>The Vandermolen Lab</h1><p>${FOREIGN_LAB_PROSE}</p></main>`,
      }),
      callLLM: vi.fn().mockResolvedValue(foreignLabExtraction()),
      callCardLLM: vi.fn().mockResolvedValue(''),
    });

    await scraper.run(ctx);

    expect(emitted.map((obs) => obs.field)).toEqual(['sourceContentHash']);
  });
});
