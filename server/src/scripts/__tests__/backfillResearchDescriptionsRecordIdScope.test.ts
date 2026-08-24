import { describe, expect, it } from 'vitest';
import { parseResearchDescriptionBackfillArgs } from '../backfillResearchDescriptions';

describe('parseResearchDescriptionBackfillArgs --record-id scoping', () => {
  it('collects repeated --record-id values for single-writer scoped runs', () => {
    const options = parseResearchDescriptionBackfillArgs([
      '--card-synthesis',
      '--record-id=6a22d4d2cc8d8ec7dea211ec',
      '--record-id=6a058d08ba66f3c14bd85283',
    ]);

    expect(options.cardSynthesis).toBe(true);
    expect(options.recordIds).toEqual([
      '6a22d4d2cc8d8ec7dea211ec',
      '6a058d08ba66f3c14bd85283',
    ]);
  });

  it('leaves recordIds undefined when no --record-id is passed', () => {
    const options = parseResearchDescriptionBackfillArgs(['--card-synthesis', '--dry-run']);
    expect(options.recordIds).toBeUndefined();
  });

  it('ignores an empty --record-id value', () => {
    const options = parseResearchDescriptionBackfillArgs(['--record-id=']);
    expect(options.recordIds).toBeUndefined();
  });
});
