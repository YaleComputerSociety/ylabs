import { describe, expect, it } from 'vitest';

import {
  parseSourceLinkHealthBackfillArgs,
  sourceLinkHealthRunOptions,
  sourceLinkHealthBackfillStdoutSummary,
  type SourceLinkHealthBackfillResult,
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

  it('parses --http-websites-only', () => {
    expect(parseSourceLinkHealthBackfillArgs(['--http-websites-only']).httpWebsitesOnly).toBe(true);
    expect(parseSourceLinkHealthBackfillArgs([]).httpWebsitesOnly).toBe(false);
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

  it('carries --http-websites-only through to the run, so the scope is not inert', () => {
    const options = parseSourceLinkHealthBackfillArgs(['--http-websites-only']);
    expect(sourceLinkHealthRunOptions(options)).toEqual({
      dryRun: true,
      staleOnly: false,
      httpWebsitesOnly: true,
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

describe('--reprobe-healthy-after-days', () => {
  it('parses the window and carries it through to the run', () => {
    const options = parseSourceLinkHealthBackfillArgs(['--reprobe-healthy-after-days=7']);
    expect(options.reprobeHealthyAfterDays).toBe(7);
    expect(sourceLinkHealthRunOptions(options)).toEqual({
      dryRun: true,
      staleOnly: false,
      reprobeHealthyAfterDays: 7,
    });
  });

  it('rejects a non-positive window', () => {
    expect(() => parseSourceLinkHealthBackfillArgs(['--reprobe-healthy-after-days=0'])).toThrow(
      /--reprobe-healthy-after-days must be a positive integer/,
    );
  });

  it('refuses to combine with --stale-only, which scopes by row instead', () => {
    expect(() =>
      parseSourceLinkHealthBackfillArgs(['--stale-only', '--reprobe-healthy-after-days=7']),
    ).toThrow(/alternative scopes/);
  });
});

describe('sourceLinkHealthBackfillStdoutSummary', () => {
  it('prints sample lists as counts so no slug reaches stdout', () => {
    const slug = 'fixture-row-slug';
    const result = {
      mode: 'dry-run',
      scanned: 1,
      skippedFresh: 0,
      skippedAlreadyRechecked: 0,
      carriedFreshHealthy: 0,
      unchangedRows: 0,
      checked: 1,
      updated: 1,
      errors: 0,
      preservedDecisiveVerdicts: 0,
      preservedUnreachedVerdicts: 0,
      verdictTransitions: { 'HEALTHY->UNAVAILABLE': 1 },
      clearedTlsFlags: 0,
      servedWebsitesLost: 1,
      lostVerdictSamples: [
        {
          slug,
          url: 'https://fixture.example.edu/',
          transition: 'HEALTHY->UNAVAILABLE',
          servedWebsite: true,
        },
      ],
      indexSyncFailures: 0,
      indexSyncDeferred: 0,
      resolver: {
        controlChecks: 0,
        tripsAvoided: 0,
        trips: 0,
        knownUnresolvableFailuresIgnored: 0,
      },
      byStatus: { UNAVAILABLE: 1 },
      samples: [{ slug, url: 'https://fixture.example.edu/', healthStatus: 'UNAVAILABLE' }],
    } as SourceLinkHealthBackfillResult;

    const printed = JSON.stringify(sourceLinkHealthBackfillStdoutSummary(result));

    expect(printed).not.toContain(slug);
    expect(printed).not.toContain('fixture.example.edu');
    expect(sourceLinkHealthBackfillStdoutSummary(result)).toMatchObject({
      sampleCount: 1,
      lostVerdictSampleCount: 1,
      servedWebsitesLost: 1,
      verdictTransitions: { 'HEALTHY->UNAVAILABLE': 1 },
    });
  });
});
