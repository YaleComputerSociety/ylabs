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
