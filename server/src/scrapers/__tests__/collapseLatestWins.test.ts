import { describe, expect, it } from 'vitest';
import { collapseLatestWins } from '../observationStore';

interface TestObs {
  field: string;
  sourceName: string;
  observedAt: Date;
  value: string;
}

const obs = (field: string, sourceName: string, day: number, value: string): TestObs => ({
  field,
  sourceName,
  observedAt: new Date(Date.UTC(2026, 0, day)),
  value,
});

describe('collapseLatestWins', () => {
  it('keeps only the newest row per source for a latest-wins field', () => {
    const log: TestObs[] = [
      obs('fullDescription', 'lab-microsite', 1, 'oldest paraphrase'),
      obs('fullDescription', 'lab-microsite', 5, 'newest paraphrase'),
      obs('fullDescription', 'lab-microsite', 3, 'middle paraphrase'),
    ];
    const result = collapseLatestWins(log, 'researchEntity');
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('newest paraphrase');
  });

  it('keeps every row for a non-latest-wins field', () => {
    const log: TestObs[] = [
      obs('name', 'source-a', 1, 'Alpha Lab'),
      obs('name', 'source-b', 2, 'Alpha Laboratory'),
    ];
    const result = collapseLatestWins(log, 'researchEntity');
    expect(result).toHaveLength(2);
  });

  it('keeps one newest row per distinct source for a latest-wins field', () => {
    const log: TestObs[] = [
      obs('shortDescription', 'source-a', 1, 'a-old'),
      obs('shortDescription', 'source-a', 4, 'a-new'),
      obs('shortDescription', 'source-b', 2, 'b-old'),
      obs('shortDescription', 'source-b', 6, 'b-new'),
    ];
    const result = collapseLatestWins(log, 'researchEntity');
    expect(result.map((r) => r.value).sort()).toEqual(['a-new', 'b-new']);
  });

  it('is idempotent', () => {
    const log: TestObs[] = [
      obs('methods', 'source-a', 1, 'old'),
      obs('methods', 'source-a', 3, 'new'),
      obs('name', 'source-a', 1, 'Name One'),
    ];
    const once = collapseLatestWins(log, 'researchEntity');
    const twice = collapseLatestWins(once, 'researchEntity');
    expect(twice).toEqual(once);
  });

  it('treats every fellowship field as latest-wins', () => {
    const log: TestObs[] = [
      obs('title', 'fellowship-source', 1, 'old title'),
      obs('title', 'fellowship-source', 2, 'new title'),
    ];
    const result = collapseLatestWins(log, 'fellowship');
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('new title');
  });

  it('preserves original order of surviving rows', () => {
    const log: TestObs[] = [
      obs('name', 'source-a', 1, 'first'),
      obs('fullDescription', 'source-a', 2, 'desc-old'),
      obs('name', 'source-b', 3, 'second'),
      obs('fullDescription', 'source-a', 5, 'desc-new'),
    ];
    const result = collapseLatestWins(log, 'researchEntity');
    expect(result.map((r) => r.value)).toEqual(['first', 'second', 'desc-new']);
  });
});
