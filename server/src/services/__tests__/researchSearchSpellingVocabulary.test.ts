import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getResearchSearchSpellingVocabulary,
  loadResearchSearchSpellingVocabulary,
  setResearchSearchSpellingVocabularyForTests,
  warmResearchSearchSpellingVocabulary,
} from '../researchSearchSpellingVocabulary';
import { correctSearchQuerySpelling } from '../searchQuerySpellingCorrection';

const page = (count: number, hit: Record<string, unknown>) => ({
  hits: Array.from({ length: count }, () => hit),
});

describe('research search spelling vocabulary', () => {
  afterEach(() => setResearchSearchSpellingVocabularyForTests(null));

  it('pages through every unarchived document with the search-only key', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce(
        page(1000, { researchAreas: ['immunology'], studentVisibilityTier: 'student_ready' }),
      )
      .mockResolvedValueOnce(
        page(3, {
          name: 'Example Lab',
          fullDescription: 'immunology',
          studentVisibilityTier: 'student_ready',
        }),
      );

    const vocabulary = await loadResearchSearchSpellingVocabulary(async () => ({ search }));

    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls.map(([, params]) => params.offset)).toEqual([0, 1000]);
    expect(search.mock.calls.every(([, params]) => params.filter === 'archived = false')).toBe(
      true,
    );
    expect(vocabulary.documentCount).toBe(1003);
    expect(vocabulary.documentFrequency.get('immunology')).toBe(1003);
    expect(vocabulary.nameTerms.has('example')).toBe(true);
    expect(vocabulary.nameTerms.has('immunology')).toBe(false);
  });

  it('protects a word that appears in a member name field', async () => {
    const search = vi.fn().mockResolvedValueOnce({
      hits: [
        ...Array.from({ length: 10 }, () => ({
          researchAreas: ['quelling'],
          studentVisibilityTier: 'student_ready',
        })),
        { leadProfessorNames: ['Zorvath Quellin'], studentVisibilityTier: 'operator_review' },
      ],
    });

    const vocabulary = await loadResearchSearchSpellingVocabulary(async () => ({ search }));

    expect(correctSearchQuerySpelling('quellin', vocabulary).corrections).toEqual([]);
  });

  it('counts only words a student can be served', async () => {
    const search = vi.fn().mockResolvedValueOnce({
      hits: [
        ...Array.from({ length: 10 }, () => ({
          researchAreas: ['krestology'],
          studentVisibilityTier: 'suppressed',
        })),
        ...Array.from({ length: 4 }, () => ({
          researchAreas: ['genetics'],
          studentVisibilityTier: 'student_ready',
        })),
      ],
    });

    const vocabulary = await loadResearchSearchSpellingVocabulary(async () => ({ search }));

    expect(vocabulary.documentCount).toBe(4);
    expect(vocabulary.documentFrequency.has('krestology')).toBe(false);
    expect(correctSearchQuerySpelling('krestolgy', vocabulary).corrections).toEqual([]);
    expect(correctSearchQuerySpelling('gentics', vocabulary).query).toBe('genetics');
  });

  it('keeps the previous vocabulary when a refresh fails', async () => {
    const loaded = await warmResearchSearchSpellingVocabulary(async () =>
      loadResearchSearchSpellingVocabulary(async () => ({
        search: vi
          .fn()
          .mockResolvedValue(
            page(5, { researchAreas: ['genetics'], studentVisibilityTier: 'student_ready' }),
          ),
      })),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const afterFailure = await warmResearchSearchSpellingVocabulary(async () => {
      throw new Error('meilisearch unavailable');
    });

    expect(afterFailure).toBe(loaded);
    expect(getResearchSearchSpellingVocabulary()).toBe(loaded);
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
