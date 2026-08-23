import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  assertBackfillGlobalRegionsApplyAllowed,
  assertDevelopmentTarget,
  parseBackfillGlobalRegionsArgs,
} from '../backfillGlobalRegionsDefaultFill';

const OUTPUT_PATH = path.join(os.tmpdir(), 'ylabs-global-regions.json');

describe('backfillGlobalRegionsDefaultFill CLI helpers', () => {
  it('parses apply, confirm, limit, and output flags', () => {
    expect(
      parseBackfillGlobalRegionsArgs([
        '--apply',
        '--confirm-global-regions-backfill',
        '--limit=200',
        '--output',
        OUTPUT_PATH,
      ]),
    ).toEqual({
      apply: true,
      confirmGlobalRegionsBackfill: true,
      limit: 200,
      output: OUTPUT_PATH,
    });
    expect(() => parseBackfillGlobalRegionsArgs(['prod'])).toThrow(
      /Unknown global regions backfill argument: prod/,
    );
    expect(() => parseBackfillGlobalRegionsArgs(['--limit=bad'])).toThrow(
      /--limit requires a positive integer/,
    );
  });

  it('requires bounded limit and explicit confirmation before apply', () => {
    expect(() =>
      assertBackfillGlobalRegionsApplyAllowed(
        { apply: true, confirmGlobalRegionsBackfill: true, limit: Infinity },
        { SCRAPER_ENV: 'development' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Development',
      ),
    ).toThrow(/--limit is required when --apply is set/);

    expect(() =>
      assertBackfillGlobalRegionsApplyAllowed(
        { apply: true, confirmGlobalRegionsBackfill: false, limit: 200 },
        { SCRAPER_ENV: 'development' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Development',
      ),
    ).toThrow(/--confirm-global-regions-backfill is required/);
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
      assertBackfillGlobalRegionsApplyAllowed(
        { apply: true, confirmGlobalRegionsBackfill: true, limit: 200 },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Beta',
      ),
    ).toThrow(/only applies against the Development database/);
  });

  it('allows a Development apply and reports the resolved environment', () => {
    expect(
      assertBackfillGlobalRegionsApplyAllowed(
        { apply: true, confirmGlobalRegionsBackfill: true, limit: 200 },
        { SCRAPER_ENV: 'development' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Development',
      ),
    ).toMatchObject({ environment: 'development' });
  });

  it('performs no environment checks in dry-run mode', () => {
    expect(
      assertBackfillGlobalRegionsApplyAllowed(
        { apply: false, confirmGlobalRegionsBackfill: false, limit: Infinity },
        { SCRAPER_ENV: 'production' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Prod',
      ),
    ).toMatchObject({ environment: 'production' });
  });
});
