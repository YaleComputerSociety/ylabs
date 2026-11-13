import { describe, expect, it } from 'vitest';

import {
  parseSourceLinkHealthBackfillArgs,
  sourceLinkHealthRunOptions,
  sourceLinkHealthBackfillStdoutSummary,
  type SourceLinkHealthBackfillResult,
  DEFAULT_DRY_RUN_SAMPLE_PER_HOST,
  DEFAULT_DRY_RUN_PROBE_REUSE_HOURS,
  readSourceLinkUrlFile,
} from '../backfillSourceLinkHealth';

const DEFAULT_REUSE_MS = DEFAULT_DRY_RUN_PROBE_REUSE_HOURS * 60 * 60_000;

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
      samplePerHost: DEFAULT_DRY_RUN_SAMPLE_PER_HOST,
      reuseProbesWithinMs: DEFAULT_REUSE_MS,
    });
  });

  it('omits the limit when none was given explicitly', () => {
    expect(sourceLinkHealthRunOptions(parseSourceLinkHealthBackfillArgs([]))).toEqual({
      dryRun: true,
      staleOnly: false,
      samplePerHost: DEFAULT_DRY_RUN_SAMPLE_PER_HOST,
      reuseProbesWithinMs: DEFAULT_REUSE_MS,
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
      samplePerHost: DEFAULT_DRY_RUN_SAMPLE_PER_HOST,
      reuseProbesWithinMs: DEFAULT_REUSE_MS,
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
      samplePerHost: DEFAULT_DRY_RUN_SAMPLE_PER_HOST,
      reuseProbesWithinMs: DEFAULT_REUSE_MS,
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
      deferredPausedHost: 0,
      pausedHosts: '',
      preservedDecisiveVerdicts: 0,
      preservedUnreachedVerdicts: 0,
      heldConnectionFailures: 2,
      verdictTransitions: { 'HEALTHY->UNAVAILABLE': 1 },
      clearedTlsFlags: 0,
      servedWebsitesLost: 1,
      excludedHostLinks: 0,
      keptUnobservedLinks: 0,
      probesReused: 0,
      probesByHost: {},
      stoppedHosts: [],
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
      heldConnectionFailures: 2,
      verdictTransitions: { 'HEALTHY->UNAVAILABLE': 1 },
    });
  });
});

describe('#6182 dry-run sampling and url scope flags', () => {
  it('samples a dry run by default, and --full-dry-run sweeps', () => {
    expect(sourceLinkHealthRunOptions(parseSourceLinkHealthBackfillArgs([])).samplePerHost).toBe(
      DEFAULT_DRY_RUN_SAMPLE_PER_HOST,
    );
    expect(
      sourceLinkHealthRunOptions(parseSourceLinkHealthBackfillArgs(['--full-dry-run']))
        .samplePerHost,
    ).toBeUndefined();
    expect(
      sourceLinkHealthRunOptions(parseSourceLinkHealthBackfillArgs(['--sample-per-host=5']))
        .samplePerHost,
    ).toBe(5);
  });

  it('never samples an apply, and refuses sampling flags on one', () => {
    const apply = ['--apply', '--confirm-source-link-health', '--limit=10'];
    expect(
      sourceLinkHealthRunOptions(parseSourceLinkHealthBackfillArgs(apply)).samplePerHost,
    ).toBeUndefined();
    expect(() => parseSourceLinkHealthBackfillArgs([...apply, '--full-dry-run'])).toThrow();
    expect(() => parseSourceLinkHealthBackfillArgs([...apply, '--sample-per-host=5'])).toThrow();
  });

  it('carries --stop-on-status and refuses a non-status', () => {
    expect(
      sourceLinkHealthRunOptions(parseSourceLinkHealthBackfillArgs(['--stop-on-status=403,429']))
        .stopOnStatuses,
    ).toEqual([403, 429]);
    expect(() => parseSourceLinkHealthBackfillArgs(['--stop-on-status=forbidden'])).toThrow();
  });

  it('reads a url file in order, skipping blanks, comments and repeats', () => {
    expect(
      readSourceLinkUrlFile(
        'https://a.example.edu/x\n\n# note\nhttps://b.example.edu/y\nhttps://a.example.edu/x\n',
      ),
    ).toEqual(['https://a.example.edu/x', 'https://b.example.edu/y']);
  });
});

describe('#6214 dry-run probe reuse flags', () => {
  const apply = ['--apply', '--confirm-source-link-health', '--limit=10'];

  it('reuses probes for a day on a dry run by default', () => {
    expect(
      sourceLinkHealthRunOptions(parseSourceLinkHealthBackfillArgs([])).reuseProbesWithinMs,
    ).toBe(24 * 60 * 60_000);
  });

  it('takes a window in hours, and --no-probe-reuse turns reuse off', () => {
    expect(
      sourceLinkHealthRunOptions(
        parseSourceLinkHealthBackfillArgs(['--reuse-probes-within-hours=2']),
      ).reuseProbesWithinMs,
    ).toBe(2 * 60 * 60_000);
    expect(
      sourceLinkHealthRunOptions(parseSourceLinkHealthBackfillArgs(['--no-probe-reuse']))
        .reuseProbesWithinMs,
    ).toBeUndefined();
    expect(() =>
      parseSourceLinkHealthBackfillArgs(['--no-probe-reuse', '--reuse-probes-within-hours=2']),
    ).toThrow();
  });

  it('never reuses probes on an apply, and refuses the window flag on one', () => {
    expect(
      sourceLinkHealthRunOptions(parseSourceLinkHealthBackfillArgs(apply)).reuseProbesWithinMs,
    ).toBeUndefined();
    expect(() =>
      parseSourceLinkHealthBackfillArgs([...apply, '--reuse-probes-within-hours=2']),
    ).toThrow(/dry run only/);
  });
});
