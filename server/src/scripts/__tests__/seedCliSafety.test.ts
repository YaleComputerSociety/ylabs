import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertSeedSourcesWriteAllowed, parseSeedSourcesArgs } from '../../scrapers/seedSources';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const departmentSeedPath = path.resolve(__dirname, '../../../../data-migration/seedDepartments.ts');
const researchAreaSeedPath = path.resolve(
  __dirname,
  '../../../../data-migration/seedResearchAreas.ts',
);

async function importDepartmentSeed() {
  return import(pathToFileURL(departmentSeedPath).href);
}

async function importResearchAreaSeed() {
  return import(pathToFileURL(researchAreaSeedPath).href);
}

describe('data migration seed CLI safety helpers', () => {
  it('rejects malformed source seed output paths before DB access', () => {
    expect(parseSeedSourcesArgs([])).toEqual({
      apply: false,
      confirmSeedApply: false,
      reset: false,
    });
    expect(parseSeedSourcesArgs(['--dry-run', '--output=/tmp/sources.json'])).toEqual({
      apply: false,
      confirmSeedApply: false,
      reset: false,
      output: '/tmp/sources.json',
    });
    expect(
      parseSeedSourcesArgs([
        '--apply',
        '--confirm-seed-apply',
        '--output=/tmp/sources-apply.json',
      ]),
    ).toEqual({
      apply: true,
      confirmSeedApply: true,
      reset: false,
      output: '/tmp/sources-apply.json',
    });
    expect(() => parseSeedSourcesArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseSeedSourcesArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseSeedSourcesArgs(['--output=/etc/sources.json'])).toThrow(
      /--output must write under/,
    );
    expect(() => parseSeedSourcesArgs(['--output=/tmp/sources.txt'])).toThrow(
      /--output must point to a \.json report file/,
    );
    expect(() =>
      assertSeedSourcesWriteAllowed(
        { apply: true, confirmSeedApply: false },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Beta',
      ),
    ).toThrow(/--confirm-seed-apply is required/);
    expect(() =>
      assertSeedSourcesWriteAllowed(
        { apply: true, confirmSeedApply: true },
        { SCRAPER_ENV: 'beta' } as NodeJS.ProcessEnv,
        'mongodb://example.invalid/Beta',
      ),
    ).not.toThrow();
  });

  it('rejects malformed department seed output paths before DB access', async () => {
    const { assertDepartmentSeedApplyAllowed, parseDepartmentSeedArgs } =
      await importDepartmentSeed();

    expect(parseDepartmentSeedArgs(['--apply', '--confirm-seed-apply', '--output=/tmp/departments.json'])).toEqual({
      apply: true,
      confirmSeedApply: true,
      output: '/tmp/departments.json',
    });
    expect(() => parseDepartmentSeedArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseDepartmentSeedArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      assertDepartmentSeedApplyAllowed({
        apply: true,
        env: { SCRAPER_ENV: 'beta' },
        mongoUrl: 'mongodb://example.invalid/Beta',
      }),
    ).toThrow(/--confirm-seed-apply is required/);
    expect(() =>
      assertDepartmentSeedApplyAllowed({
        apply: true,
        confirmSeedApply: true,
        env: { SCRAPER_ENV: 'beta' },
        mongoUrl: 'mongodb://example.invalid/Beta',
      }),
    ).not.toThrow();
  });

  it('rejects malformed research-area seed output paths before DB access', async () => {
    const { assertResearchAreaSeedApplyAllowed, parseResearchAreaSeedArgs } =
      await importResearchAreaSeed();

    expect(parseResearchAreaSeedArgs(['--apply', '--confirm-seed-apply', '--output=/tmp/research-areas.json'])).toEqual({
      apply: true,
      confirmSeedApply: true,
      output: '/tmp/research-areas.json',
    });
    expect(() => parseResearchAreaSeedArgs(['--output', '--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() => parseResearchAreaSeedArgs(['--output=--apply'])).toThrow(
      /--output requires a path/,
    );
    expect(() =>
      assertResearchAreaSeedApplyAllowed({
        apply: true,
        env: { SCRAPER_ENV: 'beta' },
        mongoUrl: 'mongodb://example.invalid/Beta',
      }),
    ).toThrow(/--confirm-seed-apply is required/);
    expect(() =>
      assertResearchAreaSeedApplyAllowed({
        apply: true,
        confirmSeedApply: true,
        env: { SCRAPER_ENV: 'beta' },
        mongoUrl: 'mongodb://example.invalid/Beta',
      }),
    ).not.toThrow();
  });
});
