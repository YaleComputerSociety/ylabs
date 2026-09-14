import { describe, expect, it } from 'vitest';
import {
  DEPARTMENT_DISPLAY_ADDITIONS,
  planDepartmentDisplayAlignment,
  summarizeDepartmentDisplayPlan,
  type DepartmentDisplayRow,
} from '../alignDepartmentDisplayCatalogCore';
import { DepartmentCategory } from '../../models/department';

/** The Development rows the alignment has to handle, one per interesting shape. */
const table: DepartmentDisplayRow[] = [
  {
    id: 'astr',
    abbreviation: 'ASTR',
    name: 'Astronomy & Astrophysics',
    displayName: 'ASTR - Astronomy & Astrophysics',
    aliases: ['Astronomy'],
    isActive: true,
  },
  {
    id: 'ceng',
    abbreviation: 'CENG',
    name: 'Chemical Engineering',
    displayName: 'CENG - Chemical Engineering',
    aliases: ['CEE', 'Chemical & Environmental Engineering'],
    isActive: true,
  },
  {
    id: 'cee',
    abbreviation: 'CEE',
    name: 'Chemical & Environmental Engineering',
    displayName: 'CEE - Chemical & Environmental Engineering',
    aliases: [],
    isActive: false,
  },
  {
    id: 'mcdb',
    abbreviation: 'MCDB',
    name: 'Molecular, Cellular, and Developmental Biology',
    displayName: 'MCDB - Molecular, Cellular, and Developmental Biology',
    aliases: ['Molecular', 'Cellular & Developmental Biology'],
    isActive: true,
  },
  {
    id: 'hshm',
    abbreviation: 'HSHM',
    name: 'History of Science, Medicine, and Public Health',
    displayName: 'HSHM - History of Science, Medicine, and Public Health',
    aliases: ['History of Science & Medicine', 'History of Medicine'],
    isActive: true,
  },
];

describe('planDepartmentDisplayAlignment', () => {
  it('adopts the published name and rewrites the prefixed display name', () => {
    const rename = planDepartmentDisplayAlignment(table).rows.find(
      (row) => row.action === 'rename' && row.abbreviation === 'ASTR',
    );
    expect(rename).toMatchObject({
      fromName: 'Astronomy & Astrophysics',
      toName: 'Astronomy',
      displayName: 'ASTR - Astronomy',
      aliases: ['Astronomy & Astrophysics'],
    });
  });

  it('ignores an inactive row when resolving the row to rename', () => {
    const renames = planDepartmentDisplayAlignment(table).rows.filter(
      (row) => row.action === 'rename' && row.toName === 'Chemical & Environmental Engineering',
    );
    expect(renames).toHaveLength(1);
    expect(renames[0]).toMatchObject({
      targetId: 'ceng',
      aliases: ['CEE', 'Chemical Engineering'],
    });
  });

  it('drops the comma-split alias fragments of a department name', () => {
    const repair = planDepartmentDisplayAlignment(table).rows.find(
      (row) => row.action === 'repair-aliases' && row.abbreviation === 'MCDB',
    );
    expect(repair).toMatchObject({
      removedAliases: ['Molecular', 'Cellular & Developmental Biology'],
    });
    expect(repair && repair.action === 'repair-aliases' && repair.aliases).toEqual([
      'Molecular, Cellular, and Developmental Biology',
    ]);
  });

  it('keeps the merged row resolvable for both units the index lists', () => {
    const rename = planDepartmentDisplayAlignment(table).rows.find(
      (row) => row.action === 'rename' && row.abbreviation === 'HSHM',
    );
    expect(rename).toMatchObject({ toName: 'History of Science & Medicine' });
    expect(rename && rename.action === 'rename' && rename.aliases).toEqual([
      'History of Medicine',
      'History of Science, Medicine, and Public Health',
    ]);
  });

  it('adds an index entry the table has no row for at all', () => {
    const created = planDepartmentDisplayAlignment(table).rows.filter(
      (row) => row.action === 'create',
    );
    expect(created.map((row) => row.action === 'create' && row.abbreviation)).toEqual(
      DEPARTMENT_DISPLAY_ADDITIONS.map((addition) => addition.abbreviation),
    );
    const labm = created.find((row) => row.action === 'create' && row.abbreviation === 'LABM');
    expect(labm).toMatchObject({
      name: 'Laboratory Medicine',
      displayName: 'LABM - Laboratory Medicine',
      primaryCategory: DepartmentCategory.HEALTH_MEDICINE,
      colorKey: 3,
    });
  });

  it('reports an index entry with no drifted row as absent rather than blocked', () => {
    const plan = planDepartmentDisplayAlignment(table);
    expect(plan.blocked).toEqual([]);
    expect(plan.absent).toContain('Spanish & Portuguese');
  });

  it('is idempotent once the published names are adopted', () => {
    const first = planDepartmentDisplayAlignment(table);
    const applied: DepartmentDisplayRow[] = table.map((row) => {
      const next = { ...row, aliases: [...(row.aliases || [])] };
      for (const planned of first.rows) {
        if (planned.action === 'create') continue;
        if (planned.targetId !== row.id) continue;
        if (planned.action === 'rename') {
          next.name = planned.toName;
          next.displayName = planned.displayName;
        }
        next.aliases = planned.aliases;
      }
      return next;
    });
    for (const planned of first.rows) {
      if (planned.action !== 'create') continue;
      applied.push({
        id: `new:${planned.abbreviation}`,
        abbreviation: planned.abbreviation,
        name: planned.name,
        displayName: planned.displayName,
        aliases: planned.aliases,
        isActive: true,
      });
    }
    const second = planDepartmentDisplayAlignment(applied);
    expect(second.rows).toEqual([]);
    expect(second.blocked).toEqual([]);
  });

  it('blocks an addition whose abbreviation is already taken', () => {
    const plan = planDepartmentDisplayAlignment([
      ...table,
      { id: 'labm', abbreviation: 'LABM', name: 'Something Else', isActive: true },
    ]);
    expect(plan.blocked).toContainEqual({
      gap: 'Laboratory Medicine',
      reason: 'abbreviation LABM already taken',
    });
  });

  it('counts what it planned', () => {
    const summary = summarizeDepartmentDisplayPlan(planDepartmentDisplayAlignment(table));
    expect(summary.renamed).toBe(4);
    expect(summary.aliasRepairs).toBe(1);
    expect(summary.created).toBe(DEPARTMENT_DISPLAY_ADDITIONS.length);
    expect(summary.blocked).toBe(0);
  });
});
