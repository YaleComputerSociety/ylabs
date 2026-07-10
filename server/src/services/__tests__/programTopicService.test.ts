import { describe, expect, it } from 'vitest';
import { inferProgramSubjects, resolveTopicSubjects } from '../programTopicService';

describe('programTopicService', () => {
  it('normalizes short and long AI topic aliases to canonical subjects', () => {
    expect(resolveTopicSubjects(['AI systems and NLP'])).toEqual([
      'Artificial Intelligence',
      'Language and Text',
    ]);
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
