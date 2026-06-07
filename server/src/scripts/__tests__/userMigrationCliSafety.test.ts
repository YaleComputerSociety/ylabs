import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../../data-migration/MigrateUsers.ts');

async function importUserMigration() {
  const originalMongoUrl = process.env.MONGODBURL;
  const originalTargetUrl = process.env.MONGODBURL_MIGRATION;
  process.env.MONGODBURL = '';
  process.env.MONGODBURL_MIGRATION = '';
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ''}`);
  }) as never);

  try {
    return await import(pathToFileURL(modulePath).href);
  } finally {
    exitSpy.mockRestore();
    if (originalMongoUrl === undefined) {
      delete process.env.MONGODBURL;
    } else {
      process.env.MONGODBURL = originalMongoUrl;
    }
    if (originalTargetUrl === undefined) {
      delete process.env.MONGODBURL_MIGRATION;
    } else {
      process.env.MONGODBURL_MIGRATION = originalTargetUrl;
    }
  }
}

describe('legacy user migration CLI safety helpers', () => {
  it('imports without running the copy/delete CLI path', async () => {
    const mod = await importUserMigration();

    expect(typeof mod.parseUserMigrationArgs).toBe('function');
  });

  it('defaults to dry-run and parses apply, replace-existing, and output flags', async () => {
    const { parseUserMigrationArgs } = await importUserMigration();

    expect(parseUserMigrationArgs([])).toEqual({
      apply: false,
      confirmLegacyUserMigration: false,
      replaceExisting: false,
    });
    expect(
      parseUserMigrationArgs([
        '--apply',
        '--confirm-legacy-user-migration',
        '--replace-existing',
        '--output=/tmp/users-copy.json',
      ]),
    ).toEqual({
      apply: true,
      confirmLegacyUserMigration: true,
      replaceExisting: true,
      output: '/tmp/users-copy.json',
    });
    expect(parseUserMigrationArgs(['--live', '--output', '/tmp/users-live.json'])).toEqual({
      apply: true,
      confirmLegacyUserMigration: false,
      replaceExisting: false,
      output: '/tmp/users-live.json',
    });
    expect(() => parseUserMigrationArgs(['--output'])).toThrow(/--output requires a path/);
    expect(() => parseUserMigrationArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseUserMigrationArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseUserMigrationArgs(['prod'])).toThrow(
      /Unknown legacy user migration argument: prod/,
    );
  });

  it('blocks production applies before DB access', async () => {
    const { assertUserMigrationApplyAllowed } = await importUserMigration();

    expect(() =>
      assertUserMigrationApplyAllowed({
        apply: true,
        confirmLegacyUserMigration: true,
        sourceMongoUrl: 'mongodb+srv://example.invalid/Source',
        mongoUrl: 'mongodb+srv://example.invalid/Production',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toThrow(/CONFIRM_PROD_SCRAPE=true/);

    expect(
      assertUserMigrationApplyAllowed({
        apply: false,
        mongoUrl: 'mongodb+srv://example.invalid/Production',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toMatchObject({ environment: 'production' });
  });

  it('blocks apply when source and target URLs are identical', async () => {
    const { assertUserMigrationApplyAllowed } = await importUserMigration();

    expect(() =>
      assertUserMigrationApplyAllowed({
        apply: true,
        confirmLegacyUserMigration: true,
        sourceMongoUrl: 'mongodb+srv://example.invalid/ProductionMigration',
        mongoUrl: 'mongodb+srv://example.invalid/ProductionMigration',
        env: { SCRAPER_ENV: 'beta' },
      }),
    ).toThrow(/source and target Mongo URLs must be different/);
  });

  it('requires explicit confirmation before legacy user migration apply can run', async () => {
    const { assertUserMigrationApplyAllowed, parseUserMigrationArgs } = await importUserMigration();

    expect(parseUserMigrationArgs(['--apply', '--output=/tmp/users-copy.json'])).toMatchObject({
      apply: true,
      confirmLegacyUserMigration: false,
    });

    expect(() =>
      assertUserMigrationApplyAllowed({
        apply: true,
        confirmLegacyUserMigration: false,
        sourceMongoUrl: 'mongodb+srv://example.invalid/Source',
        mongoUrl: 'mongodb+srv://example.invalid/Beta',
        env: { SCRAPER_ENV: 'beta' },
      }),
    ).toThrow(/--confirm-legacy-user-migration is required/);
  });

  it('requires explicit replacement when apply would clear target users', async () => {
    const { assertUserMigrationReplacementAllowed } = await importUserMigration();

    expect(() =>
      assertUserMigrationReplacementAllowed({
        apply: true,
        replaceExisting: false,
        existingTargetCount: 3,
      }),
    ).toThrow(/--replace-existing/);

    expect(() =>
      assertUserMigrationReplacementAllowed({
        apply: true,
        replaceExisting: true,
        existingTargetCount: 3,
      }),
    ).not.toThrow();

    expect(() =>
      assertUserMigrationReplacementAllowed({
        apply: false,
        replaceExisting: false,
        existingTargetCount: 3,
      }),
    ).not.toThrow();
  });

  it('wraps saved user migration artifacts with target metadata and parsed options', async () => {
    const { buildUserMigrationOutput } = await importUserMigration();

    const output = buildUserMigrationOutput(
      {
        sourceCount: 12,
        existingTargetCount: 4,
        deletedCount: 0,
        insertedCount: 0,
        finalTargetCount: 4,
      },
      {
        generatedAt: '2026-06-02T12:00:00.000Z',
        environment: 'beta',
        sourceDb: 'Production',
        targetDb: 'ProductionMigration',
        options: { apply: false, replaceExisting: false, output: '/tmp/users-copy.json' },
      },
    );

    expect(output).toEqual({
      generatedAt: '2026-06-02T12:00:00.000Z',
      environment: 'beta',
      sourceDb: 'Production',
      targetDb: 'ProductionMigration',
      options: { apply: false, replaceExisting: false, output: '/tmp/users-copy.json' },
      sourceCount: 12,
      existingTargetCount: 4,
      deletedCount: 0,
      insertedCount: 0,
      finalTargetCount: 4,
    });
  });
});
