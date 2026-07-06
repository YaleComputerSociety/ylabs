import { describe, expect, it } from 'vitest';

import {
  assertV4MigrationApplyAllowed,
  buildV4MigrationOutput,
  parseMigrationOptions,
} from '../../../../data-migration/v4MigrationUtils';

describe('legacy v4 migration utility safety helpers', () => {
  it('parses apply, limit, separated limit, and output flags from explicit argv', () => {
    expect(
      parseMigrationOptions([
        '--apply',
        '--confirm-v4-migration',
        '--limit',
        '25',
        '--output=/tmp/v4.json',
      ]),
    ).toEqual({
      apply: true,
      confirmV4Migration: true,
      limit: 25,
      output: '/tmp/v4.json',
    });

    expect(parseMigrationOptions(['--live', '--limit=10', '--output', '/tmp/v4-live.json'])).toEqual({
      apply: true,
      confirmV4Migration: false,
      limit: 10,
      output: '/tmp/v4-live.json',
    });

    expect(() => parseMigrationOptions(['--limit', 'not-a-number'])).toThrow(
      /--limit requires a positive integer/,
    );
    expect(() => parseMigrationOptions(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseMigrationOptions(['prod'])).toThrow(
      /Unknown legacy v4 migration argument: prod/,
    );
  });

  it('blocks production applies before shared v4 migration DB access', () => {
    expect(() =>
      assertV4MigrationApplyAllowed(
        { apply: true, confirmV4Migration: true, limit: 5 },
        'legacy v4 paper graph backfill',
        {
          SCRAPER_ENV: 'production',
          CONFIRM_PROD_SCRAPE: 'false',
        } as NodeJS.ProcessEnv,
        'mongodb+srv://example.invalid/Production',
      ),
    ).toThrow(/CONFIRM_PROD_SCRAPE=true/);

    expect(
      assertV4MigrationApplyAllowed(
        { apply: false },
        'legacy v4 paper graph backfill',
        { SCRAPER_ENV: 'production' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.invalid/Production',
      ),
    ).toMatchObject({ environment: 'production' });
  });

  it('requires a bounded limit before legacy v4 apply mode can run', () => {
    expect(() =>
      assertV4MigrationApplyAllowed(
        { apply: true },
        'legacy v4 research group member backfill',
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.invalid/Beta',
      ),
    ).toThrow(/--limit is required/);
  });

  it('requires explicit confirmation before legacy v4 apply mode can run', () => {
    expect(parseMigrationOptions(['--apply', '--limit=5'])).toMatchObject({
      apply: true,
      confirmV4Migration: false,
      limit: 5,
    });

    expect(() =>
      assertV4MigrationApplyAllowed(
        { apply: true, confirmV4Migration: false, limit: 5 },
        'legacy v4 paper graph backfill',
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb+srv://example.invalid/Beta',
      ),
    ).toThrow(/--confirm-v4-migration is required/);
  });

  it('wraps shared v4 migration artifacts with target metadata and parsed options', () => {
    const output = buildV4MigrationOutput(
      { mode: 'dry-run', planned: 3 },
      {
        generatedAt: '2026-06-01T12:00:00.000Z',
        environment: 'beta',
        db: 'Beta',
        options: { apply: false, limit: 3, output: '/tmp/v4.json' },
      },
    );

    expect(output).toEqual({
      generatedAt: '2026-06-01T12:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: { apply: false, limit: 3, output: '/tmp/v4.json' },
      mode: 'dry-run',
      planned: 3,
    });
  });
});
