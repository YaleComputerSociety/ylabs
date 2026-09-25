import { describe, expect, it } from 'vitest';
import {
  attributeTopicDrops,
  buildRate,
  checkFacetAgreement,
  checkNoRepeatedRowsAcrossPages,
  checkNotDegraded,
  checkSortOrdering,
  summarizeInvariants,
  type TopicDropObservation,
} from '../journeyEvalMetrics';

describe('attributeTopicDrops', () => {
  it('attributes a drop the guard fully explains and flags nothing', () => {
    const observations: TopicDropObservation[] = [
      { storedCount: 5, servedCount: 2, guardExpectedCount: 2 },
      { storedCount: 3, servedCount: 3, guardExpectedCount: 3 },
    ];

    const tally = attributeTopicDrops(observations);

    expect(tally.dropped).toBe(1);
    expect(tally.attributedToGuard).toBe(1);
    expect(tally.unexplained).toBe(0);
  });

  it('flags a drop the guard does not account for', () => {
    const tally = attributeTopicDrops([{ storedCount: 5, servedCount: 1, guardExpectedCount: 4 }]);

    expect(tally.dropped).toBe(1);
    expect(tally.attributedToGuard).toBe(0);
    expect(tally.unexplained).toBe(1);
  });

  it('separates serving no topic the guard explains from one it does not', () => {
    const tally = attributeTopicDrops([
      { storedCount: 4, servedCount: 0, guardExpectedCount: 0 },
      { storedCount: 4, servedCount: 0, guardExpectedCount: 2 },
    ]);

    expect(tally.servedNoneWhileStoringSome).toBe(2);
    expect(tally.servedNoneUnexplained).toBe(1);
  });

  it('does not count a card serving more than it stores as a drop', () => {
    const tally = attributeTopicDrops([{ storedCount: 1, servedCount: 3, guardExpectedCount: 1 }]);

    expect(tally.dropped).toBe(0);
    expect(tally.unexplained).toBe(0);
  });
});

describe('checkFacetAgreement', () => {
  it('passes when every facet count equals its filtered total', () => {
    const result = checkFacetAgreement([
      { value: 'alpha', facetCount: 483, filteredTotal: 483 },
      { value: 'beta', facetCount: 187, filteredTotal: 187 },
    ]);

    expect(result.passed).toBe(true);
    expect(result.detail.checked).toBe(2);
  });

  it('fails and names the disagreeing value', () => {
    const result = checkFacetAgreement([{ value: 'alpha', facetCount: 483, filteredTotal: 400 }]);

    expect(result.passed).toBe(false);
    expect(result.detail.disagreements).toEqual([
      { value: 'alpha', facetCount: 483, filteredTotal: 400 },
    ]);
  });
});

describe('checkNoRepeatedRowsAcrossPages', () => {
  it('passes when every page serves distinct rows', () => {
    const result = checkNoRepeatedRowsAcrossPages([
      ['a', 'b'],
      ['c', 'd'],
    ]);

    expect(result.passed).toBe(true);
    expect(result.detail.distinctRowsServed).toBe(4);
  });

  it('counts a row served on two pages', () => {
    const result = checkNoRepeatedRowsAcrossPages([
      ['a', 'b'],
      ['b', 'c'],
    ]);

    expect(result.passed).toBe(false);
    expect(result.detail.repeatedRowCount).toBe(1);
  });
});

describe('checkSortOrdering', () => {
  it('passes on a descending run and ignores rows carrying no value', () => {
    const result = checkSortOrdering([30, null, 20, 10], 'desc');

    expect(result.passed).toBe(true);
    expect(result.detail.comparable).toBe(3);
  });

  it('counts an inversion', () => {
    const result = checkSortOrdering([10, 30, 20], 'desc');

    expect(result.passed).toBe(false);
    expect(result.detail.inversions).toBe(1);
  });
});

describe('checkNotDegraded', () => {
  it('fails when the flag is absent rather than explicitly false', () => {
    expect(checkNotDegraded('id', 'title', undefined).passed).toBe(false);
    expect(checkNotDegraded('id', 'title', false).passed).toBe(true);
    expect(checkNotDegraded('id', 'title', true).passed).toBe(false);
  });
});

describe('buildRate', () => {
  it('reports a zero denominator as a zero rate rather than dividing', () => {
    expect(buildRate('id', 'title', 0, 0).rate).toBe(0);
    expect(buildRate('id', 'title', 17, 18).rate).toBe(0.9444);
  });
});

describe('summarizeInvariants', () => {
  it('names only the failing invariants', () => {
    const summary = summarizeInvariants([
      { id: 'passes', title: 'passes', passed: true, detail: {} },
      { id: 'fails', title: 'fails', passed: false, detail: {} },
    ]);

    expect(summary.invariantsChecked).toBe(2);
    expect(summary.invariantsFailed).toBe(1);
    expect(summary.failedInvariantIds).toEqual(['fails']);
  });
});
