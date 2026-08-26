import { describe, expect, it } from 'vitest';
import { buildOrchestrator } from '../../scrapers/registry';
import {
  SCRAPER_SWEEP_SOURCES,
  buildDevelopmentPostRunStages,
  buildScraperSweepChildArgs,
  parseScraperSweepArgs,
  scraperSweepArtifactError,
  validateScraperSweepEnvironment,
  validateScraperSweepManifest,
  validateScraperSweepSourceRows,
} from '../runScraperSweep';

describe('runScraperSweep', () => {
  it('includes every registered scraper exactly once', () => {
    const registeredNames = buildOrchestrator()
      .list()
      .map((source) => source.name);
    expect(() => validateScraperSweepManifest(registeredNames)).not.toThrow();
    expect(new Set(SCRAPER_SWEEP_SOURCES.map((source) => source.name)).size).toBe(
      registeredNames.length,
    );
  });

  it('blocks a sweep manifest that omits a registered scraper', () => {
    expect(() => validateScraperSweepManifest(['yale-directory', 'future-source'])).toThrow(
      /missing from sweep|unknown sweep sources/,
    );
  });

  it('fails before the sweep when a registered source metadata row is missing', () => {
    expect(() =>
      validateScraperSweepSourceRows(['yale-directory', 'center-director-llm'], ['yale-directory']),
    ).toThrow(/center-director-llm.*source metadata seed/i);
  });

  it('requires explicit confirmation for full Development and Beta fetch sweeps', () => {
    expect(() => parseScraperSweepArgs(['--mode=development-full'])).toThrow(
      /confirm-development-full-sweep/,
    );
    expect(() => parseScraperSweepArgs(['--mode=beta-fetch'])).toThrow(
      /confirm-beta-release-candidate/,
    );
    expect(
      parseScraperSweepArgs(['--mode=development-full', '--confirm-development-full-sweep']).mode,
    ).toBe('development-full');
    expect(
      parseScraperSweepArgs(['--mode=beta-fetch', '--confirm-beta-release-candidate']).mode,
    ).toBe('beta-fetch');
  });

  it('builds bounded plan arguments and exhaustive full-sweep arguments', () => {
    expect(
      buildScraperSweepChildArgs('development-plan', 'yale-directory', '/tmp/yale-directory.json'),
    ).toEqual([
      '--cwd',
      'server',
      'scrape',
      'run',
      '--source',
      'yale-directory',
      '--limit',
      '100',
      '--use-cache',
      '--dry-run',
      '--output',
      '/tmp/yale-directory.json',
    ]);
    const betaArgs = buildScraperSweepChildArgs(
      'beta-fetch',
      'yale-directory',
      '/tmp/yale-directory.json',
    );
    expect(betaArgs).toContain('--ignore-work-planner');
    expect(betaArgs).toContain('--exhaustive');
    expect(betaArgs).not.toContain('--limit');
    expect(betaArgs).not.toContain('--auto-materialize');
    expect(betaArgs).not.toContain('--use-cache');

    const developmentArgs = buildScraperSweepChildArgs(
      'development-full',
      'yale-directory',
      '/tmp/yale-directory.json',
    );
    expect(developmentArgs).toContain('--exhaustive');
    expect(developmentArgs).not.toContain('--limit');
    expect(developmentArgs).toContain('--auto-materialize');
  });

  it('rejects incomplete runs and Development materialization errors', () => {
    expect(
      scraperSweepArtifactError('development-full', {
        runId: 'run-1',
        runStatus: 'success',
        materializationErrors: 1,
      }),
    ).toMatch(/materialization reported 1 errors/);
    expect(
      scraperSweepArtifactError('beta-fetch', {
        runId: 'run-2',
        runStatus: 'success',
      }),
    ).toBeUndefined();
    expect(
      scraperSweepArtifactError('beta-fetch', {
        runStatus: 'success',
      }),
    ).toMatch(/missing run.id/);
  });

  it('builds the complete Development post-run quality pipeline', () => {
    const stages = buildDevelopmentPostRunStages('/tmp/development-sweep');
    expect(stages.map((stage) => stage.name)).toEqual([
      'faculty-projection',
      'search-rebuild',
      'coverage-audit',
      'data-quality',
      'integrity-gate',
      'trust-contract',
      'archived-cleanup',
    ]);
    expect(stages.every((stage) => stage.artifactPath.startsWith('/tmp/development-sweep/'))).toBe(
      true,
    );
    expect(stages.find((stage) => stage.name === 'archived-cleanup')?.args).toEqual(
      expect.arrayContaining(['research-entity:cleanup-archived', '--merge-residue-only']),
    );
    expect(stages.find((stage) => stage.name === 'archived-cleanup')?.args).not.toContain(
      '--apply',
    );
    expect(stages.find((stage) => stage.name === 'faculty-projection')?.args).toEqual(
      expect.arrayContaining(['--apply', '--confirm-faculty-projection']),
    );
    expect(stages.find((stage) => stage.name === 'data-quality')?.args).toEqual(
      expect.arrayContaining(['--strict', '--include-samples', '--progress']),
    );
    expect(stages.find((stage) => stage.name === 'trust-contract')?.args).toEqual(
      expect.arrayContaining([
        '--collection=all',
        '--mode=student-ready-only',
        '--include-research-activity',
        '--include-paper-quality',
        '--strict',
      ]),
    );
  });

  it('requires an exact Development database and local unprefixed Meilisearch for writes', () => {
    expect(() =>
      validateScraperSweepEnvironment('development-full', {
        SCRAPER_ENV: 'development',
        MONGODBURL: 'mongodb+srv://example.invalid/Development',
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
        MEILISEARCH_HOST: 'http://127.0.0.1:7700',
      }),
    ).not.toThrow();
    expect(() =>
      validateScraperSweepEnvironment('development-full', {
        SCRAPER_ENV: 'development',
        MONGODBURL: 'mongodb+srv://example.invalid/Beta',
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
        MEILISEARCH_HOST: 'http://127.0.0.1:7700',
      }),
    ).toThrow(/Development/);
    expect(() =>
      validateScraperSweepEnvironment('development-full', {
        SCRAPER_ENV: 'development',
        MONGODBURL: 'mongodb+srv://example.invalid/Development',
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
        MEILISEARCH_HOST: 'https://search.example.test',
      }),
    ).toThrow(/non-local/);
  });

  it('requires Beta writes and never accepts a Production target', () => {
    expect(() =>
      validateScraperSweepEnvironment('beta-fetch', {
        SCRAPER_ENV: 'beta',
        MONGODBURL: 'mongodb+srv://example.invalid/Beta',
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
      }),
    ).not.toThrow();
    expect(() =>
      validateScraperSweepEnvironment('beta-fetch', {
        SCRAPER_ENV: 'production',
        MONGODBURL: 'mongodb+srv://example.invalid/Production',
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
      }),
    ).toThrow(/SCRAPER_ENV=beta/);
  });
});
