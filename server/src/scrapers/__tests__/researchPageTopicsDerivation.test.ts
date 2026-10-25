import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
  currentResearchPageTextObservation,
  derivedResearchAreaCandidateFor,
  derivedResearchAreaProvenance,
  researchPageTextHash,
  researchPageTopicsStateFor,
  researchTopicsDerivationInputHash,
  storedDerivedResearchAreasAreStale,
  type StoredResearchTopicsDerivation,
} from '../researchPageTopicsDerivation';
import { RESEARCH_PAGE_TEXT_FIELD, RESEARCH_PAGE_TEXT_SOURCE } from '../utils/researchPageText';
import {
  PAGE_QUOTED_RESEARCH_TOPICS_SOURCE,
  PAGE_QUOTED_TOPICS_FILTER_CONTRACT,
} from '../utils/pageQuotedResearchTopics';
import {
  fieldProvenanceEntryIsBacked,
  RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME,
} from '../../models/fieldProvenanceBacking';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = 'https://tidepool-lab.example.org/';
const pages = [
  { url: HOME, text: 'We study how coastal kelp forests recover after marine heatwaves.' },
];

const pageTextObservation = (value: unknown, observedAt = '2026-10-01T00:00:00Z') => ({
  field: RESEARCH_PAGE_TEXT_FIELD,
  sourceName: RESEARCH_PAGE_TEXT_SOURCE,
  value,
  observedAt: new Date(observedAt),
  superseded: false,
});

const cacheOf = (entries: StoredResearchTopicsDerivation[]) =>
  vi.fn(
    async (inputHash: string) => entries.find((entry) => entry.inputHash === inputHash) ?? null,
  );

const extraction = {
  extractedTopics: [
    { topic: 'Kelp forests', quote: 'how coastal kelp forests recover', url: HOME },
    { topic: 'Marine heatwaves', quote: 'recover after marine heatwaves', url: HOME },
    { topic: 'Coral bleaching', quote: 'coral bleaching events', url: HOME },
  ],
  extractedField: { topic: 'Marine ecology', quote: 'We study how coastal kelp', url: HOME },
};

describe('researchTopicsDerivationInputHash', () => {
  it('changes with the text, the prompt and the model, never the filters', () => {
    const base = researchTopicsDerivationInputHash(pages);
    expect(researchTopicsDerivationInputHash(pages)).toBe(base);
    expect(
      researchTopicsDerivationInputHash([{ url: HOME, text: `${pages[0].text} More.` }]),
    ).not.toBe(base);
    for (const key of ['promptHash', 'model'] as const) {
      expect(
        researchTopicsDerivationInputHash(pages, {
          ...CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
          [key]: 'changed',
        }),
      ).not.toBe(base);
    }
    expect(Object.keys(CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS).sort()).toEqual([
      'model',
      'promptHash',
    ]);
  });
});

describe('researchPageTopicsStateFor', () => {
  it('filters the cached raw reading against the current stored text', async () => {
    const inputHash = researchTopicsDerivationInputHash(pages);
    const lookup = cacheOf([{ inputHash, ...extraction }]);
    const state = await researchPageTopicsStateFor([pageTextObservation(pages)], lookup);
    expect(lookup).toHaveBeenCalledWith(inputHash);
    expect(state.currentTextHash).toBe(researchPageTextHash(pages));
    expect(state.candidate).toMatchObject({
      field: 'researchAreas',
      value: ['Kelp forests', 'Marine heatwaves', 'Marine ecology'],
      sourceName: PAGE_QUOTED_RESEARCH_TOPICS_SOURCE,
      sourceUrl: HOME,
      derivationTextHash: researchPageTextHash(pages),
      derivationContract: PAGE_QUOTED_TOPICS_FILTER_CONTRACT,
    });
    expect(state.candidate?.observedAt.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('ignores a reading of text the row no longer carries', async () => {
    const staleHash = researchTopicsDerivationInputHash(pages);
    const lookup = cacheOf([{ inputHash: staleHash, ...extraction }]);
    const changed = [
      { url: HOME, text: 'We now study seagrass meadows and their carbon storage.' },
    ];
    const state = await researchPageTopicsStateFor([pageTextObservation(changed)], lookup);
    expect(state.candidate).toBeUndefined();
    expect(state.currentTextHash).toBe(researchPageTextHash(changed));
  });

  it('contributes nothing for cleared text, an empty reading, no cache or no page text', async () => {
    const inputHash = researchTopicsDerivationInputHash(pages);
    const empty = cacheOf([{ inputHash, extractedTopics: [], extractedField: null }]);
    expect(await derivedResearchAreaCandidateFor([pageTextObservation([])], empty)).toBe(undefined);
    expect(await derivedResearchAreaCandidateFor([pageTextObservation(pages)], empty)).toBe(
      undefined,
    );
    expect(await derivedResearchAreaCandidateFor([pageTextObservation(pages)], cacheOf([]))).toBe(
      undefined,
    );
    expect(await researchPageTopicsStateFor([], empty)).toEqual({});
  });

  it('reports the current text hash whether or not the cache holds a reading', async () => {
    const inputHash = researchTopicsDerivationInputHash(pages);
    const empty = cacheOf([{ inputHash, extractedTopics: [], extractedField: null }]);
    expect(await researchPageTopicsStateFor([pageTextObservation(pages)], empty)).toEqual({
      currentTextHash: researchPageTextHash(pages),
    });
    expect(await researchPageTopicsStateFor([pageTextObservation(pages)], cacheOf([]))).toEqual({
      currentTextHash: researchPageTextHash(pages),
    });
  });

  it('records both the full input hash and the text-only hash on the candidate', async () => {
    const inputHash = researchTopicsDerivationInputHash(pages);
    const lookup = cacheOf([{ inputHash, ...extraction }]);
    const { candidate } = await researchPageTopicsStateFor([pageTextObservation(pages)], lookup);
    expect(candidate?.derivationInputHash).toBe(inputHash);
    expect(candidate?.derivationTextHash).toBe(researchPageTextHash(pages));
    expect(candidate?.derivationTextHash).not.toBe(inputHash);
  });

  it('reads the newest live page text only', () => {
    const older = pageTextObservation(pages, '2026-09-01T00:00:00Z');
    const newer = pageTextObservation([], '2026-10-01T00:00:00Z');
    const superseded = { ...pageTextObservation(pages, '2026-11-01T00:00:00Z'), superseded: true };
    const otherSource = { ...pageTextObservation(pages, '2026-12-01T00:00:00Z'), sourceName: 'x' };
    expect(currentResearchPageTextObservation([older, newer, superseded, otherSource])).toBe(newer);
  });
});

describe('storedDerivedResearchAreasAreStale', () => {
  const textHash = researchPageTextHash(pages);
  const stored = {
    sourceName: PAGE_QUOTED_RESEARCH_TOPICS_SOURCE,
    sourceUrl: HOME,
    confidence: 0.85,
    derivationInputHash: researchTopicsDerivationInputHash(pages),
    derivationTextHash: textHash,
    derivationContract: PAGE_QUOTED_TOPICS_FILTER_CONTRACT,
  };

  it('is stale when a current reading exists and its text hashes differently', () => {
    expect(storedDerivedResearchAreasAreStale(stored, { currentTextHash: 'other' })).toBe(true);
    expect(storedDerivedResearchAreasAreStale(stored, { currentTextHash: textHash })).toBe(false);
  });

  it('stands when the text is unchanged but the prompt or model has no reading yet', async () => {
    const state = await researchPageTopicsStateFor([pageTextObservation(pages)], cacheOf([]));
    expect(storedDerivedResearchAreasAreStale(stored, state)).toBe(false);
  });

  it('stands when only the prompt or model changed, whatever the current reading says', () => {
    const fromAnEarlierPrompt = {
      ...stored,
      derivationInputHash: researchTopicsDerivationInputHash(pages, {
        ...CURRENT_RESEARCH_TOPICS_DERIVATION_INPUTS,
        promptHash: 'an-earlier-prompt',
      }),
    };
    expect(
      storedDerivedResearchAreasAreStale(fromAnEarlierPrompt, { currentTextHash: textHash }),
    ).toBe(false);
  });

  it('stands when other filters judged it and the text is unchanged', () => {
    const judgedByOtherFilters = { ...stored, derivationContract: 'page-quoted-topics-v0' };
    expect(
      storedDerivedResearchAreasAreStale(judgedByOtherFilters, { currentTextHash: textHash }),
    ).toBe(false);
  });

  it('stands when the row has no page-text reading, as on Beta and Production', () => {
    expect(storedDerivedResearchAreasAreStale(stored, {})).toBe(false);
  });

  it('never judges a list another source is credited with', () => {
    expect(
      storedDerivedResearchAreasAreStale(
        { sourceName: 'ysm-mesh-keyword' },
        { currentTextHash: 'other' },
      ),
    ).toBe(false);
  });
});

describe('derivedResearchAreaProvenance', () => {
  it('is a backed, time-free entry in schema key order that names its input and contract', () => {
    const entry = derivedResearchAreaProvenance({
      sourceName: PAGE_QUOTED_RESEARCH_TOPICS_SOURCE,
      sourceUrl: HOME,
      confidence: 0.85,
      derivationInputHash: 'input-hash',
      derivationTextHash: 'text-hash',
      derivationContract: PAGE_QUOTED_TOPICS_FILTER_CONTRACT,
    });
    expect(Object.keys(entry)).toEqual([
      'sourceName',
      'sourceUrl',
      'confidence',
      'derivationInputHash',
      'derivationTextHash',
      'derivationContract',
    ]);
    expect(entry.sourceName).toBe(RESEARCH_PAGE_TOPICS_DERIVED_SOURCE_NAME);
    expect(fieldProvenanceEntryIsBacked(entry)).toBe(true);
  });
});

describe('the materialize-time derivation module', () => {
  it('never calls a model and never fetches', () => {
    const source = fs.readFileSync(
      path.resolve(HERE, '../researchPageTopicsDerivation.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/axios|openai|chat\/completions|fetchPage|httpFetch|\bfetch\(/i);
  });
});
