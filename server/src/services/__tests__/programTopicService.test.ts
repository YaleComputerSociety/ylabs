import { describe, expect, it } from 'vitest';
import {
  inferProgramSubjects,
  programSubjectFilterOptions,
  resolveTopicSubjects,
  topicRegexForSubjects,
  yearOfStudyAliasesForQuery,
} from '../programTopicService';

describe('programTopicService', () => {
  it('offers every subject filter in alphabetical order so no field leads the list', () => {
    const options = programSubjectFilterOptions();
    expect(options).toEqual([...options].sort((a, b) => a.localeCompare(b)));
    expect(options).toContain('Social Sciences');
    expect(options).toContain('Humanities and Arts');
    expect(options[0]).toBe('Artificial Intelligence');
    expect(options[1]).toBe('Biology');
  });

  it('normalizes short and long AI topic aliases to canonical subjects', () => {
    expect(resolveTopicSubjects(['AI systems and NLP'])).toEqual([
      'Artificial Intelligence',
      'Language and Text',
    ]);
  });

  it('keeps short aliases token-boundary aware in database facets', () => {
    const pattern = new RegExp(topicRegexForSubjects(['Artificial Intelligence']), 'i');

    expect(pattern.test('AI and machine learning research')).toBe(true);
    expect(pattern.test('Application details are available')).toBe(false);
    expect(pattern.test('Contact by email')).toBe(false);
  });

  it('infers subjects only from supported program text', () => {
    expect(
      inferProgramSubjects({
        title: 'Schmidt Program for Artificial Intelligence',
        summary: 'Supports machine learning research in health and medicine.',
      }),
    ).toEqual(['Artificial Intelligence', 'Health and Medicine']);
    expect(inferProgramSubjects({ title: 'General Research Award' })).toEqual([]);
  });
});

describe('yearOfStudyAliasesForQuery', () => {
  it("maps a student's word for their year onto the year the sources publish", () => {
    expect(yearOfStudyAliasesForQuery('research for freshmen with no experience')).toEqual([
      'first-year',
    ]);
    expect(yearOfStudyAliasesForQuery('Freshman')).toEqual(['first-year']);
    expect(yearOfStudyAliasesForQuery('summer research in my first year')).toEqual(['first-year']);
    expect(yearOfStudyAliasesForQuery('programs for sophomores')).toEqual(['sophomore']);
  });

  it('adds nothing to a query that names no year', () => {
    expect(yearOfStudyAliasesForQuery('neuroscience')).toEqual([]);
    expect(yearOfStudyAliasesForQuery('paid summer research')).toEqual([]);
    expect(yearOfStudyAliasesForQuery('')).toEqual([]);
  });
});
