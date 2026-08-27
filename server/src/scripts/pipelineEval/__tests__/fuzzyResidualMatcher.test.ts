import { describe, expect, it } from 'vitest';
import {
  buildFuzzyResidualPlan,
  generateCandidatePairs,
  scorePair,
  type MatcherEntity,
} from '../fuzzyResidualMatcher';
import { clusterPairs, pairCompleteness, pairKey } from '../fuzzyMatchMetrics';

const entity = (over: Partial<MatcherEntity> & { id: string }): MatcherEntity => ({
  entityType: 'LAB',
  ...over,
});

describe('scorePair vetoes', () => {
  it('vetoes conflicting first names (John vs Jane)', () => {
    const a = entity({ id: 'a', name: 'John Smith Lab', surname: 'Smith', firstName: 'John' });
    const b = entity({ id: 'b', name: 'Jane Smith Lab', surname: 'Smith', firstName: 'Jane' });
    const result = scorePair(a, b);
    expect(result.vetoed).toBe(true);
    expect(result.vetoReason).toBe('first_name_conflict');
    expect(result.band).toBe('discard');
  });

  it('does not veto initial-compatible first names (J. vs Jane)', () => {
    const a = entity({ id: 'a', name: 'J. Smith Lab', surname: 'Smith', firstName: 'J.' });
    const b = entity({ id: 'b', name: 'Jane Smith Lab', surname: 'Smith', firstName: 'Jane' });
    const result = scorePair(a, b);
    expect(result.vetoed).toBe(false);
  });

  it('vetoes entity-type incompatibility (LAB vs CENTER)', () => {
    const a = entity({ id: 'a', name: 'Cancer Lab', surname: 'Cancer', entityType: 'LAB' });
    const b = entity({ id: 'b', name: 'Cancer Center', surname: 'Cancer', entityType: 'CENTER' });
    const result = scorePair(a, b);
    expect(result.vetoed).toBe(true);
    expect(result.vetoReason).toBe('entity_type_incompatible');
  });
});

describe('scorePair scoring', () => {
  it('auto-merges a jointly-appointed same-PI + shared distinctive host pair', () => {
    const a = entity({
      id: 'a',
      name: 'Maria Ruiz Laboratory',
      surname: 'Ruiz',
      firstName: 'Maria',
      departments: ['Neuroscience'],
      websiteUrl: 'https://ruizlab.yale.edu',
      pi: [{ personId: 'user-ruiz', confidence: 1 }],
    });
    const b = entity({
      id: 'b',
      name: 'Ruiz Lab',
      surname: 'Ruiz',
      departments: ['Psychiatry'],
      websiteUrl: 'https://ruizlab.yale.edu/people',
      pi: [{ personId: 'user-ruiz', confidence: 1 }],
    });
    const result = scorePair(a, b);
    expect(result.band).toBe('auto');
    expect(result.score).toBeGreaterThan(0.9);
  });

  it('does not auto-merge a bare namesake with no PI/host/dept overlap', () => {
    const a = entity({ id: 'a', name: 'Chen Lab', surname: 'Chen', departments: ['Physics'] });
    const b = entity({ id: 'b', name: 'Chen Laboratory', surname: 'Chen', departments: ['Chemistry'] });
    const result = scorePair(a, b);
    expect(result.band).not.toBe('auto');
  });

  it('ignores an umbrella shared host (yale.edu) as corroboration', () => {
    const distinctive = scorePair(
      entity({ id: 'a', name: 'Ruiz Lab', surname: 'Ruiz', websiteUrl: 'https://ruizlab.yale.edu' }),
      entity({ id: 'b', name: 'Ruiz Lab', surname: 'Ruiz', websiteUrl: 'https://ruizlab.yale.edu' }),
    );
    const umbrella = scorePair(
      entity({ id: 'a', name: 'Ruiz Lab', surname: 'Ruiz', websiteUrl: 'https://yale.edu' }),
      entity({ id: 'b', name: 'Ruiz Lab', surname: 'Ruiz', websiteUrl: 'https://yale.edu' }),
    );
    expect(distinctive.score).toBeGreaterThan(umbrella.score);
  });

  it('is monotonic: adding an agreeing feature raises the score', () => {
    const base = scorePair(
      entity({ id: 'a', name: 'Ruiz Lab', surname: 'Ruiz' }),
      entity({ id: 'b', name: 'Ruiz Lab', surname: 'Ruiz' }),
    );
    const withPi = scorePair(
      entity({ id: 'a', name: 'Ruiz Lab', surname: 'Ruiz', pi: [{ personId: 'u1', confidence: 1 }] }),
      entity({ id: 'b', name: 'Ruiz Lab', surname: 'Ruiz', pi: [{ personId: 'u1', confidence: 1 }] }),
    );
    expect(withPi.score).toBeGreaterThan(base.score);
  });
});

describe('generateCandidatePairs', () => {
  it('blocks by surname metaphone and reaches a same-surname positive pair', () => {
    const entities: MatcherEntity[] = [
      entity({ id: 'a', name: 'Smith Lab', surname: 'Smith' }),
      entity({ id: 'b', name: 'Smyth Laboratory', surname: 'Smyth' }),
      entity({ id: 'c', name: 'Jones Group', surname: 'Jones' }),
    ];
    const candidates = generateCandidatePairs(entities);
    expect(candidates.has(pairKey('a', 'b'))).toBe(true);
    const positives = clusterPairs([['a', 'b']]);
    expect(pairCompleteness(candidates, positives)).toBe(1);
  });

  it('excludes already-merged pairs', () => {
    const entities: MatcherEntity[] = [
      entity({ id: 'a', name: 'Smith Lab', surname: 'Smith' }),
      entity({ id: 'b', name: 'Smyth Laboratory', surname: 'Smyth' }),
    ];
    const candidates = generateCandidatePairs(entities, { excludePairs: new Set([pairKey('a', 'b')]) });
    expect(candidates.has(pairKey('a', 'b'))).toBe(false);
  });
});

describe('bare-surname transitivity trap', () => {
  it('never links John Smith and Robert Smith through a bare Smith Lab', () => {
    const johnRobert = scorePair(
      entity({ id: 'j', name: 'John Smith Lab', surname: 'Smith', firstName: 'John' }),
      entity({ id: 'r', name: 'Robert Smith Lab', surname: 'Smith', firstName: 'Robert' }),
    );
    expect(johnRobert.vetoed).toBe(true);
    expect(johnRobert.band).toBe('discard');
  });
});

describe('buildFuzzyResidualPlan', () => {
  it('emits scored non-discard pairs sorted by score, dropping vetoed pairs', () => {
    const entities: MatcherEntity[] = [
      entity({ id: 'a', name: 'Maria Ruiz Laboratory', surname: 'Ruiz', firstName: 'Maria', pi: [{ personId: 'u1', confidence: 1 }] }),
      entity({ id: 'b', name: 'Ruiz Lab', surname: 'Ruiz', pi: [{ personId: 'u1', confidence: 1 }] }),
      entity({ id: 'c', name: 'John Smith Lab', surname: 'Smith', firstName: 'John' }),
      entity({ id: 'd', name: 'Jane Smith Lab', surname: 'Smith', firstName: 'Jane' }),
    ];
    const { plan } = buildFuzzyResidualPlan(entities);
    const ruizPair = plan.find((entry) => entry.pair.includes('a') && entry.pair.includes('b'));
    const smithPair = plan.find((entry) => entry.pair.includes('c') && entry.pair.includes('d'));
    expect(ruizPair).toBeDefined();
    expect(smithPair).toBeUndefined();
    for (let i = 1; i < plan.length; i += 1) expect(plan[i - 1].score).toBeGreaterThanOrEqual(plan[i].score);
  });
});
