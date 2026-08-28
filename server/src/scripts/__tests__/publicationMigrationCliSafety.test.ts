import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../../data-migration/MigratePublicationsToPapers.ts');

async function importPublicationMigration() {
  const originalMongoUrl = process.env.MONGODBURL;
  process.env.MONGODBURL = '';
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
  }
}

describe('legacy publication migration CLI safety helpers', () => {
  it('imports without running the migration CLI path', async () => {
    const mod = await importPublicationMigration();

    expect(typeof mod.parsePublicationMigrationArgs).toBe('function');
  });

  it('defaults to dry-run and parses apply/live plus output flags', async () => {
    const { parsePublicationMigrationArgs } = await importPublicationMigration();

    expect(parsePublicationMigrationArgs([])).toEqual({
      apply: false,
      confirmLegacyPublicationMigration: false,
    });
    expect(
      parsePublicationMigrationArgs([
        '--live',
        '--confirm-legacy-publication-migration',
        '--limit=25',
        '--output=/tmp/publications.json',
      ]),
    ).toEqual({
      apply: true,
      confirmLegacyPublicationMigration: true,
      limit: 25,
      output: '/tmp/publications.json',
    });
    expect(parsePublicationMigrationArgs(['--apply', '--output', '/tmp/publications-apply.json'])).toEqual({
      apply: true,
      confirmLegacyPublicationMigration: false,
      output: '/tmp/publications-apply.json',
    });
    expect(parsePublicationMigrationArgs(['--live', '--dry-run'])).toEqual({
      apply: false,
      confirmLegacyPublicationMigration: false,
    });
    expect(() => parsePublicationMigrationArgs(['--limit=bad'])).toThrow(
      /--limit requires a positive integer/,
    );
    expect(() => parsePublicationMigrationArgs(['--output'])).toThrow(/--output requires a path/);
    expect(() => parsePublicationMigrationArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parsePublicationMigrationArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      parsePublicationMigrationArgs(['--confirm-legacy-publication-migration=true']),
    ).toThrow(/--confirm-legacy-publication-migration does not accept a value/);
    expect(() => parsePublicationMigrationArgs(['prod'])).toThrow(
      /Unknown legacy publication migration argument: prod/,
    );
  });

  it('blocks production applies before DB access', async () => {
    const { assertPublicationMigrationApplyAllowed } = await importPublicationMigration();

    expect(() =>
      assertPublicationMigrationApplyAllowed({
        apply: true,
        confirmLegacyPublicationMigration: true,
        limit: 5,
        mongoUrl: 'mongodb+srv://example.invalid/Production',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toThrow(/CONFIRM_PROD_SCRAPE=true/);

    expect(
      assertPublicationMigrationApplyAllowed({
        apply: false,
        mongoUrl: 'mongodb+srv://example.invalid/Production',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toMatchObject({ environment: 'production' });
  });

  it('requires a bounded limit before publication migration apply can run', async () => {
    const { assertPublicationMigrationApplyAllowed } = await importPublicationMigration();

    expect(() =>
      assertPublicationMigrationApplyAllowed({
        apply: true,
        mongoUrl: 'mongodb+srv://example.invalid/Beta',
        env: { SCRAPER_ENV: 'beta' },
      }),
    ).toThrow(/--limit is required/);
  });

  it('requires explicit confirmation before publication migration apply can run', async () => {
    const { assertPublicationMigrationApplyAllowed, parsePublicationMigrationArgs } =
      await importPublicationMigration();

    expect(parsePublicationMigrationArgs(['--apply', '--limit=5'])).toMatchObject({
      apply: true,
      confirmLegacyPublicationMigration: false,
      limit: 5,
    });

    expect(() =>
      assertPublicationMigrationApplyAllowed({
        apply: true,
        confirmLegacyPublicationMigration: false,
        limit: 5,
        mongoUrl: 'mongodb+srv://example.invalid/Beta',
        env: { SCRAPER_ENV: 'beta' },
      }),
    ).toThrow(/--confirm-legacy-publication-migration is required/);
  });

  it('wraps saved publication migration artifacts with target metadata and parsed options', async () => {
    const { buildPublicationMigrationOutput } = await importPublicationMigration();

    const output = buildPublicationMigrationOutput(
      {
        userCount: 12,
        embeddedPublicationCount: 40,
        uniquePaperCount: 30,
        insertedCount: 0,
        updatedCount: 0,
      },
      {
        generatedAt: '2026-06-02T12:00:00.000Z',
        environment: 'beta',
        db: 'Beta',
        options: { apply: false, output: '/tmp/publications.json' },
      },
    );

    expect(output).toEqual({
      generatedAt: '2026-06-02T12:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: { apply: false, output: '/tmp/publications.json' },
      userCount: 12,
      embeddedPublicationCount: 40,
      uniquePaperCount: 30,
      insertedCount: 0,
      updatedCount: 0,
    });
  });
});
