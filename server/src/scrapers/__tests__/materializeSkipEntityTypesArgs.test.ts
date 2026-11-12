import { describe, expect, it } from 'vitest';
import { parseSkipEntityTypesList } from '../cliHelpers';

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
