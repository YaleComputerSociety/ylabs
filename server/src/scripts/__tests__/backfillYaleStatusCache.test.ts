import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertBackfillYaleStatusCacheApplyAllowed,
  assertDevelopmentTarget,
  parseBackfillYaleStatusCacheArgs,
} from '../backfillYaleStatusCache';

const OUTPUT_PATH = path.join(os.tmpdir(), 'ylabs-yale-status-cache.json');

describe('backfillYaleStatusCache CLI helpers', () => {
  it('parses apply, confirm, limit, and output flags', () => {
    expect(
      parseBackfillYaleStatusCacheArgs([
        '--apply',
        '--confirm-yale-status-cache-backfill',
        '--limit=200',
        '--output',
        OUTPUT_PATH,
      ]),
    ).toEqual({
      apply: true,
      confirmYaleStatusCacheBackfill: true,
      limit: 200,
      output: OUTPUT_PATH,
    });
    expect(() => parseBackfillYaleStatusCacheArgs(['prod'])).toThrow(
      /Unknown research:backfill-yale-status-cache argument: prod/,
    );
    expect(() => parseBackfillYaleStatusCacheArgs(['--limit=bad'])).toThrow(
      /--limit requires a positive integer/,
    );
  });

  it('requires bounded limit and explicit confirmation before apply', () => {
    expect(() =>
      assertBackfillYaleStatusCacheApplyAllowed(
        { apply: true, confirmYaleStatusCacheBackfill: true, limit: Infinity },
        { SCRAPER_ENV: 'development' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Development',
      ),
    ).toThrow(/--limit is required when --apply is set/);

    expect(() =>
      assertBackfillYaleStatusCacheApplyAllowed(
        { apply: true, confirmYaleStatusCacheBackfill: false, limit: 200 },
        { SCRAPER_ENV: 'development' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Development',
      ),
    ).toThrow(/--confirm-yale-status-cache-backfill is required/);
  });

  it('refuses to apply against any database other than Development', () => {
    expect(() => assertDevelopmentTarget('mongodb://example.invalid/Beta')).toThrow(
      /only applies against the Development database/,
    );
    expect(() => assertDevelopmentTarget('mongodb://example.invalid/Prod')).toThrow(
      /only applies against the Development database/,
    );
    expect(() => assertDevelopmentTarget('mongodb://example.invalid/Development')).not.toThrow();

    expect(() =>
      assertBackfillYaleStatusCacheApplyAllowed(
        { apply: true, confirmYaleStatusCacheBackfill: true, limit: 200 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Beta',
      ),
    ).toThrow(/only applies against the Development database/);
  });

  it('allows a Development apply and reports the resolved environment', () => {
    expect(
      assertBackfillYaleStatusCacheApplyAllowed(
        { apply: true, confirmYaleStatusCacheBackfill: true, limit: 200 },
        { SCRAPER_ENV: 'development' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Development',
      ),
    ).toMatchObject({ environment: 'development' });
  });

  it('performs no environment checks in dry-run mode', () => {
    expect(
      assertBackfillYaleStatusCacheApplyAllowed(
        { apply: false, confirmYaleStatusCacheBackfill: false, limit: Infinity },
        { SCRAPER_ENV: 'production' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Prod',
      ),
    ).toMatchObject({ environment: 'production' });
  });
});
