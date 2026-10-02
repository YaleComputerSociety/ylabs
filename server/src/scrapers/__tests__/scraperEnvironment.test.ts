import { describe, it, expect } from 'vitest';
import {
  applyObservationPruneEnvironmentGuards,
  applyScraperEnvironmentGuards,
  assertScraperEnvironmentMatchesMongoTarget,
  promotionOnlyScraperWriteRefusal,
  resolveMongoDatabaseName,
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

describe('applyObservationPruneEnvironmentGuards', () => {
  it('keeps production retention disabled even with scraper confirmation', () => {
    expect(() =>
      applyObservationPruneEnvironmentGuards({
        apply: true,
        env: {
          SCRAPER_ENV: 'production',
          CONFIRM_PROD_SCRAPE: 'true',
        },
      }),
    ).toThrow('Production observation pruning is disabled.');
  });

  it('forces a dry-run when the target materializer read scope is undeclared', () => {
    const guarded = applyObservationPruneEnvironmentGuards({
      apply: true,
      mongoUrl: 'mongodb://localhost/Development',
      env: {
        SCRAPER_ENV: 'development',
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
      },
    });

    expect(guarded.apply).toBe(false);
    expect(guarded.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('C4_LOSSLESS_INGEST is undeclared')]),
    );
  });

  it('applies once the target declares that its materializer excludes superseded rows', () => {
    const guarded = applyObservationPruneEnvironmentGuards({
      apply: true,
      mongoUrl: 'mongodb://localhost/Development',
      env: {
        SCRAPER_ENV: 'development',
        ALLOW_NON_PROD_SCRAPER_WRITES: 'true',
        C4_LOSSLESS_INGEST: 'false',
      },
    });

    expect(guarded.apply).toBe(true);
    expect(guarded.warnings).toEqual([]);
  });

  it('keeps production pruning disabled even when the read scope is declared', () => {
    expect(() =>
      applyObservationPruneEnvironmentGuards({
        apply: true,
        env: {
          SCRAPER_ENV: 'production',
          CONFIRM_PROD_SCRAPE: 'true',
          C4_LOSSLESS_INGEST: 'false',
        },
      }),
    ).toThrow('Production observation pruning is disabled.');
  });
});

describe('summarizeMongoUrl', () => {
  it('prints host and db name without credentials', () => {
    expect(
      summarizeMongoUrl('mongodb+srv://user:pass@example.mongodb.net/Development?retryWrites=true'),
    ).toBe('example.mongodb.net/Development');
  });
});

describe('resolveMongoDatabaseName', () => {
  it('returns the explicit database name', () => {
    expect(
      resolveMongoDatabaseName('mongodb+srv://user:pass@example.mongodb.net/Beta?retryWrites=true'),
    ).toBe('Beta');
  });
});

describe('assertScraperEnvironmentMatchesMongoTarget', () => {
  it('blocks a Beta scraper profile pointed at Development', () => {
    expect(() =>
      assertScraperEnvironmentMatchesMongoTarget({
        environment: 'beta',
        mongoUrl: 'mongodb://localhost/Development',
        env: { SCRAPER_ENV: 'beta' },
      }),
    ).toThrow('does not match Mongo database "Development"');
  });

  it('allows explicit custom database names', () => {
    expect(() =>
      assertScraperEnvironmentMatchesMongoTarget({
        environment: 'beta',
        mongoUrl: 'mongodb://localhost/YLabsStaging',
        env: {
          SCRAPER_ENV: 'beta',
          SCRAPER_BETA_DB_NAME: 'YLabsStaging',
        },
      }),
    ).not.toThrow();
  });

  it('accepts the real production database name, which is Prod', () => {
    expect(() =>
      assertScraperEnvironmentMatchesMongoTarget({
        environment: 'production',
        mongoUrl: 'mongodb://localhost/Prod',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).not.toThrow();
  });

  it('accepts Production too, so an environment named either way passes', () => {
    expect(() =>
      assertScraperEnvironmentMatchesMongoTarget({
        environment: 'production',
        mongoUrl: 'mongodb://localhost/Production',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).not.toThrow();
  });

  it('blocks a production profile pointed at Beta', () => {
    expect(() =>
      assertScraperEnvironmentMatchesMongoTarget({
        environment: 'production',
        mongoUrl: 'mongodb://localhost/Beta',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toThrow('does not match Mongo database "Beta"');
  });

  it('blocks a production profile pointed at the production copy', () => {
    expect(() =>
      assertScraperEnvironmentMatchesMongoTarget({
        environment: 'production',
        mongoUrl: 'mongodb://localhost/ProductionCopy',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toThrow('does not match Mongo database "ProductionCopy"');
  });

  it('honours a production override and rejects Prod when one is declared', () => {
    expect(() =>
      assertScraperEnvironmentMatchesMongoTarget({
        environment: 'production',
        mongoUrl: 'mongodb://localhost/Prod',
        env: {
          SCRAPER_ENV: 'production',
          SCRAPER_PRODUCTION_DB_NAME: 'ProdRestore',
        },
      }),
    ).toThrow('requires Mongo database "ProdRestore"');
  });
});

describe('assertScraperEnvironmentMatchesMongoTarget with the target omitted (#4320)', () => {
  const productionUrl = 'mongodb+srv://user:pass@example.mongodb.net/Prod';

  it.each(['development', 'beta'] as const)(
    'refuses a %s profile whose only target is a production MONGODBURL',
    (environment) => {
      expect(() =>
        assertScraperEnvironmentMatchesMongoTarget({
          environment,
          env: { SCRAPER_ENV: environment, MONGODBURL: productionUrl },
        }),
      ).toThrow('does not match Mongo database "Prod"');
    },
  );

  it('prefers an explicit target over MONGODBURL', () => {
    expect(() =>
      assertScraperEnvironmentMatchesMongoTarget({
        environment: 'development',
        mongoUrl: 'mongodb://localhost/Development',
        env: { SCRAPER_ENV: 'development', MONGODBURL: productionUrl },
      }),
    ).not.toThrow();
  });

  it('reports the environment target in the guard label instead of calling it missing', () => {
    expect(
      applyScraperEnvironmentGuards({
        command: 'run',
        options: { dryRun: true, useCache: true, release: false },
        autoMaterialize: false,
        env: { SCRAPER_ENV: 'development', MONGODBURL: 'mongodb://localhost/Development' },
      }).dbLabel,
    ).toBe('localhost/Development');
  });

  it('applies the same check through the scraper command guard', () => {
    expect(() =>
      applyScraperEnvironmentGuards({
        command: 'run',
        options: { dryRun: true, useCache: true, release: false },
        autoMaterialize: false,
        env: { SCRAPER_ENV: 'beta', MONGODBURL: productionUrl },
      }),
    ).toThrow('does not match Mongo database "Prod"');
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
      mongoUrl: 'mongodb://localhost/Beta',
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

  it.each([
    ['run', 'beta', 'Beta', { ALLOW_NON_PROD_SCRAPER_WRITES: 'true' }],
    ['materialize', 'beta', 'Beta', { ALLOW_NON_PROD_SCRAPER_WRITES: 'true' }],
    ['run', 'production', 'Prod', { CONFIRM_PROD_SCRAPE: 'true' }],
    ['materialize', 'production', 'Prod', { CONFIRM_PROD_SCRAPE: 'true' }],
  ] as const)(
    'refuses a %s write against %s and points at the promotion path',
    (command, environment, database, confirmations) => {
      expect(() =>
        applyScraperEnvironmentGuards({
          command,
          options: { ...baseOptions, dryRun: false, release: true },
          autoMaterialize: true,
          mongoUrl: `mongodb+srv://example.invalid/${database}`,
          env: { SCRAPER_ENV: environment, ...confirmations },
        }),
      ).toThrow(promotionOnlyScraperWriteRefusal(environment));
    },
  );

  it('names both promotion commands in the refusal', () => {
    expect(promotionOnlyScraperWriteRefusal('beta')).toMatch(/beta:refresh-from-development:plan/);
    expect(promotionOnlyScraperWriteRefusal('production')).toMatch(/production:promote-beta-copy/);
  });

  it('still allows read-only dry runs against Beta and Production', () => {
    const beta = applyScraperEnvironmentGuards({
      command: 'run',
      options: { ...baseOptions, dryRun: true },
      autoMaterialize: false,
      mongoUrl: 'mongodb+srv://example.invalid/Beta',
      env: { SCRAPER_ENV: 'beta', ALLOW_NON_PROD_SCRAPER_WRITES: 'true' },
    });
    expect(beta.options.dryRun).toBe(true);

    const production = applyScraperEnvironmentGuards({
      command: 'materialize',
      options: { ...baseOptions, dryRun: true, useCache: true },
      autoMaterialize: false,
      mongoUrl: 'mongodb+srv://example.invalid/Prod',
      env: { SCRAPER_ENV: 'production' },
    });
    expect(production.options.dryRun).toBe(true);
    expect(production.options.useCache).toBe(false);
  });
});
