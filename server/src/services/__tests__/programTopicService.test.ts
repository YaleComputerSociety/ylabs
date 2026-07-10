import { describe, expect, it } from 'vitest';
import {
  inferProgramSubjects,
  resolveTopicSubjects,
  topicRegexForSubjects,
} from '../programTopicService';

describe('programTopicService', () => {
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
