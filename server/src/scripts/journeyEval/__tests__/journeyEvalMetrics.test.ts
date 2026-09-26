import { describe, expect, it } from 'vitest';
import {
  attributeTopicDrops,
  buildRate,
  checkFacetAgreement,
  checkNoRepeatedRowsAcrossPages,
  checkNotDegraded,
  checkSortOrdering,
  resolvePagesToWalk,
  checkTopicDropAttribution,
  corpusFingerprintMoved,
  summarizeInvariants,
  type CorpusFingerprint,
  type TopicAttributionTally,
  type TopicDropObservation,
} from '../journeyEvalMetrics';

const freshObservation = (
  observation: Omit<TopicDropObservation, 'servedVersionMatchesStored'>,
): TopicDropObservation => ({ ...observation, servedVersionMatchesStored: true });

const steadyCorpus: CorpusFingerprint = {
  rowCount: 3413,
  latestUpdatedAt: '2026-09-25T18:00:00.000Z',
};

describe('attributeTopicDrops', () => {
  it('attributes a drop the guard fully explains and flags nothing', () => {
    const tally = attributeTopicDrops([
      freshObservation({ storedCount: 5, servedCount: 2, guardExpectedCount: 2 }),
      freshObservation({ storedCount: 3, servedCount: 3, guardExpectedCount: 3 }),
    ]);

    expect(tally.dropped).toBe(1);
    expect(tally.attributedToGuard).toBe(1);
    expect(tally.unexplained).toBe(0);
    expect(tally.comparable).toBe(2);
  });

  it('flags a drop the guard does not account for', () => {
    const tally = attributeTopicDrops([
      freshObservation({ storedCount: 5, servedCount: 1, guardExpectedCount: 4 }),
    ]);

    expect(tally.dropped).toBe(1);
    expect(tally.unexplained).toBe(1);
  });

  it('excludes a row served at a different version than it is stored at', () => {
    const tally = attributeTopicDrops([
      { storedCount: 5, servedCount: 1, guardExpectedCount: 4, servedVersionMatchesStored: false },
      freshObservation({ storedCount: 4, servedCount: 2, guardExpectedCount: 2 }),
    ]);

    expect(tally.skippedStaleIndex).toBe(1);
    expect(tally.comparable).toBe(1);
    expect(tally.dropped).toBe(1);
    expect(tally.unexplained).toBe(0);
  });

  it('separates serving no topic the guard explains from one it does not', () => {
    const tally = attributeTopicDrops([
      freshObservation({ storedCount: 4, servedCount: 0, guardExpectedCount: 0 }),
      freshObservation({ storedCount: 4, servedCount: 0, guardExpectedCount: 2 }),
    ]);

    expect(tally.servedNoneWhileStoringSome).toBe(2);
    expect(tally.servedNoneUnexplained).toBe(1);
  });

  it('does not count a card serving more than it stores as a drop', () => {
    const tally = attributeTopicDrops([
      freshObservation({ storedCount: 1, servedCount: 3, guardExpectedCount: 1 }),
    ]);

    expect(tally.dropped).toBe(0);
    expect(tally.unexplained).toBe(0);
  });
});

describe('corpusFingerprintMoved', () => {
  it('detects a changed row count and a changed latest write', () => {
    expect(corpusFingerprintMoved(steadyCorpus, steadyCorpus)).toBe(false);
    expect(corpusFingerprintMoved(steadyCorpus, { ...steadyCorpus, rowCount: 3414 })).toBe(true);
    expect(
      corpusFingerprintMoved(steadyCorpus, {
        ...steadyCorpus,
        latestUpdatedAt: '2026-09-25T18:00:01.000Z',
      }),
    ).toBe(true);
  });
});

describe('resolvePagesToWalk', () => {
  it('never walks past the reachable depth bound', () => {
    expect(resolvePagesToWalk(60, 50)).toBe(50);
    expect(resolvePagesToWalk(3, 50)).toBe(3);
  });

  it('always walks at least one page', () => {
    expect(resolvePagesToWalk(0, 50)).toBe(1);
    expect(resolvePagesToWalk(3, 0)).toBe(1);
  });
});

describe('checkNoRepeatedRowsAcrossPages', () => {
  it('records a walk the depth bound truncated', () => {
    const result = checkNoRepeatedRowsAcrossPages([['a']], steadyCorpus, steadyCorpus, {
      pagesRequested: 60,
      reachablePages: 50,
    });

    expect(result.status).toBe('pass');
    expect(result.detail.walkTruncatedByDepthBound).toBe(true);
    expect(result.detail.pagesWalked).toBe(1);
    expect(result.detail.reachablePages).toBe(50);
  });

  it('passes when every page serves distinct rows over a steady corpus', () => {
    const result = checkNoRepeatedRowsAcrossPages(
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
      steadyCorpus,
      steadyCorpus,
    );

    expect(result.status).toBe('pass');
    expect(result.detail.distinctRowsServed).toBe(4);
    expect(result.detail.pagesWalked).toBe(2);
  });

  it('fails on a repeat when the corpus did not move', () => {
    const result = checkNoRepeatedRowsAcrossPages(
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
      steadyCorpus,
      steadyCorpus,
    );

    expect(result.status).toBe('fail');
    expect(result.detail.repeatedRowCount).toBe(1);
  });

  it('passes on a moving corpus when no row actually repeated, because mutation can only manufacture a repeat', () => {
    const result = checkNoRepeatedRowsAcrossPages(
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
      steadyCorpus,
      { ...steadyCorpus, rowCount: 3414 },
    );

    expect(result.status).toBe('pass');
  });

  it('is inconclusive rather than failed when a repeat appears and the corpus moved', () => {
    const result = checkNoRepeatedRowsAcrossPages(
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
      steadyCorpus,
      { ...steadyCorpus, rowCount: 3414 },
    );

    expect(result.status).toBe('inconclusive');
    expect(result.detail.repeatedRowCount).toBe(1);
    expect(String(result.detail.reason)).toContain('corpus changed');
  });
});

describe('checkFacetAgreement', () => {
  it('passes when every facet count equals its filtered total', () => {
    const result = checkFacetAgreement([
      { value: 'alpha', facetCount: 483, filteredTotal: 483 },
      { value: 'beta', facetCount: 187, filteredTotal: 187 },
    ]);

    expect(result.status).toBe('pass');
    expect(result.detail.checked).toBe(2);
  });

  it('fails and names the disagreeing value', () => {
    const result = checkFacetAgreement([{ value: 'alpha', facetCount: 483, filteredTotal: 400 }]);

    expect(result.status).toBe('fail');
    expect(result.detail.disagreements).toEqual([
      { value: 'alpha', facetCount: 483, filteredTotal: 400 },
    ]);
  });
});

describe('checkSortOrdering', () => {
  it('passes on a descending run and ignores rows carrying no value', () => {
    const result = checkSortOrdering([30, null, 20, 10], 'desc');

    expect(result.status).toBe('pass');
    expect(result.detail.comparable).toBe(3);
  });

  it('counts an inversion', () => {
    const result = checkSortOrdering([10, 30, 20], 'desc');

    expect(result.status).toBe('fail');
    expect(result.detail.inversions).toBe(1);
  });
});

describe('checkNotDegraded', () => {
  it('fails when the flag is absent rather than explicitly false', () => {
    expect(checkNotDegraded('id', 'title', undefined).status).toBe('fail');
    expect(checkNotDegraded('id', 'title', false).status).toBe('pass');
    expect(checkNotDegraded('id', 'title', true).status).toBe('fail');
  });
});

describe('buildRate', () => {
  it('reports a zero denominator as a zero rate rather than dividing', () => {
    expect(buildRate('id', 'title', 0, 0).rate).toBe(0);
    expect(buildRate('id', 'title', 17, 18).rate).toBe(0.9444);
  });
});

describe('summarizeInvariants', () => {
  it('counts an inconclusive result separately from a failure', () => {
    const summary = summarizeInvariants([
      { id: 'passes', title: 'passes', status: 'pass', detail: {} },
      { id: 'fails', title: 'fails', status: 'fail', detail: {} },
      { id: 'undecided', title: 'undecided', status: 'inconclusive', detail: {} },
    ]);

    expect(summary.invariantsChecked).toBe(3);
    expect(summary.invariantsFailed).toBe(1);
    expect(summary.invariantsInconclusive).toBe(1);
    expect(summary.failedInvariantIds).toEqual(['fails']);
    expect(summary.inconclusiveInvariantIds).toEqual(['undecided']);
  });
});

describe('checkTopicDropAttribution', () => {
  const tally = (overrides: Partial<TopicAttributionTally> = {}): TopicAttributionTally => ({
    window: 100,
    comparable: 100,
    skippedStaleIndex: 0,
    dropped: 14,
    attributedToGuard: 14,
    unexplained: 0,
    servedNoneWhileStoringSome: 3,
    servedNoneUnexplained: 0,
    ...overrides,
  });

  it('passes when every drop is attributed', () => {
    expect(checkTopicDropAttribution(tally(), steadyCorpus, steadyCorpus).status).toBe('pass');
  });

  it('fails on an unexplained drop over a steady corpus', () => {
    const result = checkTopicDropAttribution(
      tally({ attributedToGuard: 13, unexplained: 1 }),
      steadyCorpus,
      steadyCorpus,
    );

    expect(result.status).toBe('fail');
  });

  it('is inconclusive on an unexplained drop when the corpus moved', () => {
    const result = checkTopicDropAttribution(
      tally({ attributedToGuard: 13, unexplained: 1 }),
      steadyCorpus,
      { ...steadyCorpus, rowCount: 3414 },
    );

    expect(result.status).toBe('inconclusive');
  });

  it('is inconclusive rather than a green signal over an empty population', () => {
    const result = checkTopicDropAttribution(
      tally({ comparable: 0, dropped: 0, attributedToGuard: 0, skippedStaleIndex: 100 }),
      steadyCorpus,
      steadyCorpus,
    );

    expect(result.status).toBe('inconclusive');
  });
});
