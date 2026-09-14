import { describe, expect, it } from 'vitest';
import { RESEARCH_SEARCH_RELEVANCE_CASES } from '../researchSearchRelevanceCases';
import {
  MIN_PERTURBABLE_TOKEN_LENGTH,
  RESEARCH_SEARCH_PERTURBATION_KINDS,
  averageOverlapAtDepth,
  buildResearchSearchRelevanceReport,
  findResearchSearchRelevanceFindings,
  isSkippedResearchSearchPerturbation,
  jaccardAtDepth,
  matchesRelevanceMarkers,
  perturbResearchSearchQuery,
  precisionAtDepth,
  reciprocalRank,
  researchSearchQueryShape,
  researchSearchRelevanceText,
  summarizeResearchSearchRelevanceCase,
  type ResearchSearchRelevanceCaseResult,
} from '../researchSearchRelevanceCore';

const probe = (ids: string[], relevanceFlags: boolean[]) => ({
  resultIds: ids,
  relevanceFlags,
  estimatedTotalHits: ids.length,
  degraded: false,
  latencyMs: 1,
});

describe('perturbResearchSearchQuery', () => {
  it('produces a single-edit variant of the longest token for every kind', () => {
    for (const kind of RESEARCH_SEARCH_PERTURBATION_KINDS) {
      const perturbation = perturbResearchSearchQuery('machine learning', kind);
      expect(isSkippedResearchSearchPerturbation(perturbation)).toBe(false);
      if (isSkippedResearchSearchPerturbation(perturbation)) continue;
      expect(perturbation.query).not.toBe('machine learning');
      expect(perturbation.query.split(/\s+/)).toHaveLength(2);
    }
  });

  it('is deterministic so two runs of the harness stay comparable', () => {
    for (const kind of RESEARCH_SEARCH_PERTURBATION_KINDS) {
      const first = perturbResearchSearchQuery('neuroscience', kind);
      const second = perturbResearchSearchQuery('neuroscience', kind);
      expect(first).toEqual(second);
    }
  });

  it('applies each edit kind to the longest token and leaves the rest intact', () => {
    expect(perturbResearchSearchQuery('functional mri', 'deletion')).toEqual({
      kind: 'deletion',
      query: 'functonal mri',
    });
    expect(perturbResearchSearchQuery('functional mri', 'transposition')).toEqual({
      kind: 'transposition',
      query: 'funcitonal mri',
    });
    expect(perturbResearchSearchQuery('functional mri', 'doubling')).toEqual({
      kind: 'doubling',
      query: 'functiional mri',
    });
    expect(perturbResearchSearchQuery('functional mri', 'substitution')).toEqual({
      kind: 'substitution',
      query: 'functoonal mri',
    });
    expect(perturbResearchSearchQuery('functional mri', 'casing')).toEqual({
      kind: 'casing',
      query: 'FUNCTIONAL mri',
    });
  });

  it('skips a query whose longest token is below the configured typo threshold', () => {
    expect('nlp'.length).toBeLessThan(MIN_PERTURBABLE_TOKEN_LENGTH);
    expect(perturbResearchSearchQuery('nlp', 'deletion')).toEqual({
      kind: 'deletion',
      skippedReason: 'no-perturbable-token',
    });
    expect(perturbResearchSearchQuery('ai', 'transposition')).toEqual({
      kind: 'transposition',
      skippedReason: 'no-perturbable-token',
    });
  });

  it('reports an identity perturbation rather than scoring a query against itself', () => {
    expect(perturbResearchSearchQuery('GENOMICS', 'casing')).toEqual({
      kind: 'casing',
      skippedReason: 'perturbation-is-identity',
    });
  });
});

describe('averageOverlapAtDepth', () => {
  it('is 1 for identical rankings and 0 for disjoint ones', () => {
    expect(averageOverlapAtDepth(['a', 'b', 'c'], ['a', 'b', 'c'], 3)).toBe(1);
    expect(averageOverlapAtDepth(['a', 'b', 'c'], ['x', 'y', 'z'], 3)).toBe(0);
  });

  it('rewards the same set more when it is ordered the same way', () => {
    const sameOrder = averageOverlapAtDepth(['a', 'b'], ['a', 'b'], 2);
    const swapped = averageOverlapAtDepth(['a', 'b'], ['b', 'a'], 2);
    expect(swapped).toBeLessThan(sameOrder);
    expect(swapped).toBeCloseTo(0.5, 10);
  });

  it('averages the shared fraction over every prefix depth', () => {
    expect(averageOverlapAtDepth(['a', 'b', 'c'], ['a', 'x', 'c'], 3)).toBeCloseTo(
      (1 / 1 + 1 / 2 + 2 / 3) / 3,
      10,
    );
  });

  it('counts a shared id once even when it sits at the same rank', () => {
    expect(averageOverlapAtDepth(['a'], ['a'], 1)).toBe(1);
  });

  it('penalizes a shorter perturbed result list', () => {
    expect(averageOverlapAtDepth(['a', 'b', 'c'], ['a'], 3)).toBeCloseTo(
      (1 / 1 + 1 / 2 + 1 / 3) / 3,
      10,
    );
  });

  it('returns 0 at a non-positive depth', () => {
    expect(averageOverlapAtDepth(['a'], ['a'], 0)).toBe(0);
  });
});

describe('jaccardAtDepth', () => {
  it('ignores ordering', () => {
    expect(jaccardAtDepth(['a', 'b'], ['b', 'a'], 2)).toBe(1);
  });

  it('measures set overlap over the union', () => {
    expect(jaccardAtDepth(['a', 'b'], ['b', 'c'], 2)).toBeCloseTo(1 / 3, 10);
  });

  it('treats two empty result sets as identical', () => {
    expect(jaccardAtDepth([], [], 10)).toBe(1);
  });
});

describe('precisionAtDepth and reciprocalRank', () => {
  it('scores precision over the returned prefix, not the requested depth', () => {
    expect(precisionAtDepth([true, false], 10)).toBe(0.5);
    expect(precisionAtDepth([], 10)).toBe(0);
  });

  it('reports the reciprocal of the first relevant rank', () => {
    expect(reciprocalRank([true, false])).toBe(1);
    expect(reciprocalRank([false, false, true])).toBeCloseTo(1 / 3, 10);
    expect(reciprocalRank([false, false])).toBe(0);
  });
});

describe('relevance marker matching', () => {
  it('reads markers across name, taxonomy, and description fields', () => {
    const entity = {
      name: 'Example Group',
      departments: ['Neuroscience'],
      researchAreas: [],
      cardDescription: { blurb: 'Studies synaptic plasticity.' },
    };
    expect(researchSearchRelevanceText(entity)).toContain('neuroscience');
    expect(researchSearchRelevanceText(entity)).toContain('synaptic');
    expect(matchesRelevanceMarkers(entity, ['synap'])).toBe(true);
    expect(matchesRelevanceMarkers(entity, ['climate'])).toBe(false);
  });

  it('never treats an empty marker list as a match', () => {
    expect(matchesRelevanceMarkers({ name: 'Anything' }, [])).toBe(false);
  });
});

describe('researchSearchQueryShape', () => {
  it('describes a query by token length so a sampled surname is never reported', () => {
    expect(researchSearchQueryShape('abcdefg')).toBe('token(len=7)');
    expect(researchSearchQueryShape('ab cdef')).toBe('token(len=2) token(len=4)');
  });
});

describe('summarizeResearchSearchRelevanceCase', () => {
  const searchCase = {
    label: 'topic-example',
    queryClass: 'topic' as const,
    query: 'machine learning',
    relevanceMarkers: ['machine learning'],
  };

  it('carries the query verbatim for a committed topical case', () => {
    const result = summarizeResearchSearchRelevanceCase({
      searchCase,
      topK: 2,
      baseline: probe(['a', 'b'], [true, false]),
      perturbations: [
        { kind: 'deletion', perturbedQuery: 'machin learning', outcome: probe(['a', 'b'], [true, true]) },
        { kind: 'casing', skipped: { kind: 'casing', skippedReason: 'perturbation-is-identity' } },
      ],
      redactQuery: false,
    });

    expect(result.query).toBe('machine learning');
    expect(result.queryShape).toBeUndefined();
    expect(result.precisionAtK).toBe(0.5);
    expect(result.reciprocalRank).toBe(1);
    expect(result.perturbations[0]).toMatchObject({
      kind: 'deletion',
      perturbedQuery: 'machin learning',
      averageOverlap: 1,
      jaccard: 1,
      topRankPreserved: true,
    });
    expect(result.perturbations[1]).toEqual({
      kind: 'casing',
      skippedReason: 'perturbation-is-identity',
    });
  });

  it('redacts the query and the perturbed query for a sampled person-name case', () => {
    const result = summarizeResearchSearchRelevanceCase({
      searchCase: { ...searchCase, queryClass: 'person-name', query: 'abcdefg' },
      topK: 1,
      baseline: probe(['a'], [true]),
      perturbations: [
        { kind: 'deletion', perturbedQuery: 'abcdfg', outcome: probe(['b'], [false]) },
      ],
      redactQuery: true,
    });

    expect(result.query).toBeUndefined();
    expect(result.queryShape).toBe('token(len=7)');
    expect(result.perturbations[0].perturbedQuery).toBeUndefined();
    expect(result.perturbations[0].topRankPreserved).toBe(false);
    expect(JSON.stringify(result)).not.toContain('abcd');
  });
});

describe('findResearchSearchRelevanceFindings', () => {
  const baseCase: ResearchSearchRelevanceCaseResult = {
    label: 'topic-example',
    queryClass: 'topic',
    query: 'machine learning',
    topK: 10,
    resultCount: 10,
    estimatedTotalHits: 10,
    degraded: false,
    latencyMs: 1,
    precisionAtK: 0.9,
    reciprocalRank: 1,
    perturbations: [{ kind: 'deletion', averageOverlap: 0.9, jaccard: 0.9, topRankPreserved: true }],
  };

  it('reports nothing when precision and overlap clear their thresholds', () => {
    expect(
      findResearchSearchRelevanceFindings([baseCase], {
        minPrecisionAtK: 0.5,
        minAverageOverlap: 0.5,
      }),
    ).toEqual([]);
  });

  it('flags a typo that collapses the result set', () => {
    const findings = findResearchSearchRelevanceFindings(
      [{ ...baseCase, perturbations: [{ kind: 'deletion', averageOverlap: 0.1 }] }],
      { minPrecisionAtK: 0.5, minAverageOverlap: 0.5 },
    );
    expect(findings).toEqual([
      {
        label: 'topic-example',
        kind: 'typo-collapse',
        perturbationKind: 'deletion',
        observed: 0.1,
        threshold: 0.5,
      },
    ]);
  });

  it('flags low precision, zero results, and a degraded search path', () => {
    const findings = findResearchSearchRelevanceFindings(
      [
        { ...baseCase, precisionAtK: 0.2 },
        { ...baseCase, label: 'topic-empty', resultCount: 0, precisionAtK: 0, perturbations: [] },
        { ...baseCase, label: 'topic-degraded', degraded: true, perturbations: [] },
      ],
      { minPrecisionAtK: 0.5, minAverageOverlap: 0.5 },
    );
    expect(findings.map((finding) => `${finding.label}:${finding.kind}`)).toEqual([
      'topic-example:low-precision',
      'topic-empty:zero-results',
      'topic-degraded:degraded',
    ]);
  });

  it('does not also charge an empty result set with low precision', () => {
    const findings = findResearchSearchRelevanceFindings(
      [{ ...baseCase, resultCount: 0, precisionAtK: 0, perturbations: [] }],
      { minPrecisionAtK: 0.5, minAverageOverlap: 0.5 },
    );
    expect(findings.map((finding) => finding.kind)).toEqual(['zero-results']);
  });

  it('skips a perturbation that was never compared', () => {
    const findings = findResearchSearchRelevanceFindings(
      [
        {
          ...baseCase,
          perturbations: [{ kind: 'deletion', skippedReason: 'no-perturbable-token' }],
        },
      ],
      { minPrecisionAtK: 0.5, minAverageOverlap: 0.5 },
    );
    expect(findings).toEqual([]);
  });
});

describe('buildResearchSearchRelevanceReport', () => {
  const reportInput = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    databaseName: 'Development',
    indexName: 'researchentities',
    numberOfDocuments: 2600,
    hybridEmbedderConfigured: true,
    topK: 10,
    perturbationKinds: RESEARCH_SEARCH_PERTURBATION_KINDS,
    thresholds: { minPrecisionAtK: 0.5, minAverageOverlap: 0.5 },
  };

  it('aggregates overlap per perturbation kind and counts skipped comparisons', () => {
    const report = buildResearchSearchRelevanceReport({
      ...reportInput,
      cases: [
        {
          label: 'topic-a',
          queryClass: 'topic',
          query: 'a',
          topK: 10,
          resultCount: 10,
          estimatedTotalHits: 10,
          degraded: false,
          latencyMs: 1,
          precisionAtK: 1,
          reciprocalRank: 1,
          perturbations: [
            { kind: 'deletion', averageOverlap: 0.8 },
            { kind: 'casing', skippedReason: 'perturbation-is-identity' },
          ],
        },
        {
          label: 'topic-b',
          queryClass: 'topic',
          query: 'b',
          topK: 10,
          resultCount: 10,
          estimatedTotalHits: 10,
          degraded: false,
          latencyMs: 1,
          precisionAtK: 0.6,
          reciprocalRank: 0.5,
          perturbations: [{ kind: 'deletion', averageOverlap: 0.6 }],
        },
      ],
    });

    expect(report.summary.meanPrecisionAtK).toBe(0.8);
    expect(report.summary.meanReciprocalRank).toBe(0.75);
    expect(report.summary.meanAverageOverlap).toBe(0.7);
    expect(report.summary.meanAverageOverlapByKind).toEqual({ deletion: 0.7 });
    expect(report.summary.comparedPerturbations).toBe(2);
    expect(report.summary.skippedPerturbations).toBe(1);
    expect(report.summary.reviewRequired).toBe(false);
  });

  it('excludes a zero-result case from mean precision so it cannot dilute the score', () => {
    const report = buildResearchSearchRelevanceReport({
      ...reportInput,
      cases: [
        {
          label: 'topic-a',
          queryClass: 'topic',
          query: 'a',
          topK: 10,
          resultCount: 10,
          estimatedTotalHits: 10,
          degraded: false,
          latencyMs: 1,
          precisionAtK: 1,
          reciprocalRank: 1,
          perturbations: [],
        },
        {
          label: 'topic-empty',
          queryClass: 'topic',
          query: 'b',
          topK: 10,
          resultCount: 0,
          estimatedTotalHits: 0,
          degraded: false,
          latencyMs: 1,
          precisionAtK: 0,
          reciprocalRank: 0,
          perturbations: [],
        },
      ],
    });

    expect(report.summary.meanPrecisionAtK).toBe(1);
    expect(report.summary.zeroResultCases).toBe(1);
    expect(report.summary.reviewRequired).toBe(true);
    expect(report.findings.map((finding) => finding.kind)).toEqual(['zero-results']);
  });
});

describe('RESEARCH_SEARCH_RELEVANCE_CASES', () => {
  it('covers every query class the harness reports on except the sampled one', () => {
    const classes = new Set(RESEARCH_SEARCH_RELEVANCE_CASES.map((c) => c.queryClass));
    expect([...classes].sort()).toEqual(['method', 'semantic-phrase', 'short-alias', 'topic']);
  });

  it('uses a unique label per case so findings stay attributable', () => {
    const labels = RESEARCH_SEARCH_RELEVANCE_CASES.map((searchCase) => searchCase.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives every case a query and at least two lowercase markers', () => {
    for (const searchCase of RESEARCH_SEARCH_RELEVANCE_CASES) {
      expect(searchCase.query.trim()).not.toBe('');
      expect(searchCase.relevanceMarkers.length).toBeGreaterThanOrEqual(2);
      for (const marker of searchCase.relevanceMarkers) {
        expect(marker).toBe(marker.toLowerCase());
        expect(marker.trim()).toBe(marker);
      }
    }
  });

  it('stores no expected-result identifiers, because a faculty slug is person-bearing', () => {
    for (const searchCase of RESEARCH_SEARCH_RELEVANCE_CASES) {
      expect(Object.keys(searchCase).sort()).toEqual([
        'label',
        'query',
        'queryClass',
        'relevanceMarkers',
      ]);
    }
  });
});
