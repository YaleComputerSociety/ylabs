import { describe, expect, it } from 'vitest';
import { gatherCoverageSnippets } from '../coverageSynthesis';
import { cardDescriptionEvidence } from '../entityMaterializer';
import { planPreGroundingStoredDescriptionClears } from '../refusedStoredDescription';
import {
  isPreGroundingExtractionProse,
  isUngroundedPreGroundingExtractionProse,
  PAGE_GROUNDING_VERIFIED_SINCE,
} from '../descriptionExtractionGrounding';
import { toPublicResearchEntityDto } from '../../services/researchEntityDto';
import {
  buildResearchEntitySearchEmbedderConfig,
  buildResearchEntitySearchIndexDocument,
  RESEARCH_ENTITY_SEARCH_INDEX_DOCUMENT_FIELDS,
} from '../../services/researchEntitySearchIndexService';

const PASSAGES = [
  'We study how glacier meltwater reshapes membrane biology in alpine microbes.',
  'Our current projects ask how lipid packing changes as meltwater chemistry shifts.',
];

describe('page research text as writer evidence', () => {
  it('reads each stored passage as its own writer snippet', () => {
    const snippets = gatherCoverageSnippets([
      {
        field: 'researchSummary',
        value: PASSAGES,
        sourceName: 'lab-site-research-read',
        sourceUrl: 'https://example.org/lab/quillfeather/',
      },
    ]);
    expect(snippets.map((snippet) => snippet.text)).toEqual(PASSAGES);
  });

  it('checks a card against every stored passage', () => {
    expect(
      cardDescriptionEvidence([
        {
          field: 'researchSummary',
          value: PASSAGES,
          sourceName: 'lab-site-research-read',
          confidence: 0.6,
          observedAt: new Date('2026-10-19T00:00:00Z'),
        },
      ]),
    ).toEqual(PASSAGES);
  });
});

describe('model-lane prose stored before the lane checked it against its page', () => {
  const before = new Date(PAGE_GROUNDING_VERIFIED_SINCE.getTime() - 1);
  const after = new Date(PAGE_GROUNDING_VERIFIED_SINCE.getTime() + 1);

  it('is refused for the body and the card, and only for that lane', () => {
    for (const field of ['fullDescription', 'shortDescription']) {
      expect(
        isPreGroundingExtractionProse({
          sourceName: 'lab-microsite-description-llm',
          field,
          observedAt: before,
        }),
      ).toBe(true);
      expect(
        isPreGroundingExtractionProse({
          sourceName: 'lab-microsite-description-llm',
          field,
          observedAt: after,
        }),
      ).toBe(false);
      expect(
        isPreGroundingExtractionProse({
          sourceName: 'dept-faculty-roster',
          field,
          observedAt: before,
        }),
      ).toBe(false);
    }
    expect(
      isPreGroundingExtractionProse({
        sourceName: 'lab-microsite-description-llm',
        field: 'name',
        observedAt: before,
      }),
    ).toBe(false);
  });

  it('is admitted again once the code lane stored the same text from the page', () => {
    const body = {
      sourceName: 'lab-microsite-description-llm',
      field: 'fullDescription',
      observedAt: before,
      value: PASSAGES[0],
    };
    expect(isUngroundedPreGroundingExtractionProse(body, '')).toBe(true);
    expect(isUngroundedPreGroundingExtractionProse(body, PASSAGES.join('\n'))).toBe(false);
    expect(
      isUngroundedPreGroundingExtractionProse(
        { ...body, value: 'An invented paraphrase the page never carried at all.' },
        PASSAGES.join('\n'),
      ),
    ).toBe(true);
  });

  it('is left out of the evidence a card is checked against', () => {
    expect(
      cardDescriptionEvidence([
        {
          field: 'fullDescription',
          value: 'An invented paraphrase of a lab that was never checked against its page.',
          sourceName: 'lab-microsite-description-llm',
          confidence: 0.82,
          observedAt: before,
        },
      ]),
    ).toEqual([]);
  });
});

describe('a stored description the model lane wrote before it checked its page', () => {
  const before = new Date(PAGE_GROUNDING_VERIFIED_SINCE.getTime() - 86_400_000);
  const stored = (observedAt: Date, sourceName = 'lab-microsite-description-llm') => ({
    fullDescription: 'An invented paraphrase of a lab that was never checked against its page.',
    shortDescription: 'An invented card.',
    fieldProvenance: {
      fullDescription: { sourceName, observedAt },
      shortDescription: { sourceName, observedAt },
    },
  });

  it('is cleared on resolve, body and card, unless locked or replaced this pass', () => {
    expect(
      planPreGroundingStoredDescriptionClears({ stored: stored(before), lockedFields: [] }),
    ).toEqual([
      { field: 'fullDescription', skipped: null },
      { field: 'shortDescription', skipped: null },
    ]);
    expect(
      planPreGroundingStoredDescriptionClears({
        stored: stored(before),
        staged: { fullDescription: 'A body this pass resolved from a checked source.' },
        lockedFields: ['shortDescription'],
      }),
    ).toEqual([{ field: 'shortDescription', skipped: 'field-is-locked' }]);
  });

  it('is kept when it was checked, or when another lane wrote it', () => {
    const after = new Date(PAGE_GROUNDING_VERIFIED_SINCE.getTime() + 86_400_000);
    expect(
      planPreGroundingStoredDescriptionClears({ stored: stored(after), lockedFields: [] }),
    ).toEqual([]);
    expect(
      planPreGroundingStoredDescriptionClears({
        stored: stored(before, 'coverage-synthesis-llm'),
        lockedFields: [],
      }),
    ).toEqual([]);
    expect(
      planPreGroundingStoredDescriptionClears({
        stored: stored(before),
        lockedFields: [],
        pageResearchText:
          'An invented paraphrase of a lab that was never checked against its page. An invented card.',
      }),
    ).toEqual([]);
  });
});

describe('methods are no longer served', () => {
  const row = {
    _id: '64b000000000000000000001',
    slug: 'quillfeather-lab',
    name: 'Quillfeather Lab',
    entityType: 'LAB',
    researchAreas: ['Glacier Hydrology'],
    methods: ['Cryo-electron tomography', 'Lipidomics'],
  };

  it('leaves methods out of the public research DTO', () => {
    expect(toPublicResearchEntityDto(row, { leadMemberNames: [] })).not.toHaveProperty('methods');
  });

  it('leaves methods out of the search document, its searchable fields and its embedding text', () => {
    expect(buildResearchEntitySearchIndexDocument(row)).not.toHaveProperty('methods');
    expect(RESEARCH_ENTITY_SEARCH_INDEX_DOCUMENT_FIELDS).not.toContain('methods');
    expect(JSON.stringify(buildResearchEntitySearchEmbedderConfig('XXX-redacted'))).not.toMatch(
      /methods/i,
    );
  });
});
