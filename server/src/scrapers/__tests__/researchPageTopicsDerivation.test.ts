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

  it("drops a topic that restates the row's own observed department or school (#5957)", async () => {
    const inputHash = researchTopicsDerivationInputHash(pages);
    const lookup = cacheOf([{ inputHash, ...extraction }]);
    const ownLabels = [
      { field: 'departments', value: ['Marine Heatwaves'], superseded: false },
      { field: 'school', value: 'School of the Environment', superseded: false },
    ];
    const state = await researchPageTopicsStateFor(
      [pageTextObservation(pages), ...ownLabels],
      lookup,
    );
    expect(state.candidate?.value).toEqual(['Kelp forests', 'Marine ecology']);
    const retired = await researchPageTopicsStateFor(
      [pageTextObservation(pages), { ...ownLabels[0], superseded: true }],
      lookup,
    );
    expect(retired.candidate?.value).toEqual([
      'Kelp forests',
      'Marine heatwaves',
      'Marine ecology',
    ]);
  });

  it('keeps a topic that equals a program-named stored department (#5957 ruling)', async () => {
    const inputHash = researchTopicsDerivationInputHash(pages);
    const lookup = cacheOf([{ inputHash, ...extraction }]);
    const state = await researchPageTopicsStateFor(
      [
        pageTextObservation(pages),
        {
          field: 'departments',
          value: ['Marine Heatwaves Program', 'Kelp Forests'],
          superseded: false,
        },
      ],
      lookup,
    );
    expect(state.candidate?.value).toEqual(['Marine heatwaves', 'Marine ecology']);
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

describe('re-validating a stored derived list when the current text has no reading (#5882)', () => {
  const rotated = [
    {
      url: HOME,
      text: 'News: the lab welcomes a new postdoc. We study how coastal kelp forests recover after marine heatwaves.',
    },
  ];
  const storedFor = (forPages: typeof pages) => ({
    sourceName: PAGE_QUOTED_RESEARCH_TOPICS_SOURCE,
    sourceUrl: HOME,
    confidence: 0.85,
    derivationInputHash: researchTopicsDerivationInputHash(forPages),
    derivationTextHash: researchPageTextHash(forPages),
    derivationContract: PAGE_QUOTED_TOPICS_FILTER_CONTRACT,
  });
  const priorReading = { inputHash: researchTopicsDerivationInputHash(pages), ...extraction };

  it('keeps the stored reading topics the current text still quotes', async () => {
    const stored = storedFor(pages);
    const state = await researchPageTopicsStateFor(
      [pageTextObservation(rotated)],
      cacheOf([priorReading]),
      stored,
    );
    expect(state.revalidatesStoredList).toBe(true);
    expect(state.currentTextHash).toBe(researchPageTextHash(rotated));
    expect(state.candidate).toMatchObject({
      value: ['Kelp forests', 'Marine heatwaves', 'Marine ecology'],
      sourceName: PAGE_QUOTED_RESEARCH_TOPICS_SOURCE,
      derivationInputHash: stored.derivationInputHash,
      derivationTextHash: stored.derivationTextHash,
      derivationContract: PAGE_QUOTED_TOPICS_FILTER_CONTRACT,
    });
    expect(storedDerivedResearchAreasAreStale(stored, state)).toBe(false);
  });

  it('drops a stored topic the current text no longer supports', async () => {
    const withoutHeatwaves = [
      { url: HOME, text: 'We study how coastal kelp forests recover after storms.' },
    ];
    const state = await researchPageTopicsStateFor(
      [pageTextObservation(withoutHeatwaves)],
      cacheOf([priorReading]),
      storedFor(pages),
    );
    expect(state.candidate?.value).toEqual(['Kelp forests', 'Marine ecology']);
    expect(state.candidate?.value).not.toContain('Marine heatwaves');
  });

  it('withdraws the stored list when no stored topic survives the current text', async () => {
    const stored = storedFor(pages);
    const changed = [
      { url: HOME, text: 'We now study seagrass meadows and their carbon storage.' },
    ];
    const state = await researchPageTopicsStateFor(
      [pageTextObservation(changed)],
      cacheOf([priorReading]),
      stored,
    );
    expect(state.candidate).toBeUndefined();
    expect(state.revalidatesStoredList).toBeUndefined();
    expect(storedDerivedResearchAreasAreStale(stored, state)).toBe(true);
  });

  it('leaves a row whose current text has its own reading on that reading', async () => {
    const currentReading = {
      inputHash: researchTopicsDerivationInputHash(rotated),
      extractedTopics: [
        { topic: 'Kelp forests', quote: 'how coastal kelp forests recover', url: HOME },
      ],
      extractedField: null,
    };
    const lookup = cacheOf([priorReading, currentReading]);
    const stored = storedFor(pages);
    const state = await researchPageTopicsStateFor([pageTextObservation(rotated)], lookup, stored);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(state.revalidatesStoredList).toBeUndefined();
    expect(state.candidate).toMatchObject({
      value: ['Kelp forests'],
      derivationInputHash: currentReading.inputHash,
      derivationTextHash: researchPageTextHash(rotated),
    });
    expect(storedDerivedResearchAreasAreStale(stored, state)).toBe(true);
  });

  it('re-validates nothing for a list another source is credited with or a missing reading', async () => {
    const rotatedObservation = [pageTextObservation(rotated)];
    expect(
      await researchPageTopicsStateFor(rotatedObservation, cacheOf([priorReading]), {
        sourceName: 'ysm-mesh-keyword',
      }),
    ).toEqual({ currentTextHash: researchPageTextHash(rotated) });
    expect(
      await researchPageTopicsStateFor(rotatedObservation, cacheOf([]), storedFor(pages)),
    ).toEqual({ currentTextHash: researchPageTextHash(rotated) });
    expect(await researchPageTopicsStateFor(rotatedObservation, cacheOf([priorReading]))).toEqual({
      currentTextHash: researchPageTextHash(rotated),
    });
  });

  describe('against a school site theme menu (#5939)', () => {
    const themeMenu = [
      'About Us',
      'Who We Are',
      'Research at a Glance',
      'Antimicrobial Resistance',
      'Vector-Borne Diseases',
      'Emerging Infections',
      'Climate Change and Health',
      'Health Equity',
      'Find People',
      'Contact Us',
      'News & Events',
      'Degree Programs',
    ];
    const menuPage = (body: string[]) => [{ url: HOME, text: [...themeMenu, ...body].join('\n') }];
    const before = menuPage([pages[0].text]);
    const menuReading = {
      inputHash: researchTopicsDerivationInputHash(before),
      extractedTopics: [
        { topic: 'Kelp forests', quote: 'how coastal kelp forests recover', url: HOME },
        {
          topic: 'Antimicrobial resistance',
          quote: 'Antimicrobial Resistance Vector-Borne Diseases',
          url: HOME,
        },
        { topic: 'Health equity', quote: 'Climate Change and Health Health Equity', url: HOME },
      ],
      extractedField: null,
    };

    it('never keeps a stored topic only the menu states', async () => {
      const rotatedWithMenu = menuPage([`News: a new seminar. ${pages[0].text}`]);
      const state = await researchPageTopicsStateFor(
        [pageTextObservation(rotatedWithMenu)],
        cacheOf([menuReading]),
        storedFor(before),
      );
      expect(state.revalidatesStoredList).toBe(true);
      expect(state.candidate?.value).toEqual(['Kelp forests']);
    });

    it('withdraws the list when the subject text under the menu is empty', async () => {
      const stored = storedFor(before);
      const state = await researchPageTopicsStateFor(
        [pageTextObservation(menuPage(['Last updated on December 1.']))],
        cacheOf([menuReading]),
        stored,
      );
      expect(state.candidate).toBeUndefined();
      expect(storedDerivedResearchAreasAreStale(stored, state)).toBe(true);
    });
  });

  it('gives the same answer on a second pass over the same evidence', async () => {
    const lookup = cacheOf([priorReading]);
    const stored = storedFor(pages);
    const first = await researchPageTopicsStateFor([pageTextObservation(rotated)], lookup, stored);
    const restored = derivedResearchAreaProvenance(first.candidate!);
    const second = await researchPageTopicsStateFor(
      [pageTextObservation(rotated)],
      lookup,
      restored,
    );
    expect(restored).toEqual(stored);
    expect(second).toEqual(first);
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
