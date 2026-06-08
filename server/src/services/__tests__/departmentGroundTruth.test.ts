import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DepartmentCategory,
  DepartmentCodeSystem,
  buildDepartmentGroundTruth,
  buildResolverKeys,
  departmentSourceUrls,
  diffDepartmentRows,
  normalizeDepartmentKey,
  parseYcpsSubjectAbbreviations,
  parseYsmAcronyms,
  parseYsmDepartments,
  validateDepartmentRows,
} from '../../../../data-migration/departmentGroundTruth';
import {
  assertDepartmentSeedApplyAllowed,
  buildDepartmentSeedOutput,
  classifyUnresolvedDepartmentString,
  parseDepartmentSeedArgs,
} from '../../../../data-migration/seedDepartments';
import {
  assertResearchAreaSeedApplyAllowed,
  buildResearchAreaSeedOutput,
  buildResearchAreaSeedRows,
  parseResearchAreaSeedArgs,
} from '../../../../data-migration/seedResearchAreas';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

const fixtureByUrl = new Map<string, string>([
  [departmentSourceUrls.ycpsSubjectAbbreviations, fixture('ycps-subject-abbreviations.html')],
  [departmentSourceUrls.ysmDepartments, fixture('ysm-departments.html')],
  [departmentSourceUrls.ysmAcronyms, fixture('ysm-acronyms.html')],
]);

describe('department ground truth', () => {
  it('parses Yale College subject abbreviation rows', () => {
    const rows = parseYcpsSubjectAbbreviations(fixture('ycps-subject-abbreviations.html'));

    expect(rows).toContainEqual({ code: 'CPSC', name: 'Computer Science' });
    expect(rows).toContainEqual({ code: 'S&DS', name: 'Statistics and Data Science' });
    expect(rows).toContainEqual({ code: 'TDPS', name: 'Theater, Dance, and Performance Studies' });
  });

  it('parses YSM department labels and medical-school acronyms', () => {
    expect(parseYsmDepartments(fixture('ysm-departments.html'))).toEqual([
      'Anesthesiology',
      'Biomedical Informatics & Data Science',
      'Radiology & Biomedical Imaging',
      'Therapeutic Radiology',
    ]);

    expect(parseYsmAcronyms(fixture('ysm-acronyms.html'))).toContainEqual({
      code: 'YSPH',
      expansion: 'Yale School of Public Health, also EPH',
      aliases: ['Yale School of Public Health', 'EPH'],
    });
  });

  it('builds a curated taxonomy with aliases and source provenance', async () => {
    const result = await buildDepartmentGroundTruth(async (url) => ({
      text: async () => fixtureByUrl.get(url) || '',
    }));

    expect(validateDepartmentRows(result.departments)).toEqual([]);

    const computerScience = result.departments.find((row) => row.abbreviation === 'CPSC');
    expect(computerScience?.codeSystem).toBe(DepartmentCodeSystem.YCPS_SUBJECT);
    expect(computerScience?.sourceRecords).toContainEqual(
      expect.objectContaining({
        sourceKey: 'ycpsSubjectAbbreviations',
        matchedCode: 'CPSC',
        matchedName: 'Computer Science',
      }),
    );

    const publicHealth = result.departments.find((row) => row.abbreviation === 'EPH');
    expect(publicHealth?.codeSystem).toBe(DepartmentCodeSystem.YSM_ACRONYM);
    expect(publicHealth?.aliases).toEqual(expect.arrayContaining(['YSPH', 'Yale School of Public Health']));

    const publicHealthAliasKeys = new Set(publicHealth?.aliases.map(normalizeDepartmentKey));
    expect(publicHealthAliasKeys.size).toBe(publicHealth?.aliases.length);

    const resolverKeys = buildResolverKeys(result.departments);
    expect(resolverKeys.has(normalizeDepartmentKey('YSPH'))).toBe(true);
    expect(resolverKeys.has(normalizeDepartmentKey('CPSC - Computer Science'))).toBe(true);
    expect(resolverKeys.has(normalizeDepartmentKey('AFAM - Black Studies'))).toBe(true);
    expect(resolverKeys.has(normalizeDepartmentKey('CEE - Chemical & Environmental Engineering'))).toBe(true);
    expect(resolverKeys.has(normalizeDepartmentKey('SPAN/PORT - Spanish & Portuguese'))).toBe(true);
  });

  it('fails loudly when an official source parser returns no rows', async () => {
    await expect(
      buildDepartmentGroundTruth(async () => ({
        text: async () => '',
      })),
    ).rejects.toThrow(/YCPS subject abbreviation parser returned zero rows/);
  });

  it('validates duplicate abbreviations, alias normalization, categories, display names, and provenance', async () => {
    const result = await buildDepartmentGroundTruth(async (url) => ({
      text: async () => fixtureByUrl.get(url) || '',
    }));
    const computerScience = result.departments.find((row) => row.abbreviation === 'CPSC');
    expect(computerScience).toBeDefined();

    const duplicate = {
      ...computerScience!,
      name: 'Computer Science Duplicate',
      displayName: 'CPSC - Computer Science Duplicate',
    };
    const invalid = {
      ...computerScience!,
      abbreviation: 'BAD',
      name: 'Bad Department',
      displayName: 'Wrong Display',
      categories: ['Invented Category'] as unknown as DepartmentCategory[],
      primaryCategory: 'Invented Category' as DepartmentCategory,
      aliases: ['Repeated Alias', 'Repeated   Alias'],
      sourceRecords: [],
    };

    const errors = validateDepartmentRows([computerScience!, duplicate, invalid]);
    expect(errors).toEqual(
      expect.arrayContaining([
        'CPSC: duplicate abbreviation also used by Computer Science',
        'BAD: displayName must be "BAD - Bad Department"',
        'BAD: invalid category "Invented Category"',
        'BAD: invalid primaryCategory "Invented Category"',
        'BAD: missing sourceRecords',
        'BAD: duplicate alias "Repeated   Alias" also represented by "Repeated Alias"',
      ]),
    );
  });

  it('diffs creates, updates, deactivations, and unchanged rows', async () => {
    const result = await buildDepartmentGroundTruth(async (url) => ({
      text: async () => fixtureByUrl.get(url) || '',
    }));
    const [target] = result.departments;
    const changed = { ...target, name: 'Old Name' };
    const stale = { abbreviation: 'OLD', displayName: 'OLD - Old Department', isActive: true };

    const diff = diffDepartmentRows([changed, stale], [target]);

    expect(diff.creates).toEqual([]);
    expect(diff.updates).toHaveLength(1);
    expect(diff.deactivates).toEqual([stale]);
    expect(diff.unchanged).toEqual([]);

    const noOp = diffDepartmentRows([target], [target]);
    expect(noOp.creates).toEqual([]);
    expect(noOp.updates).toEqual([]);
    expect(noOp.deactivates).toEqual([]);
    expect(noOp.unchanged).toEqual([target]);
  });
});

describe('department seed CLI helpers', () => {
  it('parses apply and output flags without touching Mongo', () => {
    expect(parseDepartmentSeedArgs(['--apply', '--output', '/tmp/departments.json'])).toEqual({
      apply: true,
      output: '/tmp/departments.json',
    });

    expect(parseDepartmentSeedArgs(['--live', '--output=/tmp/departments-live.json'])).toEqual({
      apply: true,
      output: '/tmp/departments-live.json',
    });

    expect(() => parseDepartmentSeedArgs(['--output'])).toThrow(/--output requires a path/);
    expect(() => parseDepartmentSeedArgs(['prod'])).toThrow(/Unknown department seed argument: prod/);
  });

  it('wraps saved seed artifacts with target metadata and parsed options', () => {
    const output = buildDepartmentSeedOutput(
      {
        sourceCounts: { ycpsSubjects: 126, ysmDepartments: 30, ysmAcronyms: 162 },
        diffSummary: { creates: 0, updates: 1, deactivates: 0, unchanged: 125 },
      },
      {
        generatedAt: '2026-06-01T12:00:00.000Z',
        environment: 'beta',
        db: 'Beta',
        options: { apply: false, output: '/tmp/departments.json' },
      },
    );

    expect(output).toEqual({
      generatedAt: '2026-06-01T12:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: { apply: false, output: '/tmp/departments.json' },
      sourceCounts: { ycpsSubjects: 126, ysmDepartments: 30, ysmAcronyms: 162 },
      diffSummary: { creates: 0, updates: 1, deactivates: 0, unchanged: 125 },
    });
  });

  it('blocks production apply without explicit scraper confirmation before DB access', () => {
    expect(() =>
      assertDepartmentSeedApplyAllowed({
        apply: true,
        mongoUrl: 'mongodb+srv://example.invalid/Production',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toThrow(/--confirm-seed-apply is required/);

    expect(() =>
      assertDepartmentSeedApplyAllowed({
        apply: true,
        confirmSeedApply: true,
        mongoUrl: 'mongodb+srv://example.invalid/Production',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toThrow(/CONFIRM_PROD_SCRAPE=true/);

    expect(
      assertDepartmentSeedApplyAllowed({
        apply: false,
        mongoUrl: 'mongodb+srv://example.invalid/Production',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toMatchObject({ environment: 'production' });
  });

  it('classifies unresolved department strings for follow-up cleanup', () => {
    expect(
      classifyUnresolvedDepartmentString('users.major', 'Computer Science & Economics'),
    ).toBe('student_major');
    expect(
      classifyUnresolvedDepartmentString('research_entities.departments', 'EASCPS Computer Science'),
    ).toBe('legacy_unit_coded_department');
    expect(
      classifyUnresolvedDepartmentString('research_entities.departments', 'FASERM Ethnicity, Race & Migration'),
    ).toBe('legacy_unit_coded_department');
    expect(
      classifyUnresolvedDepartmentString('users.primaryDepartment', "EASCEN SEAS Dean's Office"),
    ).toBe('administrative_unit');
    expect(
      classifyUnresolvedDepartmentString('users.primaryDepartment', 'ATHSAR Payne Whitney Gym'),
    ).toBe('administrative_unit');
    expect(
      classifyUnresolvedDepartmentString('users.departments', 'Center for Gastrointestinal Cancers'),
    ).toBe('research_center_or_program');
    expect(
      classifyUnresolvedDepartmentString('users.departments', 'Global Health Studies'),
    ).toBe('research_center_or_program');
    expect(
      classifyUnresolvedDepartmentString('research_entities.departments', 'Cardiovascular Medicine'),
    ).toBe('medical_specialty_or_subdepartment');
    expect(
      classifyUnresolvedDepartmentString('research_entities.departments', 'Endocrinology'),
    ).toBe('medical_specialty_or_subdepartment');
    expect(
      classifyUnresolvedDepartmentString('research_entities.departments', 'Pediatric Nephrology'),
    ).toBe('medical_specialty_or_subdepartment');
    expect(
      classifyUnresolvedDepartmentString('research_entities.departments', 'MICROBIOLOGY/IMMUN/VIROLOGY'),
    ).toBe('medical_specialty_or_subdepartment');
    expect(
      classifyUnresolvedDepartmentString('users.primaryDepartment', 'PRVADM Provost Admin'),
    ).toBe('administrative_unit');
    expect(
      classifyUnresolvedDepartmentString('users.primaryDepartment', 'YCORTC Air Force ROTC'),
    ).toBe('administrative_unit');
    expect(
      classifyUnresolvedDepartmentString('users.primaryDepartment', 'RESSCI Inst for Foundations of Data Science'),
    ).toBe('research_center_or_program');
    expect(
      classifyUnresolvedDepartmentString('users.primaryDepartment', 'PRVAIT The Papers of Benjamin Franklin'),
    ).toBe('research_center_or_program');
    expect(
      classifyUnresolvedDepartmentString('users.primaryDepartment', 'YCOYCP Yale Sustainable Food'),
    ).toBe('research_center_or_program');
    expect(
      classifyUnresolvedDepartmentString('users.primaryDepartment', 'MEDKEC Keck Biotechnology Services'),
    ).toBe('research_center_or_program');
    expect(
      classifyUnresolvedDepartmentString('research_entities.departments', 'Rheumatology, Allergy, & Immunology'),
    ).toBe('medical_specialty_or_subdepartment');
    expect(
      classifyUnresolvedDepartmentString('users.primaryDepartment', 'YHPPRI Pediatrics'),
    ).toBe('medical_specialty_or_subdepartment');
    expect(
      classifyUnresolvedDepartmentString('research_entities.departments', 'DIV - Divnity'),
    ).toBe('administrative_unit');
    expect(
      classifyUnresolvedDepartmentString('research_entities.departments', 'Science and Quantitative Reasoning Education'),
    ).toBe('administrative_unit');
    expect(
      classifyUnresolvedDepartmentString('users.primaryDepartment', 'EEICTL Learning to Teach'),
    ).toBe('administrative_unit');
    expect(
      classifyUnresolvedDepartmentString('research_entities.departments', 'VETERINARY SCIENCES'),
    ).toBe('medical_specialty_or_subdepartment');
  });
});

describe('research area seed CLI helpers', () => {
  it('parses dry-run/apply and output flags without touching Mongo', () => {
    expect(parseResearchAreaSeedArgs(['--apply', '--output', '/tmp/research-areas.json'])).toEqual({
      apply: true,
      output: '/tmp/research-areas.json',
    });

    expect(parseResearchAreaSeedArgs(['--dry-run', '--output=/tmp/research-areas-dry.json'])).toEqual({
      apply: false,
      output: '/tmp/research-areas-dry.json',
    });

    expect(() => parseResearchAreaSeedArgs(['--output'])).toThrow(/--output requires a path/);
    expect(() => parseResearchAreaSeedArgs(['both'])).toThrow(/Unknown research-area seed argument: both/);
  });

  it('builds default research area seed rows with color keys', () => {
    const rows = buildResearchAreaSeedRows();

    expect(rows.length).toBeGreaterThan(100);
    expect(rows).toContainEqual(
      expect.objectContaining({
        name: 'Artificial Intelligence',
        field: 'Computing & Artificial Intelligence',
        colorKey: 'blue',
        isDefault: true,
        addedBy: null,
      }),
    );
  });

  it('wraps saved research-area seed artifacts with target metadata and parsed options', () => {
    const output = buildResearchAreaSeedOutput(
      {
        plannedCount: 640,
        existingDefaultCount: 700,
        diffSummary: { creates: 0, matches: 640, upserts: 0, totalAfter: 700 },
      },
      {
        generatedAt: '2026-06-01T12:00:00.000Z',
        environment: 'beta',
        db: 'Beta',
        options: { apply: false, output: '/tmp/research-areas.json' },
      },
    );

    expect(output).toEqual({
      generatedAt: '2026-06-01T12:00:00.000Z',
      environment: 'beta',
      db: 'Beta',
      options: { apply: false, output: '/tmp/research-areas.json' },
      plannedCount: 640,
      existingDefaultCount: 700,
      diffSummary: { creates: 0, matches: 640, upserts: 0, totalAfter: 700 },
    });
  });

  it('blocks production apply without explicit scraper confirmation before DB access', () => {
    expect(() =>
      assertResearchAreaSeedApplyAllowed({
        apply: true,
        mongoUrl: 'mongodb+srv://example.invalid/Production',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toThrow(/--confirm-seed-apply is required/);

    expect(() =>
      assertResearchAreaSeedApplyAllowed({
        apply: true,
        confirmSeedApply: true,
        mongoUrl: 'mongodb+srv://example.invalid/Production',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toThrow(/CONFIRM_PROD_SCRAPE=true/);

    expect(
      assertResearchAreaSeedApplyAllowed({
        apply: false,
        mongoUrl: 'mongodb+srv://example.invalid/Production',
        env: { SCRAPER_ENV: 'production' },
      }),
    ).toMatchObject({ environment: 'production' });
  });
});
