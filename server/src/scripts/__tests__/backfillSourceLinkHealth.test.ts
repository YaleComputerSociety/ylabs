import { describe, expect, it } from 'vitest';

import {
  parseSourceLinkHealthBackfillArgs,
  sourceLinkHealthRunOptions,
} from '../backfillSourceLinkHealth';

describe('parseSourceLinkHealthBackfillArgs', () => {
  it('defaults to a full dry run that re-probes every row', () => {
    const options = parseSourceLinkHealthBackfillArgs([]);
    expect(options.dryRun).toBe(true);
    expect(options.staleOnly).toBe(false);
  });

  it('parses --stale-only', () => {
    expect(parseSourceLinkHealthBackfillArgs(['--stale-only']).staleOnly).toBe(true);
  });

  it('still rejects an unknown flag', () => {
    expect(() => parseSourceLinkHealthBackfillArgs(['--stale'])).toThrow();
  });
});

describe('sourceLinkHealthRunOptions', () => {
  it('carries --stale-only through to the run, so the flag is not inert', () => {
    const options = parseSourceLinkHealthBackfillArgs([
      '--apply',
      '--limit=100',
      '--confirm-source-link-health',
      '--stale-only',
    ]);
    expect(sourceLinkHealthRunOptions(options)).toEqual({
      dryRun: false,
      limit: 100,
      staleOnly: true,
    });
  });

  it('omits the limit when none was given explicitly', () => {
    expect(sourceLinkHealthRunOptions(parseSourceLinkHealthBackfillArgs([]))).toEqual({
      dryRun: true,
      staleOnly: false,
    });
  });
});
