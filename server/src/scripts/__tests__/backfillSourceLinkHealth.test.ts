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

describe('--checked-before', () => {
  it('parses an ISO timestamp and carries it through to the run', () => {
    const options = parseSourceLinkHealthBackfillArgs([
      '--apply',
      '--limit=5000',
      '--confirm-source-link-health',
      '--checked-before=2026-09-10T21:00:00.000Z',
    ]);
    expect(options.checkedBefore?.toISOString()).toBe('2026-09-10T21:00:00.000Z');
    expect(sourceLinkHealthRunOptions(options)).toEqual({
      dryRun: false,
      limit: 5000,
      staleOnly: false,
      checkedBefore: new Date('2026-09-10T21:00:00.000Z'),
    });
  });

  it('accepts the space-separated form', () => {
    expect(
      parseSourceLinkHealthBackfillArgs([
        '--checked-before',
        '2026-09-10T21:00:00.000Z',
      ]).checkedBefore?.toISOString(),
    ).toBe('2026-09-10T21:00:00.000Z');
  });

  it('rejects a missing or unparseable timestamp', () => {
    expect(() => parseSourceLinkHealthBackfillArgs(['--checked-before'])).toThrow();
    expect(() => parseSourceLinkHealthBackfillArgs(['--checked-before=yesterday'])).toThrow();
    expect(() => parseSourceLinkHealthBackfillArgs(['--checked-before', '--limit=5'])).toThrow();
  });

  it('is absent from the run options when not given', () => {
    expect(sourceLinkHealthRunOptions(parseSourceLinkHealthBackfillArgs([]))).toEqual({
      dryRun: true,
      staleOnly: false,
    });
  });
});
