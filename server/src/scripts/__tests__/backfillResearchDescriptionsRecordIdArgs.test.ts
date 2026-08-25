import { describe, expect, it } from 'vitest';

import { parseResearchDescriptionBackfillArgs } from '../backfillResearchDescriptions';

describe('parseResearchDescriptionBackfillArgs --record-id', () => {
  it('collects repeated valid record ids for a scoped card-synthesis run', () => {
    const options = parseResearchDescriptionBackfillArgs([
      '--card-synthesis',
      '--dry-run',
      '--record-id=6a05677d7c6d4fba869fbbc3',
      '--record-id=6a057de313fc60d57ec2a09a',
    ]);

    expect(options.cardSynthesis).toBe(true);
    expect(options.recordIds).toEqual([
      '6a05677d7c6d4fba869fbbc3',
      '6a057de313fc60d57ec2a09a',
    ]);
  });

  it('collects repeated valid record ids for a scoped llm-synthesis run', () => {
    const options = parseResearchDescriptionBackfillArgs([
      '--llm-synthesis',
      '--dry-run',
      '--record-id=6a05677d7c6d4fba869fbbc3',
      '--record-id=6a057de313fc60d57ec2a09a',
    ]);

    expect(options.llmSynthesis).toBe(true);
    expect(options.explicitLimit).toBe(false);
    expect(options.recordIds).toEqual([
      '6a05677d7c6d4fba869fbbc3',
      '6a057de313fc60d57ec2a09a',
    ]);
  });

  it('rejects a record id that is not a 24-character hex ObjectId', () => {
    expect(() =>
      parseResearchDescriptionBackfillArgs(['--card-synthesis', '--record-id=not-an-object-id']),
    ).toThrow('--record-id must be a 24-character hex ObjectId');
  });

  it('leaves recordIds undefined when no record id is supplied', () => {
    const options = parseResearchDescriptionBackfillArgs(['--card-synthesis', '--dry-run']);

    expect(options.recordIds).toBeUndefined();
  });
});
