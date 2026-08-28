import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../../data-migration/MigrateDepartments.ts');

async function importDepartmentMigration() {
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

describe('legacy department migration CLI safety helpers', () => {
  it('imports without running the listings update CLI path', async () => {
    const mod = await importDepartmentMigration();

    expect(typeof mod.parseDepartmentMigrationArgs).toBe('function');
  });

  it('defaults to dry-run and parses apply/live plus output flags', async () => {
    const { parseDepartmentMigrationArgs } = await importDepartmentMigration();

    expect(parseDepartmentMigrationArgs([])).toEqual({
      apply: false,
      confirmLegacyDepartmentMigration: false,
    });
    expect(parseDepartmentMigrationArgs([
      '--live',
      '--confirm-legacy-department-migration',
      '--output=/tmp/departments.json',
    ])).toEqual({
      apply: true,
      confirmLegacyDepartmentMigration: true,
      output: '/tmp/departments.json',
    });
    expect(parseDepartmentMigrationArgs(['--apply', '--output', '/tmp/departments-apply.json'])).toEqual({
      apply: true,
      confirmLegacyDepartmentMigration: false,
      output: '/tmp/departments-apply.json',
    });
    expect(parseDepartmentMigrationArgs(['--live', '--dry-run'])).toEqual({
      apply: false,
      confirmLegacyDepartmentMigration: false,
    });
    expect(() => parseDepartmentMigrationArgs(['--output'])).toThrow(/--output requires a path/);
    expect(() => parseDepartmentMigrationArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseDepartmentMigrationArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseDepartmentMigrationArgs(['prod'])).toThrow(
      /Unknown legacy department migration argument: prod/,
    );
  });

  it('blocks production applies before DB access', async () => {
    const { assertDepartmentMigrationApplyAllowed } = await importDepartmentMigration();

    expect(() =>
      assertDepartmentMigrationApplyAllowed({
        apply: true,
        confirmLegacyDepartmentMigration: true,
        sourceMongoUrl: 'mongodb+srv://example.invalid/Source',
        mongoUrl: 'mongodb+srv://example.invalid/ProductionMigration',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toThrow(/CONFIRM_PROD_SCRAPE=true/);

    expect(
      assertDepartmentMigrationApplyAllowed({
        apply: false,
        mongoUrl: 'mongodb+srv://example.invalid/ProductionMigration',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toMatchObject({ environment: 'production' });
  });

  it('blocks apply when source and target URLs are identical', async () => {
    const { assertDepartmentMigrationApplyAllowed } = await importDepartmentMigration();

    expect(() =>
      assertDepartmentMigrationApplyAllowed({
        apply: true,
        confirmLegacyDepartmentMigration: true,
        sourceMongoUrl: 'mongodb+srv://example.invalid/ProductionMigration',
        mongoUrl: 'mongodb+srv://example.invalid/ProductionMigration',
        env: { SCRAPER_ENV: 'beta' },
      }),
    ).toThrow(/source and target Mongo URLs must be different/);
  });

  it('requires explicit confirmation before legacy department migration apply can run', async () => {
    const { assertDepartmentMigrationApplyAllowed, parseDepartmentMigrationArgs } =
      await importDepartmentMigration();

    expect(parseDepartmentMigrationArgs(['--apply', '--output=/tmp/departments.json'])).toMatchObject({
      apply: true,
      confirmLegacyDepartmentMigration: false,
    });

    expect(() =>
      assertDepartmentMigrationApplyAllowed({
        apply: true,
        confirmLegacyDepartmentMigration: false,
        sourceMongoUrl: 'mongodb+srv://example.invalid/Source',
        mongoUrl: 'mongodb+srv://example.invalid/Beta',
        env: { SCRAPER_ENV: 'beta' },
      }),
    ).toThrow(/--confirm-legacy-department-migration is required/);
  });

  it('wraps saved department migration artifacts with target metadata and parsed options', async () => {
    const { buildDepartmentMigrationOutput } = await importDepartmentMigration();

    const output = buildDepartmentMigrationOutput(
      {
        validDepartmentCount: 105,
        listingCount: 12,
        mappedChangeCount: 4,
        listingsToUpdate: 3,
        appliedUpdates: 0,
        unmappedDepartmentCount: 2,
      },
      {
        generatedAt: '2026-06-02T12:00:00.000Z',
        environment: 'beta',
        sourceDb: 'Production',
        targetDb: 'ProductionMigration',
        options: { apply: false, output: '/tmp/departments.json' },
      },
    );

    expect(output).toEqual({
      generatedAt: '2026-06-02T12:00:00.000Z',
      environment: 'beta',
      sourceDb: 'Production',
      targetDb: 'ProductionMigration',
      options: { apply: false, output: '/tmp/departments.json' },
      validDepartmentCount: 105,
      listingCount: 12,
      mappedChangeCount: 4,
      listingsToUpdate: 3,
      appliedUpdates: 0,
      unmappedDepartmentCount: 2,
    });
  });
});
