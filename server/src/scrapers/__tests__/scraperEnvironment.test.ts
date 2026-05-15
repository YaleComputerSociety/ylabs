import { describe, it, expect } from 'vitest';
import {
  applyScraperEnvironmentGuards,
  resolveScraperEnvironment,
  summarizeMongoUrl,
} from '../scraperEnvironment';

describe('resolveScraperEnvironment', () => {
  it('normalizes common environment aliases', () => {
    expect(resolveScraperEnvironment({ SCRAPER_ENV: 'prod' })).toBe('production');
    expect(resolveScraperEnvironment({ SCRAPER_ENV: 'staging' })).toBe('beta');
    expect(resolveScraperEnvironment({ NODE_ENV: 'ci' })).toBe('test');
    expect(resolveScraperEnvironment({ NODE_ENV: 'dev' })).toBe('development');
  });
});

describe('summarizeMongoUrl', () => {
  it('prints host and db name without credentials', () => {
    expect(
      summarizeMongoUrl('mongodb+srv://user:pass@example.mongodb.net/Development?retryWrites=true'),
    ).toBe('example.mongodb.net/Development');
  });
});

describe('applyScraperEnvironmentGuards', () => {
  const baseOptions = {
    dryRun: false,
    useCache: true,
    release: false,
  };

  it('forces non-production run commands into dry-run by default', () => {
    const guarded = applyScraperEnvironmentGuards({
      command: 'run',
      options: baseOptions,
      autoMaterialize: true,
      mongoUrl: 'mongodb://localhost/Development',
      env: { SCRAPER_ENV: 'beta' },
    });

    expect(guarded.environment).toBe('beta');
    expect(guarded.options.dryRun).toBe(true);
    expect(guarded.autoMaterialize).toBe(false);
    expect(guarded.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('forcing --dry-run'),
        expect.stringContaining('disabling --auto-materialize'),
      ]),
    );
  });

  it('allows explicit non-production writes only with override env var', () => {
    const guarded = applyScraperEnvironmentGuards({
      command: 'run',
      options: baseOptions,
      autoMaterialize: true,
      mongoUrl: 'mongodb://localhost/Development',
      env: {
        SCRAPER_ENV: 'development',
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
      },
    });

    expect(guarded.options.dryRun).toBe(false);
    expect(guarded.autoMaterialize).toBe(true);
    expect(guarded.warnings).toEqual([]);
  });

  it('blocks production writes without --release', () => {
    expect(() =>
      applyScraperEnvironmentGuards({
        command: 'run',
        options: { ...baseOptions, dryRun: false, release: false },
        autoMaterialize: false,
        env: {
          SCRAPER_ENV: 'production',
          CONFIRM_PROD_SCRAPE: 'true',
        },
      }),
    ).toThrow('Production scraper writes require --release.');
  });

  it('blocks production writes without confirmation env var', () => {
    expect(() =>
      applyScraperEnvironmentGuards({
        command: 'run',
        options: { ...baseOptions, dryRun: false, release: true },
        autoMaterialize: false,
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toThrow('CONFIRM_PROD_SCRAPE=true');
  });

  it('allows confirmed production release writes and disables cache', () => {
    const guarded = applyScraperEnvironmentGuards({
      command: 'run',
      options: { ...baseOptions, dryRun: false, release: true, useCache: true },
      autoMaterialize: true,
      env: {
        SCRAPER_ENV: 'production',
        CONFIRM_PROD_SCRAPE: 'true',
      },
    });

    expect(guarded.options.dryRun).toBe(false);
    expect(guarded.options.release).toBe(true);
    expect(guarded.options.useCache).toBe(false);
    expect(guarded.autoMaterialize).toBe(true);
  });

  it('treats cron as a confirmed production release write', () => {
    expect(() =>
      applyScraperEnvironmentGuards({
        command: 'cron',
        options: { ...baseOptions, dryRun: false, release: false },
        autoMaterialize: true,
        env: {
          SCRAPER_ENV: 'production',
          CONFIRM_PROD_SCRAPE: 'true',
        },
      }),
    ).toThrow('Production scraper writes require --release.');

    expect(() =>
      applyScraperEnvironmentGuards({
        command: 'cron',
        options: { ...baseOptions, dryRun: false, release: true },
        autoMaterialize: true,
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toThrow('CONFIRM_PROD_SCRAPE=true');
  });
});
