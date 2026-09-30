import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  controlledVocabularyHeadings,
  controlledVocabularyHeadingsAreWarm,
  normalizedVocabularyHeading,
  resetControlledVocabularyHeadingsCache,
  resetUnwarmedVocabularySplitReport,
  warmControlledVocabularyHeadings,
  CONTROLLED_VOCABULARY_RESEARCH_AREA_SOURCES,
} from '../controlledVocabularyHeadings';
import { normalizeResearchAreaList, splitDelimitedResearchArea } from '../researchAreaHygiene';
import { Observation } from '../../models/observation';

const stubObservations = (values: unknown[]) =>
  vi.spyOn(Observation, 'find').mockReturnValue({
    select: () => ({ lean: async () => values.map((value) => ({ value })) }),
  } as never);

afterEach(() => {
  vi.restoreAllMocks();
  resetControlledVocabularyHeadingsCache();
  resetUnwarmedVocabularySplitReport();
});

describe('warmControlledVocabularyHeadings', () => {
  it('keeps only the comma-carrying terms, because nothing else can reach the split', async () => {
    stubObservations([['Microscopy, Fluorescence, Multiphoton', 'Neurobiology', 'Genomics']]);

    const headings = await warmControlledVocabularyHeadings();

    expect([...headings]).toEqual(['microscopy, fluorescence, multiphoton']);
  });

  it('reads both controlled-vocabulary lanes and nothing else', async () => {
    const find = stubObservations([]);

    await warmControlledVocabularyHeadings();

    expect(find).toHaveBeenCalledWith({
      sourceName: { $in: [...CONTROLLED_VOCABULARY_RESEARCH_AREA_SOURCES] },
      field: 'researchAreas',
    });
  });

  it('serves the cached set inside the window rather than re-reading', async () => {
    const find = stubObservations([['Education, Medical, Graduate']]);

    await warmControlledVocabularyHeadings(1_000);
    await warmControlledVocabularyHeadings(2_000);

    expect(find).toHaveBeenCalledTimes(1);
  });

  it('re-reads once the window has passed, so a newly published heading arrives', async () => {
    const find = stubObservations([['Education, Medical, Graduate']]);

    await warmControlledVocabularyHeadings(0);
    await warmControlledVocabularyHeadings(60 * 60 * 1000 + 1);

    expect(find).toHaveBeenCalledTimes(2);
  });

  it('shares one read between callers that arrive while it is running', async () => {
    const find = stubObservations([['Education, Medical, Graduate']]);

    const [first, second] = await Promise.all([
      warmControlledVocabularyHeadings(0),
      warmControlledVocabularyHeadings(0),
    ]);

    expect(find).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('keeps no result from a read that a reset overtook', async () => {
    let release: (rows: unknown[]) => void = () => {};
    vi.spyOn(Observation, 'find').mockReturnValue({
      select: () => ({ lean: () => new Promise((resolve) => (release = resolve)) }),
    } as never);

    const overtaken = warmControlledVocabularyHeadings(0);
    resetControlledVocabularyHeadingsCache();
    release([{ value: ['Education, Medical, Graduate'] }]);
    await overtaken;

    expect(controlledVocabularyHeadingsAreWarm()).toBe(false);
  });
});

describe('splitDelimitedResearchArea against a loaded vocabulary', () => {
  /**
   * The defect: a three-level heading's parts after the first are qualifiers, so splitting it
   * serves two chips that say nothing. Each pair below was read on Development.
   */
  it.each([
    'Education, Medical, Graduate',
    'Lymphoma, T-Cell, Cutaneous',
    'Hepatitis, Viral, Human',
    'Antigens, Differentiation, T-Lymphocyte',
    'Technology, Industry, Agriculture',
  ])('keeps %s whole when the vocabulary asserts it', async (heading) => {
    stubObservations([[heading]]);
    await warmControlledVocabularyHeadings();

    expect(splitDelimitedResearchArea(heading)).toEqual([heading]);
  });

  it('matches the vocabulary through the normalized form, not the raw text', async () => {
    stubObservations([['Education, Medical, Graduate']]);
    await warmControlledVocabularyHeadings();

    expect(splitDelimitedResearchArea('education,  medical,  graduate')).toEqual([
      'education,  medical,  graduate',
    ]);
  });

  /**
   * The other half of the rule, and the reason this is not simply "stop splitting": a list a
   * person typed really is several topics, and each is its own facet value.
   */
  it('still splits a list no controlled vocabulary asserts', async () => {
    stubObservations([['Education, Medical, Graduate']]);
    await warmControlledVocabularyHeadings();

    expect(splitDelimitedResearchArea('Obesity, Physical Activity, Diet')).toEqual([
      'Obesity',
      'Physical Activity',
      'Diet',
    ]);
  });

  it('leaves the existing conjunction and colon rules deciding first', async () => {
    stubObservations([[]]);
    await warmControlledVocabularyHeadings();

    expect(splitDelimitedResearchArea('Health Care Quality, Access, and Evaluation')).toEqual([
      'Health Care Quality, Access, and Evaluation',
    ]);
    expect(splitDelimitedResearchArea('Modern South Asia: India, Pakistan, Bangladesh')).toEqual([
      'Modern South Asia: India, Pakistan, Bangladesh',
    ]);
  });

  it('splits a two-comma label when the vocabulary is loaded but does not name it', async () => {
    stubObservations([['Lymphoma, T-Cell, Cutaneous']]);
    await warmControlledVocabularyHeadings();

    expect(
      normalizeResearchAreaList(['Lymphoma, T-Cell, Cutaneous', 'Diversity, Equity, Now']),
    ).toEqual(['Lymphoma, T-Cell, Cutaneous', 'Diversity', 'Equity', 'Now']);
  });
});

describe('an unwarmed vocabulary', () => {
  /**
   * The cold window is real: the splitter is synchronous, so a process that has not warmed
   * behaves exactly as it did before this change. That is the safe direction, and it is said
   * out loud rather than left as an inert fix nobody notices.
   */
  it('behaves as before, and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(controlledVocabularyHeadingsAreWarm()).toBe(false);
    expect(splitDelimitedResearchArea('Education, Medical, Graduate')).toEqual([
      'Education',
      'Medical',
      'Graduate',
    ]);
    expect(splitDelimitedResearchArea('Lymphoma, T-Cell, Cutaneous')).toHaveLength(3);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('#3807');
  });

  it('says nothing once warm, however many labels are split', async () => {
    stubObservations([[]]);
    await warmControlledVocabularyHeadings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    splitDelimitedResearchArea('Obesity, Physical Activity, Diet');

    expect(warn).not.toHaveBeenCalled();
  });

  it('reports an empty set before any warm', () => {
    expect(controlledVocabularyHeadings().size).toBe(0);
  });
});

describe('normalizedVocabularyHeading', () => {
  it('folds case and collapses whitespace, so one heading is one key', () => {
    expect(normalizedVocabularyHeading('  Education,   Medical,  Graduate ')).toBe(
      'education, medical, graduate',
    );
  });
});
