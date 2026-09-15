import { describe, expect, it } from 'vitest';
import {
  DEPARTMENT_DISPLAY_ADDITIONS,
  planDepartmentDisplayAlignment,
  summarizeDepartmentDisplayPlan,
  type DepartmentDisplayRow,
} from '../alignDepartmentDisplayCatalogCore';
import { DepartmentCategory, categoryColorKeys } from '../../models/department';
import { OFFICIAL_DEPARTMENT_INDEX_URL } from '../officialDepartmentNames';

describe('DEPARTMENT_DISPLAY_ADDITIONS', () => {
  it('claims each abbreviation and name once', () => {
    const abbreviations = DEPARTMENT_DISPLAY_ADDITIONS.map((row) => row.abbreviation);
    const names = DEPARTMENT_DISPLAY_ADDITIONS.map((row) => row.name);
    expect(new Set(abbreviations).size).toBe(abbreviations.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('carries its primary category among its categories', () => {
    for (const row of DEPARTMENT_DISPLAY_ADDITIONS) {
      expect(row.categories, row.name).toContain(row.primaryCategory);
      expect(categoryColorKeys[row.primaryCategory]).toBeTypeOf('number');
    }
  });

  it('never lists a name as its own alias', () => {
    for (const row of DEPARTMENT_DISPLAY_ADDITIONS) {
      expect(row.aliases, row.name).not.toContain(row.name);
    }
  });

  // `provenance` decides whether the snapshot or the served facet vouches for a
  // row's spelling, so the prose has to cite the evidence it claims to rest on.
  it('names the evidence each row rests on', () => {
    for (const row of DEPARTMENT_DISPLAY_ADDITIONS) {
      if (row.provenance === 'official-index') {
        expect(row.source, row.name).toContain(OFFICIAL_DEPARTMENT_INDEX_URL);
        continue;
      }
      expect(row.source, row.name).toContain('org_units');
    }
  });
});

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

  it('blocks rather than reports done when a second served row still carries the prior name', () => {
    const bothActive = table.map((row) =>
      row.id === 'cee' ? { ...row, isActive: true } : { ...row },
    );
    const plan = planDepartmentDisplayAlignment(bothActive);
    expect(
      plan.rows.some(
        (row) => row.action === 'rename' && row.toName === 'Chemical & Environmental Engineering',
      ),
    ).toBe(false);
    expect(plan.satisfied).not.toContain('Chemical & Environmental Engineering already named');
    expect(plan.blocked).toContainEqual({
      gap: 'Chemical & Environmental Engineering',
      reason: 'CEE already carries that name while CENG still carries Chemical Engineering',
    });
  });

  it('blocks an addition whose uniquely indexed abbreviation an inactive row holds', () => {
    const plan = planDepartmentDisplayAlignment([
      ...table,
      {
        id: 'labm',
        abbreviation: 'LABM',
        name: 'Laboratory Medicine',
        isActive: false,
      },
    ]);
    expect(plan.rows.some((row) => row.action === 'create' && row.abbreviation === 'LABM')).toBe(
      false,
    );
    expect(plan.blocked).toContainEqual({
      gap: 'Laboratory Medicine',
      reason: 'abbreviation LABM held by an inactive row',
    });
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

  it('creates a row the index does not name once the facet serves that exact name', () => {
    const plan = planDepartmentDisplayAlignment(table, {
      servedFacetValues: ['Cardiovascular Medicine'],
    });
    expect(plan.rows.some((row) => row.action === 'create' && row.abbreviation === 'CVMD')).toBe(
      true,
    );
    expect(plan.blocked).toContainEqual({
      gap: 'Digestive Diseases',
      reason: 'no served entity carries that department facet value',
    });
  });

  it('blocks a row whose name drifts from the facet value the search filter matches', () => {
    const plan = planDepartmentDisplayAlignment(table, {
      servedFacetValues: ['Medical Oncology & Hematology'],
    });
    expect(plan.rows.some((row) => row.action === 'create' && row.abbreviation === 'MONC')).toBe(
      false,
    );
    expect(plan.blocked).toContainEqual({
      gap: 'Medical Oncology and Hematology',
      reason:
        'the department facet serves it as Medical Oncology & Hematology, which research.tsx filters on verbatim',
    });
  });

  it('creates the row when the facet serves the exact name alongside a drifted spelling', () => {
    const plan = planDepartmentDisplayAlignment(table, {
      servedFacetValues: ['Medical Oncology & Hematology', 'Medical Oncology and Hematology'],
    });
    expect(plan.rows.some((row) => row.action === 'create' && row.abbreviation === 'MONC')).toBe(
      true,
    );
    expect(plan.blocked.map((entry) => entry.gap)).not.toContain('Medical Oncology and Hematology');
  });

  it('blocks a facet value another row only carries as an alias', () => {
    const plan = planDepartmentDisplayAlignment(
      [
        ...table,
        {
          id: 'inmd',
          abbreviation: 'INMD',
          name: 'Internal Medicine',
          aliases: ['Hematology'],
          isActive: true,
        },
      ],
      { servedFacetValues: ['Hematology'] },
    );
    expect(plan.rows.some((row) => row.action === 'create' && row.abbreviation === 'HEMA')).toBe(
      false,
    );
    expect(plan.satisfied).not.toContain('Hematology (already INMD)');
    expect(plan.blocked).toContainEqual({
      gap: 'Hematology',
      reason: 'INMD carries it as Internal Medicine, so no row filters on the facet value verbatim',
    });
  });

  it('leaves an index-cited addition to the snapshot rather than to the facet', () => {
    const plan = planDepartmentDisplayAlignment(table, { servedFacetValues: [] });
    expect(
      plan.rows.filter((row) => row.action === 'create').map((row) => row.abbreviation),
    ).toEqual(
      DEPARTMENT_DISPLAY_ADDITIONS.filter(
        (addition) => addition.provenance === 'official-index',
      ).map((addition) => addition.abbreviation),
    );
  });

  it('reports a row it already created as satisfied rather than blocking it again', () => {
    const first = planDepartmentDisplayAlignment(table, {
      servedFacetValues: ['Cardiovascular Medicine'],
    });
    const created = first.rows.filter((row) => row.action === 'create');
    const applied: DepartmentDisplayRow[] = [
      ...table,
      ...created.map((row) => ({
        id: `new:${row.abbreviation}`,
        abbreviation: row.abbreviation,
        name: row.action === 'create' ? row.name : '',
        aliases: row.aliases,
        isActive: true,
      })),
    ];
    const second = planDepartmentDisplayAlignment(applied, { servedFacetValues: [] });
    expect(second.satisfied).toContain('Cardiovascular Medicine (already CVMD)');
    expect(second.blocked.map((entry) => entry.gap)).not.toContain('Cardiovascular Medicine');
  });

  it('frees an aliased name so the department that owns it gets a search target', () => {
    const plan = planDepartmentDisplayAlignment(table, {
      servedFacetValues: ['History of Medicine'],
    });
    const repair = plan.rows.find(
      (row) => row.action === 'repair-aliases' && row.abbreviation === 'HSHM',
    );
    expect(repair).toMatchObject({ removedAliases: ['History of Medicine'] });
    expect(plan.rows.some((row) => row.action === 'create' && row.abbreviation === 'HMED')).toBe(
      true,
    );
    expect(plan.blocked.map((entry) => entry.gap)).not.toContain('History of Medicine');
  });

  it('counts what it planned', () => {
    const summary = summarizeDepartmentDisplayPlan(planDepartmentDisplayAlignment(table));
    expect(summary.renamed).toBe(4);
    expect(summary.aliasRepairs).toBe(2);
    expect(summary.created).toBe(DEPARTMENT_DISPLAY_ADDITIONS.length);
    expect(summary.blocked).toBe(0);
  });
});
