import { afterEach, describe, expect, it, vi } from 'vitest';

const originalArgv = process.argv;

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
});

describe('scraper CLI helpers', () => {
  it('exports argument parsing helpers without running the CLI on import', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.argv = ['node', '/tmp/vitest-runner.js', 'help'];

    const cli = await import('../cliHelpers');

    expect(log).not.toHaveBeenCalled();
    expect(
      cli.parseArgs([
        'node',
        'cli.ts',
        'run',
        '--source',
        'orcid',
        '--dry-run',
        '--only',
        'abc, def',
      ]),
    ).toEqual({
      command: 'run',
      flags: {
        source: 'orcid',
        'dry-run': true,
        only: 'abc, def',
      },
    });
    expect(
      cli.parseArgs([
        'node',
        'cli.ts',
        'run',
        '--source=orcid',
        '--dry-run',
        '--output=/tmp/scrape-report.json',
      ]),
    ).toEqual({
      command: 'run',
      flags: {
        source: 'orcid',
        'dry-run': true,
        output: '/tmp/scrape-report.json',
      },
    });
    expect(() =>
      cli.parseArgs(['node', 'cli.ts', 'report', '--output', '--dry-run']),
    ).toThrow(/--output requires a value/);
    expect(() =>
      cli.parseArgs(['node', 'cli.ts', 'report', '--output=--dry-run']),
    ).toThrow(/--output requires a value/);
    expect(() =>
      cli.parseArgs(['node', 'cli.ts', 'run', 'prod', '--source=orcid']),
    ).toThrow(/Unknown scraper CLI argument: prod/);
    expect(() =>
      cli.parseArgs(['node', 'cli.ts', 'prune-observations', '--apply=false']),
    ).toThrow(/--apply does not accept a value/);
    expect(() =>
      cli.parseArgs(['node', 'cli.ts', 'prune-observations', '--apply', 'false']),
    ).toThrow(/Unknown scraper CLI argument: false/);
    expect(() =>
      cli.parseArgs([
        'node',
        'cli.ts',
        'prune-observations',
        '--confirm-observation-prune=false',
      ]),
    ).toThrow(/--confirm-observation-prune does not accept a value/);
    expect(() =>
      cli.parseArgs(['node', 'cli.ts', 'materialize', '--run=run-1', '--confirm-materialize=false']),
    ).toThrow(/--confirm-materialize does not accept a value/);
    expect(() =>
      cli.parseArgs(['node', 'cli.ts', 'run', '--source=orcid', '--release=false']),
    ).toThrow(/--release does not accept a value/);
    expect(() =>
      cli.parseArgs([
        'node',
        'cli.ts',
        'cron',
        '--source=orcid',
        '--release',
        '--force-disabled=false',
      ]),
    ).toThrow(/--force-disabled does not accept a value/);
    expect(() =>
      cli.parseArgs([
        'node',
        'cli.ts',
        'cron',
        '--source=orcid',
        '--release',
        '--force-disabled',
        'false',
      ]),
    ).toThrow(/Unknown scraper CLI argument: false/);
    expect(
      cli.parseArgs([
        'node',
        'cli.ts',
        'run',
        '--source=orcid',
        '--release',
        '--dry-run',
      ]),
    ).toEqual({
      command: 'run',
      flags: {
        source: 'orcid',
        release: true,
        'dry-run': true,
      },
    });
    expect(
      cli.parseArgs([
        'node',
        'cli.ts',
        'cron',
        '--source=orcid',
        '--release',
        '--force-disabled',
      ]),
    ).toEqual({
      command: 'cron',
      flags: {
        source: 'orcid',
        release: true,
        'force-disabled': true,
      },
    });
    expect(
      cli.parseScraperOptions({
        'dry-run': true,
        'use-cache': true,
        release: true,
        only: 'abc, def',
        limit: '25',
        offset: '5',
        'max-openalex-pages-per-author': '2',
      }),
    ).toMatchObject({
      dryRun: true,
      useCache: false,
      release: true,
      only: ['abc', 'def'],
      limit: 25,
      offset: 5,
      maxOpenAlexPagesPerAuthor: 2,
    });
    expect(() => cli.parseScraperOptions({ limit: '12abc' })).toThrow(
      /--limit must be a positive integer/,
    );
    expect(() => cli.parseScraperOptions({ offset: 'bad' })).toThrow(
      /--offset must be a non-negative integer/,
    );
    expect(() =>
      cli.parseScraperOptions({ 'max-openalex-pages-per-author': '0' }),
    ).toThrow(/--max-openalex-pages-per-author must be a positive integer/);
    expect(cli.parseIntegerFlag({ 'keep-runs': '2' }, 'keep-runs', 3, { min: 0 })).toBe(2);
    expect(() => cli.parseIntegerFlag({ 'keep-runs': '2.5' }, 'keep-runs', 3, { min: 0 })).toThrow(
      /--keep-runs must be an integer greater than or equal to 0/,
    );
    expect(() =>
      cli.parseIntegerFlag({ 'older-than-days': '30days' }, 'older-than-days', 30, { min: 1 }),
    ).toThrow(/--older-than-days must be an integer greater than or equal to 1/);
  });

  it('preflights write-capable commands before any Mongo connection is needed', async () => {
    const cli = await import('../cliHelpers');

    expect(() =>
      cli.buildScraperCliPreflight(
        'run',
        { source: 'orcid', release: true },
        'mongodb+srv://example.mongodb.net/Production',
        { SCRAPER_ENV: 'production', CONFIRM_PROD_SCRAPE: 'false' } as NodeJS.ProcessEnv,
      ),
    ).toThrow(/CONFIRM_PROD_SCRAPE=true/);

    expect(() =>
      cli.buildScraperCliPreflight(
        'prune-observations',
        { apply: true },
        'mongodb+srv://example.mongodb.net/Beta',
        { SCRAPER_ENV: 'beta', ALLOW_NON_PROD_SCRAPER_WRITES: 'true' } as NodeJS.ProcessEnv,
      ),
    ).toThrow(/--confirm-observation-prune is required/);

    expect(() =>
      cli.buildScraperCliPreflight(
        'prune-observations',
        { apply: true, 'confirm-observation-prune': true },
        'mongodb+srv://example.mongodb.net/Production',
        { SCRAPER_ENV: 'production', CONFIRM_PROD_SCRAPE: 'false' } as NodeJS.ProcessEnv,
      ),
    ).toThrow(/CONFIRM_PROD_SCRAPE=true/);

    expect(
      cli.buildScraperCliPreflight(
        'prune-observations',
        { apply: true, 'confirm-observation-prune': true },
        'mongodb+srv://example.mongodb.net/Beta',
        { SCRAPER_ENV: 'beta', ALLOW_NON_PROD_SCRAPER_WRITES: 'true' } as NodeJS.ProcessEnv,
      ),
    ).toMatchObject({
      command: 'prune-observations',
      guard: {
        apply: true,
      },
    });

    expect(() =>
      cli.buildScraperCliPreflight(
        'materialize',
        { run: 'run-1' },
        'mongodb+srv://example.mongodb.net/Beta',
        { SCRAPER_ENV: 'beta', ALLOW_NON_PROD_SCRAPER_WRITES: 'true' } as NodeJS.ProcessEnv,
      ),
    ).toThrow(/--confirm-materialize is required/);

    expect(
      cli.buildScraperCliPreflight(
        'materialize',
        { run: 'run-1', 'confirm-materialize': true },
        'mongodb+srv://example.mongodb.net/Beta',
        { SCRAPER_ENV: 'beta', ALLOW_NON_PROD_SCRAPER_WRITES: 'true' } as NodeJS.ProcessEnv,
      ),
    ).toMatchObject({
      command: 'materialize',
      runId: 'run-1',
      confirmMaterialize: true,
      guard: {
        options: {
          dryRun: false,
        },
      },
    });

    expect(
      cli.buildScraperCliPreflight(
        'materialize',
        { run: 'run-1' },
        'mongodb+srv://example.mongodb.net/Beta',
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
      ),
    ).toMatchObject({
      command: 'materialize',
      runId: 'run-1',
      confirmMaterialize: false,
      guard: {
        options: {
          dryRun: true,
        },
      },
    });
  });

  it('builds materialization review artifacts from materialize, visibility, and run reports', async () => {
    const cli = await import('../cliHelpers');

    expect(
      cli.buildMaterializeOutputPayload({
        runId: 'run-123',
        materialization: {
          dryRun: true,
          processed: 12,
          errors: 0,
        },
        report: {
          run: { sourceName: 'orcid', status: 'success' },
          observations: { total: 12 },
        },
        visibilityGate: {
          collection: 'all',
          mode: 'apply',
          changed: 0,
        },
      }),
    ).toEqual({
      runId: 'run-123',
      materialization: {
        dryRun: true,
        processed: 12,
        errors: 0,
      },
      visibilityGate: {
        collection: 'all',
        mode: 'apply',
        changed: 0,
      },
      report: {
        run: { sourceName: 'orcid', status: 'success' },
        observations: { total: 12 },
      },
    });
  });

  it('wraps scraper CLI artifacts with target metadata while preserving payload fields', async () => {
    const cli = await import('../cliHelpers');

    const output = cli.buildScraperCliOutputPayload(
      {
        run: { id: 'run-123', sourceName: 'orcid' },
        observations: { total: 0 },
      },
      {
        command: 'run',
        environment: 'beta',
        db: 'Beta',
        options: {
          sourceName: 'orcid',
          dryRun: true,
          only: ['__codex_no_such_netid__'],
        },
      },
    );

    expect(output).toEqual({
      run: { id: 'run-123', sourceName: 'orcid' },
      observations: { total: 0 },
      command: 'run',
      environment: 'beta',
      db: 'Beta',
      options: {
        sourceName: 'orcid',
        dryRun: true,
        only: ['__codex_no_such_netid__'],
      },
    });
  });

  it('builds cron review artifacts from completed and skipped cron results', async () => {
    const cli = await import('../cliHelpers');
    const completedCronResult = {
      status: 'completed' as const,
      sourceName: 'orcid',
      runId: 'run-123',
      exitCode: 0 as const,
      ownerId: 'owner-1',
      scrapeResult: { observationCount: 2 },
      materializationResult: {
        materialized: 2,
        created: 1,
        updated: 1,
        conflicts: 0,
        skipped: 0,
        errors: 0,
        postMaterializationMetrics: {
          entryPathways: 0,
          accessSignals: 0,
          contactRoutes: 0,
          postedOpportunities: 0,
          guardedContactRoutes: 0,
          staleEvidenceSkipped: 0,
          conflicts: 0,
          errors: 0,
        },
      },
      visibilityGateResult: {
        mode: 'apply' as const,
        collection: 'all' as const,
        scanned: 2,
        counts: {
          scanned: 2,
          promoted: 2,
          held: 0,
          resolved: 2,
          changed: 0,
        },
        reasonCounts: {},
        blockerCounts: {},
        sourceCounts: {},
        samples: [],
      },
      report: {
        run: {
          id: 'run-123',
          sourceName: 'orcid',
          status: 'success',
          invalidated: false,
          options: {},
        },
        observations: {
          total: 2,
          entitiesObserved: 1,
          byEntityType: {},
          byField: {},
          topFields: [],
          active: 2,
          superseded: 0,
          duplicateRate: 0,
        },
        materialization: {
          created: 1,
          updated: 1,
          archived: 0,
          skipped: 0,
          conflicts: 0,
          errors: 0,
        },
        coverage: {
          fetch: {
            attempts: 0,
            succeeded: 0,
            failed: 0,
            blocked: 0,
            selectorBreakages: 0,
            byMode: {},
          },
          observationsEmitted: 2,
          materializationWrites: 2,
        },
        quality: {
          conflictCandidateCount: 0,
          conflictCandidates: [],
          missingEntityIdentifierCount: 0,
          missingSourceUrlCount: 0,
          lowConfidenceCount: 0,
        },
        warnings: [],
        errors: [],
      },
    };

    expect(cli.buildCronOutputPayload(completedCronResult)).toEqual(completedCronResult);

    expect(
      cli.buildCronOutputPayload({
        status: 'skipped-lock-held',
        sourceName: 'orcid',
        exitCode: 0,
        ownerId: 'owner-1',
      }),
    ).toEqual({
      status: 'skipped-lock-held',
      sourceName: 'orcid',
      exitCode: 0,
      ownerId: 'owner-1',
    });
  });
});
