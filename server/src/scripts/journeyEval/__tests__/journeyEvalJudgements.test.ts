import { describe, expect, it } from 'vitest';
import { parseTopicQueryJudgements } from '../journeyEvalJudgements';
import { checkQueryRelevance, scoreQueryRelevance } from '../journeyEvalMetrics';

describe('parseTopicQueryJudgements', () => {
  it('defaults topK and requires every relevant result when minRelevant is omitted', () => {
    const set = parseTopicQueryJudgements({
      queries: [{ query: 'neuroscience', relevantWhen: { anyTopicMatches: ['neuro'] } }],
    });

    expect(set.queries[0].topK).toBe(10);
    expect(set.queries[0].minRelevant).toBe(10);
  });

  it('accepts a zero-result judgement with no matcher', () => {
    const set = parseTopicQueryJudgements({
      queries: [{ query: 'not a topic', expectNoResults: true }],
    });

    expect(set.queries[0].expectNoResults).toBe(true);
  });

  it('rejects a judgement that asserts nothing', () => {
    expect(() => parseTopicQueryJudgements({ queries: [{ query: 'neuroscience' }] })).toThrow(
      /expectNoResults or supply at least one relevantWhen matcher/,
    );
  });

  it('rejects a minRelevant that can never be satisfied', () => {
    expect(() =>
      parseTopicQueryJudgements({
        queries: [
          {
            query: 'neuroscience',
            topK: 5,
            minRelevant: 6,
            relevantWhen: { anyTopicMatches: ['neuro'] },
          },
        ],
      }),
    ).toThrow(/outside 0\.\.topK/);
  });

  it('rejects a matcher that is not an array of strings', () => {
    expect(() =>
      parseTopicQueryJudgements({
        queries: [{ query: 'neuroscience', relevantWhen: { anyTopicMatches: 'neuro' } }],
      }),
    ).toThrow(/anyTopicMatches that is not an array of strings/);
  });

  it('rejects a file with no queries array', () => {
    expect(() => parseTopicQueryJudgements({})).toThrow(/must carry a queries array/);
  });
});

describe('scoreQueryRelevance', () => {
  it('scores precision over the judged window and finds the first relevant rank', () => {
    const score = scoreQueryRelevance('neuroscience', [false, true, true, true], 10, 458);

    expect(score.judged).toBe(4);
    expect(score.relevant).toBe(3);
    expect(score.precisionAtK).toBe(0.75);
    expect(score.firstRelevantRank).toBe(2);
    expect(score.served).toBe(458);
  });

  it('truncates the judged window to topK', () => {
    const score = scoreQueryRelevance('q', [true, true, true, false], 2, 99);

    expect(score.judged).toBe(2);
    expect(score.relevant).toBe(2);
    expect(score.precisionAtK).toBe(1);
  });

  it('reports no first relevant rank when nothing matched', () => {
    expect(scoreQueryRelevance('q', [false, false], 10, 2).firstRelevantRank).toBeNull();
  });
});

describe('checkQueryRelevance', () => {
  it('passes when the relevant count clears the floor', () => {
    const score = scoreQueryRelevance('q', [true, true, true, false], 4, 4);

    expect(checkQueryRelevance(score, 3).status).toBe('pass');
    expect(checkQueryRelevance(score, 4).status).toBe('fail');
  });

  it('is inconclusive rather than passing when the query returned nothing to judge', () => {
    const score = scoreQueryRelevance('q', [], 10, 0);

    expect(checkQueryRelevance(score, 0).status).toBe('inconclusive');
  });
});
