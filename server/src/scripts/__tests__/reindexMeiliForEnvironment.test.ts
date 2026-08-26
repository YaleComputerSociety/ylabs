import { describe, it, expect } from 'vitest';
import {
  assertReindexMeiliEnvironment,
  parseReindexMeiliArgs,
  planIndexReconcile,
} from '../reindexMeiliForEnvironment';

const BETA_ENV = {
  SCRAPER_ENV: 'beta',
  MEILISEARCH_HOST: 'http://meili-beta:7700',
  MEILISEARCH_INDEX_PREFIX: 'beta_',
  MONGODBURL: 'mongodb+srv://user:pass@cluster.example.net/Beta?retryWrites=true',
};

describe('parseReindexMeiliArgs', () => {
  it('defaults to a guarded dry run', () => {
    expect(parseReindexMeiliArgs([])).toEqual({ confirm: false, pageSize: 250 });
  });

  it('parses confirm and page size', () => {
    expect(parseReindexMeiliArgs(['--confirm', '--page-size=100'])).toMatchObject({
      confirm: true,
      pageSize: 100,
    });
  });

  it('rejects a non-positive page size', () => {
    expect(() => parseReindexMeiliArgs(['--page-size=0'])).toThrow('positive integer');
  });

  it('rejects unknown arguments', () => {
    expect(() => parseReindexMeiliArgs(['--wat'])).toThrow('Unknown reindex:meili argument');
  });
});

describe('assertReindexMeiliEnvironment', () => {
  it('accepts a coherent beta target', () => {
    expect(assertReindexMeiliEnvironment({ env: BETA_ENV })).toEqual({
      environment: 'beta',
      meiliHost: 'http://meili-beta:7700',
      indexPrefix: 'beta_',
      database: 'Beta',
    });
  });

  it('refuses development and test targets', () => {
    expect(() => assertReindexMeiliEnvironment({ env: { SCRAPER_ENV: 'development' } })).toThrow(
      'targets beta or production only',
    );
    expect(() => assertReindexMeiliEnvironment({ env: { SCRAPER_ENV: 'test' } })).toThrow(
      'targets beta or production only',
    );
  });

  it('requires a Meilisearch host', () => {
    expect(() =>
      assertReindexMeiliEnvironment({ env: { ...BETA_ENV, MEILISEARCH_HOST: '' } }),
    ).toThrow('MEILISEARCH_HOST must be set');
  });

  it('requires a non-empty index prefix so it cannot clobber the local index', () => {
    expect(() =>
      assertReindexMeiliEnvironment({ env: { ...BETA_ENV, MEILISEARCH_INDEX_PREFIX: '' } }),
    ).toThrow('MEILISEARCH_INDEX_PREFIX must be non-empty');
  });

  it('refuses when the environment does not match the Mongo database', () => {
    expect(() =>
      assertReindexMeiliEnvironment({
        env: {
          ...BETA_ENV,
          MONGODBURL: 'mongodb+srv://user:pass@cluster.example.net/Production',
        },
      }),
    ).toThrow('requires Mongo database "Beta"');
  });

  it('accepts a coherent production target', () => {
    expect(
      assertReindexMeiliEnvironment({
        env: {
          SCRAPER_ENV: 'production',
          MEILISEARCH_HOST: 'http://meili-prod:7700',
          MEILISEARCH_INDEX_PREFIX: 'prod',
          MONGODBURL: 'mongodb+srv://user:pass@cluster.example.net/Production',
        },
      }).environment,
    ).toBe('production');
  });

  it('honors overridden expected database names', () => {
    expect(
      assertReindexMeiliEnvironment({
        env: {
          SCRAPER_ENV: 'production',
          MEILISEARCH_HOST: 'http://meili-prod:7700',
          MEILISEARCH_INDEX_PREFIX: 'prod_',
          SCRAPER_PRODUCTION_DB_NAME: 'ProdRestore',
          MONGODBURL: 'mongodb+srv://user:pass@cluster.example.net/ProdRestore',
        },
      }).database,
    ).toBe('ProdRestore');
  });
});

describe('planIndexReconcile', () => {
  it('keeps the model index, retires listings/papers, reports unknown', () => {
    const plan = planIndexReconcile({
      allIndexUids: [
        'prod_researchentities',
        'prod_listings',
        'prod_papers',
        'prod_legacyquux',
        'beta_researchentities',
      ],
      prefix: 'prod',
    });

    expect(plan.keep).toEqual(['prod_researchentities']);
    expect(plan.retire).toEqual(['prod_listings', 'prod_papers']);
    expect(plan.unknown).toEqual(['prod_legacyquux']);
  });

  it('only touches indexes carrying the exact prefix, never a nested prefix', () => {
    const plan = planIndexReconcile({
      allIndexUids: [
        'beta_researchentities',
        'beta_listings',
        'beta_operator_researchentities',
        'beta_operator_listings',
      ],
      prefix: 'beta',
    });

    expect(plan.keep).toEqual(['beta_researchentities']);
    expect(plan.retire).toEqual(['beta_listings']);
    expect(plan.unknown).toEqual(['beta_operator_researchentities', 'beta_operator_listings']);
  });
});
