import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../../data-migration/importFellowships.ts');

async function importFellowshipImporter() {
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

describe('fellowship import CLI safety helpers', () => {
  it('imports without running the destructive CLI path', async () => {
    const mod = await importFellowshipImporter();

    expect(typeof mod.parseFellowshipImportArgs).toBe('function');
  });

  it('parses dry-run/apply, replace, csv, and output flags', async () => {
    const { parseFellowshipImportArgs } = await importFellowshipImporter();

    expect(
      parseFellowshipImportArgs([
        '--apply',
        '--confirm-fellowship-import',
        '--replace-existing',
        '--csv',
        '/tmp/fellowships.csv',
        '--output=/tmp/fellowships.json',
      ]),
    ).toEqual({
      apply: true,
      confirmFellowshipImport: true,
      replaceExisting: true,
      csvPath: '/tmp/fellowships.csv',
      output: '/tmp/fellowships.json',
    });

    expect(parseFellowshipImportArgs(['--dry-run'])).toEqual({
      apply: false,
      confirmFellowshipImport: false,
      replaceExisting: false,
    });

    expect(() => parseFellowshipImportArgs(['--csv'])).toThrow(/--csv requires a path/);
    expect(() => parseFellowshipImportArgs(['--output'])).toThrow(/--output requires a path/);
    expect(() => parseFellowshipImportArgs(['--csv=--output'])).toThrow(
      /--csv requires a path/,
    );
    expect(() => parseFellowshipImportArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseFellowshipImportArgs(['--confirm-fellowship-import=true'])).toThrow(
      /--confirm-fellowship-import does not accept a value/,
    );
    expect(() => parseFellowshipImportArgs(['prod'])).toThrow(
      /Unknown fellowship import argument: prod/,
    );
  });

  it('transforms CSV rows without countries or raw HTML/script text', async () => {
    const { transformFellowshipRow } = await importFellowshipImporter();

    const transformed = transformFellowshipRow({
      title: '  Summer Research Fellowship  ',
      summary: 'Short summary',
      shareable_link: 'https://example.yale.edu/apply',
      can_apply: '1',
      full_description: '<p>Study archives&nbsp;&amp; data.</p><script>alert(1)</script>',
      eligibility: 'First-years may apply',
      contact_email: '//fellowships@yale.edu',
      'listing_Begin Accepting Applications Date': '2026-01-01',
      'listing_Deadline Date (EST Time Zone)': '2026-02-01',
      'filter_Current Year of Study': 'First-year; Sophomore',
      'filter_Term of Award': 'Summer',
      'filter_Grant or Fellowship Purpose': 'Research; Travel',
      'filter_Global Region or Country': 'Africa; France; Europe',
      'filter_Citizenship Status': 'U.S. Citizen; International',
    });

    expect(transformed).toMatchObject({
      title: 'Summer Research Fellowship',
      description: 'Study archives & data.',
      applicationLink: 'https://example.yale.edu/apply',
      isAcceptingApplications: true,
      contactEmail: 'fellowships@yale.edu',
      yearOfStudy: ['First-year', 'Sophomore'],
      globalRegions: ['Africa', 'Europe'],
    });
  });

  it('wraps saved fellowship import artifacts with target metadata and parsed options', async () => {
    const { buildFellowshipImportOutput } = await importFellowshipImporter();

    const output = buildFellowshipImportOutput(
      {
        csvPath: '/tmp/fellowships.csv',
        rowCount: 12,
        validCount: 10,
        existingCount: 5,
        deletedCount: 0,
        insertedCount: 0,
      },
      {
        generatedAt: '2026-06-01T12:00:00.000Z',
        environment: 'beta',
        db: 'Beta',
        options: {
          apply: false,
          replaceExisting: false,
          csvPath: '/tmp/fellowships.csv',
          output: '/tmp/fellowships.json',
        },
      },
    );

    expect(output).toEqual({
      generatedAt: '2026-06-01T12:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: {
        apply: false,
        replaceExisting: false,
        csvPath: '/tmp/fellowships.csv',
        output: '/tmp/fellowships.json',
      },
      csvPath: '/tmp/fellowships.csv',
      rowCount: 12,
      validCount: 10,
      existingCount: 5,
      deletedCount: 0,
      insertedCount: 0,
    });
  });

  it('blocks production applies before DB access', async () => {
    const { assertFellowshipImportApplyAllowed } = await importFellowshipImporter();

    expect(() =>
      assertFellowshipImportApplyAllowed({
        apply: true,
        confirmFellowshipImport: true,
        csvPath: '/tmp/fellowships.csv',
        mongoUrl: 'mongodb+srv://example.invalid/Production',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toThrow(/CONFIRM_PROD_SCRAPE=true/);

    expect(
      assertFellowshipImportApplyAllowed({
        apply: false,
        mongoUrl: 'mongodb+srv://example.invalid/Production',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toMatchObject({ environment: 'production' });
  });

  it('requires an explicit CSV path before fellowship import apply can run', async () => {
    const { assertFellowshipImportApplyAllowed } = await importFellowshipImporter();

    expect(() =>
      assertFellowshipImportApplyAllowed({
        apply: true,
        mongoUrl: 'mongodb+srv://example.invalid/Beta',
        env: { SCRAPER_ENV: 'beta' },
      }),
    ).toThrow(/--csv is required/);
  });

  it('requires explicit confirmation before fellowship import apply can run', async () => {
    const { assertFellowshipImportApplyAllowed, parseFellowshipImportArgs } =
      await importFellowshipImporter();

    expect(
      parseFellowshipImportArgs(['--apply', '--csv=/tmp/fellowships.csv']),
    ).toMatchObject({
      apply: true,
      confirmFellowshipImport: false,
      csvPath: '/tmp/fellowships.csv',
    });

    expect(() =>
      assertFellowshipImportApplyAllowed({
        apply: true,
        confirmFellowshipImport: false,
        csvPath: '/tmp/fellowships.csv',
        mongoUrl: 'mongodb+srv://example.invalid/Beta',
        env: { SCRAPER_ENV: 'beta' },
      }),
    ).toThrow(/--confirm-fellowship-import is required/);
  });
});
