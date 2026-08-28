import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../../data-migration/ImportRootDataFiles.ts');

async function importRootDataImporter(argv: string[] = []) {
  const originalMongoUrl = process.env.MONGODBURL;
  const originalArgv = process.argv;
  process.env.MONGODBURL = '';
  process.argv = ['node', originalArgv[1] || 'vitest', ...argv];
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ''}`);
  }) as never);

  try {
    return await import(`${pathToFileURL(modulePath).href}?case=${Date.now()}-${Math.random().toString(36).slice(2)}`);
  } finally {
    exitSpy.mockRestore();
    process.argv = originalArgv;
    if (originalMongoUrl === undefined) {
      delete process.env.MONGODBURL;
    } else {
      process.env.MONGODBURL = originalMongoUrl;
    }
  }
}

describe('legacy root data import CLI safety helpers', () => {
  it('imports without running the import CLI path', async () => {
    const mod = await importRootDataImporter(['prod']);

    expect(typeof mod.importRootDataFiles).toBe('function');
  });

  it('defaults to dry-run and parses apply, delete-source-files, limit, and output flags', async () => {
    const { parseRootDataImportArgs } = await importRootDataImporter();

    expect(parseRootDataImportArgs([])).toEqual({
      apply: false,
      confirmLegacyRootDataImport: false,
      deleteSourceFiles: false,
    });
    expect(
      parseRootDataImportArgs([
        '--apply',
        '--confirm-legacy-root-data-import',
        '--delete-source-files',
        '--limit',
        '5',
        '--output=/tmp/root-import.json',
      ]),
    ).toEqual({
      apply: true,
      confirmLegacyRootDataImport: true,
      deleteSourceFiles: true,
      limit: 5,
      output: '/tmp/root-import.json',
    });
    expect(() => parseRootDataImportArgs(['--limit=bad'])).toThrow(/--limit requires a positive integer/);
    expect(() => parseRootDataImportArgs(['--output'])).toThrow(/--output requires a path/);
    expect(() => parseRootDataImportArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseRootDataImportArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseRootDataImportArgs(['--confirm-legacy-root-data-import=true'])).toThrow(
      /--confirm-legacy-root-data-import does not accept a value/,
    );
    expect(() => parseRootDataImportArgs(['prod'])).toThrow(
      /Unknown legacy root data import argument: prod/,
    );
  });

  it('blocks production applies before DB access', async () => {
    const { assertRootDataImportApplyAllowed } = await importRootDataImporter();

    expect(() =>
      assertRootDataImportApplyAllowed({
        apply: true,
        confirmLegacyRootDataImport: true,
        limit: 5,
        mongoUrl: 'mongodb+srv://example.invalid/Production',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toThrow(/CONFIRM_PROD_SCRAPE=true/);

    expect(
      assertRootDataImportApplyAllowed({
        apply: false,
        mongoUrl: 'mongodb+srv://example.invalid/Production',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toMatchObject({ environment: 'production' });
  });

  it('requires a bounded limit before root data import apply can run', async () => {
    const { assertRootDataImportApplyAllowed } = await importRootDataImporter();

    expect(() =>
      assertRootDataImportApplyAllowed({
        apply: true,
        mongoUrl: 'mongodb+srv://example.invalid/Beta',
        env: { SCRAPER_ENV: 'beta' },
      }),
    ).toThrow(/--limit is required/);
  });

  it('requires explicit confirmation before root data import apply can run', async () => {
    const { assertRootDataImportApplyAllowed, parseRootDataImportArgs } =
      await importRootDataImporter();

    expect(parseRootDataImportArgs(['--apply', '--limit=5'])).toMatchObject({
      apply: true,
      confirmLegacyRootDataImport: false,
      limit: 5,
    });

    expect(() =>
      assertRootDataImportApplyAllowed({
        apply: true,
        confirmLegacyRootDataImport: false,
        limit: 5,
        mongoUrl: 'mongodb+srv://example.invalid/Beta',
        env: { SCRAPER_ENV: 'beta' },
      }),
    ).toThrow(/--confirm-legacy-root-data-import is required/);
  });

  it('wraps saved root import artifacts with target metadata and parsed options', async () => {
    const { buildRootDataImportOutput } = await importRootDataImporter();

    const output = buildRootDataImportOutput(
      {
        physicsRows: 2,
        historyRows: 3,
        medicineRows: 4,
        csvRows: 0,
        verification: { physicsFaculty: 2, historyFaculty: 3, medicineLabs: 4, passed: true },
      },
      {
        generatedAt: '2026-06-02T12:00:00.000Z',
        environment: 'beta',
        db: 'Beta',
        options: { apply: false, deleteSourceFiles: false, limit: 4, output: '/tmp/root-import.json' },
      },
    );

    expect(output).toEqual({
      generatedAt: '2026-06-02T12:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: { apply: false, deleteSourceFiles: false, limit: 4, output: '/tmp/root-import.json' },
      physicsRows: 2,
      historyRows: 3,
      medicineRows: 4,
      csvRows: 0,
      verification: { physicsFaculty: 2, historyFaculty: 3, medicineLabs: 4, passed: true },
    });
  });
});
