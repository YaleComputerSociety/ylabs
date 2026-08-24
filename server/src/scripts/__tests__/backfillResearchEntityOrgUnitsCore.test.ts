import { afterEach, describe, expect, it } from 'vitest';
import {
  buildOrgUnitResolverIndex,
  createOrgUnitCanonicalizer,
  resetOrgUnitCanonicalizerCache,
} from '../../scrapers/orgUnitCanonicalization';
import {
  planOrgUnitBackfillRow,
  summarizeOrgUnitBackfill,
  useOrgUnitCanonicalizerForBackfill,
} from '../backfillResearchEntityOrgUnitsCore';

const rows = [
  { slug: 'yale-school-of-medicine', name: 'Yale School of Medicine', kind: 'SCHOOL' as const, aliases: ['YSM'] },
  { slug: 'neuroscience', name: 'Neuroscience', kind: 'DEPARTMENT' as const, aliases: ['NSCI'] },
];
const deptToSchool = new Map([['Neuroscience', 'Yale School of Medicine']]);

function useCanonicalizer(): void {
  useOrgUnitCanonicalizerForBackfill(
    createOrgUnitCanonicalizer(buildOrgUnitResolverIndex(rows), deptToSchool),
  );
}

afterEach(() => {
  useOrgUnitCanonicalizerForBackfill(null);
  resetOrgUnitCanonicalizerCache();
});

describe('planOrgUnitBackfillRow', () => {
  it('drops administrative departments and rewrites canonical values', async () => {
    useCanonicalizer();
    const row = await planOrgUnitBackfillRow({
      id: 'a',
      school: 'YSM',
      departments: ['NSCI', 'PRV Provost Administration'],
      schools: [],
    });
    expect(row.changed).toBe(true);
    expect(row.update.school).toBe('Yale School of Medicine');
    expect(row.update.departments).toEqual(['Neuroscience']);
    expect(row.update.schools).toEqual(['Yale School of Medicine']);
    expect(row.droppedDepartments).toEqual(['PRV Provost Administration']);
  });

  it('reports no change when values are already canonical', async () => {
    useCanonicalizer();
    const row = await planOrgUnitBackfillRow({
      id: 'b',
      school: 'Yale School of Medicine',
      departments: ['Neuroscience'],
      schools: ['Yale School of Medicine'],
    });
    expect(row.changed).toBe(false);
    expect(row.update).toEqual({});
  });

  it('leaves departments empty for a professional-school entity with no department taxonomy instead of faking one (#1384)', async () => {
    const rowsWithLawSchool = [
      ...rows,
      { slug: 'law-school', name: 'Law School', kind: 'SCHOOL' as const },
    ];
    useOrgUnitCanonicalizerForBackfill(
      createOrgUnitCanonicalizer(buildOrgUnitResolverIndex(rowsWithLawSchool), deptToSchool),
    );
    const row = await planOrgUnitBackfillRow({
      id: 'c',
      slug: 'moyn-sam249',
      school: 'Law School',
      departments: [],
      schools: ['Law School'],
    });
    expect(row.changed).toBe(false);
    expect(row.update.departments).toBeUndefined();
  });

  it('clears a stale school-name-as-department value left by the retired #1316 fallback', async () => {
    const rowsWithLawSchool = [
      ...rows,
      { slug: 'law-school', name: 'Law School', kind: 'SCHOOL' as const },
    ];
    useOrgUnitCanonicalizerForBackfill(
      createOrgUnitCanonicalizer(buildOrgUnitResolverIndex(rowsWithLawSchool), deptToSchool),
    );
    const row = await planOrgUnitBackfillRow({
      id: 'd',
      slug: 'moyn-sam250',
      school: 'Law School',
      departments: ['Law School'],
      schools: ['Law School'],
    });
    expect(row.changed).toBe(true);
    expect(row.update.departments).toEqual([]);
    expect(row.droppedDepartments).toEqual(['Law School']);

    const rescan = await planOrgUnitBackfillRow({
      id: 'd',
      slug: 'moyn-sam250',
      school: row.afterSchool,
      departments: row.afterDepartments,
      schools: row.afterSchools,
    });
    expect(rescan.changed).toBe(false);
  });
});

describe('summarizeOrgUnitBackfill', () => {
  it('aggregates change counts', async () => {
    useCanonicalizer();
    const changed = await planOrgUnitBackfillRow({
      id: 'a',
      departments: ['NSCI', 'ADMINISTRATION'],
      schools: [],
    });
    const unchanged = await planOrgUnitBackfillRow({
      id: 'b',
      departments: ['Neuroscience'],
      schools: ['Yale School of Medicine'],
    });
    const summary = summarizeOrgUnitBackfill([changed, unchanged]);
    expect(summary.scanned).toBe(2);
    expect(summary.changed).toBe(1);
    expect(summary.departmentsDropped).toBe(1);
    expect(summary.departmentRewrites).toBe(1);
  });
});
