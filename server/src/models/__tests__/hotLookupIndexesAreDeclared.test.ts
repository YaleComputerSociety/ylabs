import { describe, expect, it } from 'vitest';
import { observationSchema } from '../observation';
import { researcherSchema } from '../researcher';
import mongoose from 'mongoose';

/**
 * These lookups run per gate pass, per materialized roster member, per repair action and
 * per vocabulary reload, and each one was a scan of hundreds of thousands of keys until
 * #3934. The cases below are stated as the query shape each caller sends, so that
 * reordering an index's keys or trimming a trailing key fails here rather than silently
 * restoring the scan, which no test and no boot check would otherwise notice.
 */
interface HotLookup {
  readonly name: string;
  readonly equalityFields: readonly string[];
  readonly thenReads: readonly string[];
}

const declaredKeyPatterns = (schema: mongoose.Schema): string[][] =>
  schema.indexes().map(([keys]) => Object.keys(keys as Record<string, unknown>));

function indexServing(patterns: string[][], lookup: HotLookup): string[] | undefined {
  return patterns.find((keys) => {
    const prefix = keys.slice(0, lookup.equalityFields.length);
    const prefixMatches =
      prefix.length === lookup.equalityFields.length &&
      [...prefix].sort().join() === [...lookup.equalityFields].sort().join();
    if (!prefixMatches) return false;
    const trailing = keys.slice(lookup.equalityFields.length);
    return lookup.thenReads.every((field, position) => trailing[position] === field);
  });
}

const observationLookups: readonly HotLookup[] = [
  {
    name: 'repair queue evidence by sourceUrl, newest first',
    equalityFields: ['sourceUrl'],
    thenReads: ['observedAt'],
  },
  {
    name: 'gate and roster lane source-scoped reads of entityKey and entityId',
    equalityFields: ['sourceName', 'entityType', 'superseded'],
    thenReads: ['entityKey', 'entityId'],
  },
  {
    name: 'controlled-vocabulary heading reload',
    equalityFields: ['sourceName', 'field'],
    thenReads: [],
  },
];

const researcherLookups: readonly HotLookup[] = [
  {
    name: 'identity by a profile link URL',
    equalityFields: ['profileLinks.url'],
    thenReads: [],
  },
  {
    name: 'identity by the display profile website URL',
    equalityFields: ['profile.websiteUrl'],
    thenReads: [],
  },
];

describe('the hot observation and researcher lookups have a declared index (#3934)', () => {
  const observationPatterns = declaredKeyPatterns(observationSchema);
  const researcherPatterns = declaredKeyPatterns(researcherSchema);

  it.each(observationLookups.map((lookup) => [lookup.name, lookup] as const))(
    'Observation declares an index serving %s',
    (_name, lookup) => {
      expect(indexServing(observationPatterns, lookup)).toBeDefined();
    },
  );

  it.each(researcherLookups.map((lookup) => [lookup.name, lookup] as const))(
    'Researcher declares an index serving %s',
    (_name, lookup) => {
      expect(indexServing(researcherPatterns, lookup)).toBeDefined();
    },
  );

  it('keeps the trailing read keys in the order the source-scoped reads need', () => {
    const sourceScoped = indexServing(observationPatterns, observationLookups[1]);
    expect(sourceScoped).toEqual([
      'sourceName',
      'entityType',
      'superseded',
      'entityKey',
      'entityId',
    ]);
  });

  it('refuses an index whose equality prefix is right but whose read keys are missing', () => {
    expect(
      indexServing([['sourceName', 'entityType', 'superseded']], observationLookups[1]),
    ).toBeUndefined();
  });

  it('refuses an index that carries the fields without leading on them', () => {
    expect(
      indexServing([['entityType', 'sourceName', 'field', 'superseded']], observationLookups[2]),
    ).toBeUndefined();
  });

  it('keeps the index that the BBS track read leads on, which reads sourceId first', () => {
    expect(observationPatterns).toContainEqual(['sourceId', 'observedAt']);
  });
});
