import { describe, expect, it } from 'vitest';
import {
  attributeTopicDrops,
  buildRate,
  checkConstantReportedTotal,
  checkFacetAgreement,
  checkNoRepeatedRowsAcrossPages,
  checkNotDegraded,
  checkSortOrdering,
  checkSurvivorWebsiteAttribution,
  checkTitleSortOrdering,
  classifySurvivorWebsite,
  resolvePagesToWalk,
  tallySurvivorWebsites,
  checkTopicDropAttribution,
  corpusFingerprintMoved,
  summarizeInvariants,
  type CorpusFingerprint,
  type TopicAttributionTally,
  type SurvivorWebsiteObservation,
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
  const coherence = ['dropDomainIncoherentUnsourcedResearchAreas'];

  it('attributes a drop the serve-path decision fully explains and names its guard', () => {
    const tally = attributeTopicDrops([
      freshObservation({
        storedCount: 5,
        servedCount: 2,
        explainedByDecision: true,
        withheldBy: [...coherence, ...coherence, 'filterProseResearchAreaChips'],
      }),
      freshObservation({
        storedCount: 3,
        servedCount: 3,
        explainedByDecision: true,
        withheldBy: [],
      }),
    ]);

    expect(tally.dropped).toBe(1);
    expect(tally.attributedToGuard).toBe(1);
    expect(tally.unexplained).toBe(0);
    expect(tally.comparable).toBe(2);
    expect(tally.drops).toEqual([
      {
        attributed: true,
        withheldBy: ['dropDomainIncoherentUnsourcedResearchAreas', 'filterProseResearchAreaChips'],
      },
    ]);
  });

  it('flags a drop the serve-path decision does not account for', () => {
    const tally = attributeTopicDrops([
      freshObservation({
        storedCount: 5,
        servedCount: 1,
        explainedByDecision: false,
        withheldBy: coherence,
      }),
    ]);

    expect(tally.dropped).toBe(1);
    expect(tally.unexplained).toBe(1);
    expect(tally.drops).toEqual([{ attributed: false, withheldBy: coherence }]);
  });

  it('excludes a row served at a different version than it is stored at', () => {
    const tally = attributeTopicDrops([
      {
        storedCount: 5,
        servedCount: 1,
        explainedByDecision: false,
        withheldBy: [],
        servedVersionMatchesStored: false,
      },
      freshObservation({
        storedCount: 4,
        servedCount: 2,
        explainedByDecision: true,
        withheldBy: coherence,
      }),
    ]);

    expect(tally.skippedStaleIndex).toBe(1);
    expect(tally.comparable).toBe(1);
    expect(tally.dropped).toBe(1);
    expect(tally.unexplained).toBe(0);
  });

  it('separates serving no topic the decision explains from one it does not', () => {
    const tally = attributeTopicDrops([
      freshObservation({
        storedCount: 4,
        servedCount: 0,
        explainedByDecision: true,
        withheldBy: coherence,
      }),
      freshObservation({
        storedCount: 4,
        servedCount: 0,
        explainedByDecision: false,
        withheldBy: [],
      }),
    ]);

    expect(tally.servedNoneWhileStoringSome).toBe(2);
    expect(tally.servedNoneUnexplained).toBe(1);
  });

  it('does not count a card serving more than it stores as a drop', () => {
    const tally = attributeTopicDrops([
      freshObservation({
        storedCount: 1,
        servedCount: 3,
        explainedByDecision: false,
        withheldBy: [],
      }),
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

describe('checkTitleSortOrdering', () => {
  const still = { rowCount: 3, latestUpdatedAt: '2026-09-01T00:00:00.000Z' };
  const moved = { rowCount: 4, latestUpdatedAt: '2026-09-02T00:00:00.000Z' };

  it('passes when the card titles read in alphabetical order', () => {
    expect(
      checkTitleSortOrdering(['alpha', 'beta', 'beta', 'gamma'], 'asc', still, still).status,
    ).toBe('pass');
  });

  it('fails on a card title filed under a letter it does not start with', () => {
    const result = checkTitleSortOrdering(['alpha', 'zeta', 'beta'], 'asc', still, still);

    expect(result.status).toBe('fail');
    expect(result.detail.inversions).toBe(1);
  });

  it('is inconclusive rather than failing when the corpus moved during the walk', () => {
    expect(checkTitleSortOrdering(['beta', 'alpha'], 'asc', still, moved).status).toBe(
      'inconclusive',
    );
  });
});

describe('checkConstantReportedTotal', () => {
  const still = { rowCount: 3, latestUpdatedAt: '2026-09-01T00:00:00.000Z' };
  const moved = { rowCount: 4, latestUpdatedAt: '2026-09-02T00:00:00.000Z' };

  it('passes when every page reports the same total', () => {
    expect(checkConstantReportedTotal('q', [581, 581, 581], still, still).status).toBe('pass');
  });

  it('fails when the total grows as the student pages', () => {
    const result = checkConstantReportedTotal('q', [242, 242, 260, 577], still, still);

    expect(result.status).toBe('fail');
    expect(result.detail.distinctTotals).toEqual([242, 260, 577]);
  });

  it('fails when a page reports no total at all', () => {
    expect(checkConstantReportedTotal('q', [null], still, still).status).toBe('fail');
  });

  it('is inconclusive rather than failing when the corpus moved during the walk', () => {
    expect(checkConstantReportedTotal('q', [242, 250], still, moved).status).toBe('inconclusive');
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
    drops: [],
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

describe('survivor website attribution (#3585)', () => {
  const LAB = 'examplelab.example.org';
  const survivor = (
    overrides: Partial<SurvivorWebsiteObservation> = {},
  ): SurvivorWebsiteObservation => ({
    servedWebsiteIdentity: LAB,
    websiteLocked: false,
    survivorStated: new Set(),
    admittedStated: new Set(),
    droppedLoser: new Set(),
    ...overrides,
  });
  const movedCorpus: CorpusFingerprint = {
    ...steadyCorpus,
    latestUpdatedAt: '2026-09-25T18:05:00.000Z',
  };

  it('names the evidence a served website traces to, survivor evidence first', () => {
    expect(
      classifySurvivorWebsite(
        survivor({ survivorStated: new Set([LAB]), droppedLoser: new Set([LAB]) }),
      ),
    ).toBe('survivor-evidence');
    expect(classifySurvivorWebsite(survivor({ droppedLoser: new Set([LAB]) }))).toBe(
      'loser-only-under-owned-slot',
    );
    expect(classifySurvivorWebsite(survivor({ admittedStated: new Set([LAB]) }))).toBe(
      'merged-loser-evidence',
    );
    expect(
      classifySurvivorWebsite(survivor({ websiteLocked: true, droppedLoser: new Set([LAB]) })),
    ).toBe('locked');
    expect(classifySurvivorWebsite(survivor())).toBe('unbacked');
  });

  it('fails only on a loser-only website, and reports an unbacked one without failing', () => {
    const clean = tallySurvivorWebsites([
      survivor({ survivorStated: new Set([LAB]) }),
      survivor(),
      survivor({ servedWebsiteIdentity: '' }),
    ]);
    expect(clean.comparable).toBe(2);
    expect(checkSurvivorWebsiteAttribution(clean, steadyCorpus, steadyCorpus).status).toBe('pass');

    const defect = tallySurvivorWebsites([survivor({ droppedLoser: new Set([LAB]) })]);
    expect(checkSurvivorWebsiteAttribution(defect, steadyCorpus, steadyCorpus).status).toBe('fail');
  });

  it('is inconclusive over an empty population, or when the corpus moved under a failure', () => {
    expect(
      checkSurvivorWebsiteAttribution(tallySurvivorWebsites([]), steadyCorpus, steadyCorpus).status,
    ).toBe('inconclusive');
    const defect = tallySurvivorWebsites([survivor({ droppedLoser: new Set([LAB]) })]);
    expect(checkSurvivorWebsiteAttribution(defect, steadyCorpus, movedCorpus).status).toBe(
      'inconclusive',
    );
    const clean = tallySurvivorWebsites([survivor({ survivorStated: new Set([LAB]) })]);
    expect(checkSurvivorWebsiteAttribution(clean, steadyCorpus, movedCorpus).status).toBe('pass');
  });
});
