import { describe, expect, it } from 'vitest';
import {
  buildGroundTruthClusters,
  buildLabeledNegatives,
  clusterBcubed,
  clusterPairs,
  pairCompleteness,
  pairKey,
  pairwiseMetrics,
} from '../fuzzyMatchMetrics';

describe('buildGroundTruthClusters', () => {
  it('transitively closes redirect chains into one cluster', () => {
    const clusters = buildGroundTruthClusters(
      [
        { mergedEntityId: 'a', canonicalEntityId: 'b' },
        { mergedEntityId: 'b', canonicalEntityId: 'c' },
      ],
      [{ entityId: 'd', canonicalGroupId: 'c' }],
    );
    const entityCluster = clusters.find((c) => c.includes('a'));
    expect(entityCluster?.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps researcher-dedupe clusters in a separate namespace', () => {
    const clusters = buildGroundTruthClusters(
      [{ mergedEntityId: 'a', canonicalEntityId: 'b' }],
      [],
      [{ researcherId: 'r1', dedupedIntoResearcherId: 'r2' }],
    );
    expect(clusters).toHaveLength(2);
    expect(clusters.some((c) => c.includes('researcher:r1') && c.includes('researcher:r2'))).toBe(
      true,
    );
    expect(clusters.some((c) => c.includes('a') && c.includes('researcher:r1'))).toBe(false);
  });
});

describe('clusterPairs', () => {
  it('emits all unordered within-cluster pairs', () => {
    const pairs = clusterPairs([['a', 'b', 'c']]);
    expect(pairs).toEqual(new Set([pairKey('a', 'b'), pairKey('a', 'c'), pairKey('b', 'c')]));
  });
});

describe('buildLabeledNegatives', () => {
  it('pairs same-name entities with different persons as guaranteed-distinct', () => {
    const negatives = buildLabeledNegatives([
      {
        normalizedName: 'smith lab',
        entities: [
          { id: 'e1', personId: 'p1' },
          { id: 'e2', personId: 'p2' },
          { id: 'e3', personId: 'p1' },
        ],
      },
    ]);
    expect(negatives.has(pairKey('e1', 'e2'))).toBe(true);
    expect(negatives.has(pairKey('e2', 'e3'))).toBe(true);
    expect(negatives.has(pairKey('e1', 'e3'))).toBe(false);
  });
});

describe('pairwiseMetrics', () => {
  it('scores precision/recall/f1 against positives and hard negatives', () => {
    const positives = new Set([pairKey('a', 'b'), pairKey('b', 'c'), pairKey('d', 'e')]);
    const negatives = new Set([pairKey('x', 'y')]);
    const predicted = [pairKey('a', 'b'), pairKey('b', 'c'), pairKey('x', 'y')];
    const m = pairwiseMetrics(predicted, positives, negatives);
    expect(m.tp).toBe(2);
    expect(m.fp).toBe(1);
    expect(m.fn).toBe(1);
    expect(m.precision).toBeCloseTo(0.6667, 3);
    expect(m.recall).toBeCloseTo(0.6667, 3);
    expect(m.f1).toBeCloseTo(0.6667, 3);
  });
});

describe('pairCompleteness', () => {
  it('is the fraction of positive pairs a candidate set covers', () => {
    const positives = new Set([pairKey('a', 'b'), pairKey('c', 'd'), pairKey('e', 'f')]);
    const candidates = [pairKey('a', 'b'), pairKey('c', 'd'), pairKey('g', 'h')];
    expect(pairCompleteness(candidates, positives)).toBeCloseTo(0.6667, 3);
  });
});

describe('clusterBcubed', () => {
  it('matches the worked example', () => {
    const truth = [
      ['a', 'b', 'c'],
      ['d', 'e'],
    ];
    const predicted = [
      ['a', 'b'],
      ['c', 'd', 'e'],
    ];
    const m = clusterBcubed(predicted, truth);
    expect(m.precision).toBeCloseTo(0.7333, 3);
    expect(m.recall).toBeCloseTo(0.7333, 3);
    expect(m.f1).toBeCloseTo(0.7333, 3);
  });

  it('is perfect when clusterings are identical', () => {
    const clusters = [['a', 'b'], ['c']];
    const m = clusterBcubed(clusters, clusters);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
  });
});
