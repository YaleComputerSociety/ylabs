import { describe, expect, it } from 'vitest';
import { parseSkipEntityTypesList, visibilityGateCollectionAfterSkipping } from '../cliHelpers';

describe('parseSkipEntityTypesList (#5890)', () => {
  it('accepts known observed entity types and dedupes them', () => {
    expect(parseSkipEntityTypesList('researchEntity, researchEntity')).toEqual(['researchEntity']);
  });

  it('refuses an unknown entity type', () => {
    expect(() => parseSkipEntityTypesList('researchEntity,lab')).toThrow(
      /Unknown --skip-entity-types/,
    );
  });

  it('refuses an empty list', () => {
    expect(() => parseSkipEntityTypesList(' , ')).toThrow(/requires a comma-separated list/);
  });
});

describe('visibilityGateCollectionAfterSkipping (#5890)', () => {
  it('gates every collection when no gated type is skipped', () => {
    expect(visibilityGateCollectionAfterSkipping([])).toBe('all');
    expect(visibilityGateCollectionAfterSkipping(['orgUnit'])).toBe('all');
  });

  it('drops the collection each skipped type is served from', () => {
    expect(visibilityGateCollectionAfterSkipping(['researchEntity'])).toBe('programs');
    expect(visibilityGateCollectionAfterSkipping(['fellowship'])).toBe('research');
  });

  it('runs no gate when both gated types are skipped', () => {
    expect(visibilityGateCollectionAfterSkipping(['researchEntity', 'fellowship'])).toBeUndefined();
  });
});
