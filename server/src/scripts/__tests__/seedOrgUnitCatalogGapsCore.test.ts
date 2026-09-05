import { describe, expect, it } from 'vitest';
import {
  ORG_UNIT_CATALOG_GAPS,
  planOrgUnitCatalogGapSeed,
  summarizeOrgUnitSeedPlan,
  type ExistingOrgUnitRow,
} from '../seedOrgUnitCatalogGapsCore';
import {
  buildOrgUnitResolverIndex,
  createOrgUnitCanonicalizer,
} from '../../scrapers/orgUnitCanonicalization';

const catalog: ExistingOrgUnitRow[] = [
  { id: 'sph', name: 'School of Public Health', slug: 'school-of-public-health', kind: 'SCHOOL' },
  { id: 'div', name: 'Divinity School', slug: 'divinity-school', kind: 'SCHOOL' },
  {
    id: 'fas',
    name: 'Faculty of Arts and Sciences',
    slug: 'faculty-arts-sciences',
    kind: 'DIVISION',
  },
  { id: 'german', name: 'German Studies', slug: 'german-studies', kind: 'DEPARTMENT' },
  { id: 'italian', name: 'Italian Studies', slug: 'italian-studies', kind: 'DEPARTMENT' },
  {
    id: 'hsm',
    name: 'History of Science and Medicine',
    slug: 'history-of-science-and-medicine',
    kind: 'DEPARTMENT',
  },
];

describe('planOrgUnitCatalogGapSeed', () => {
  it('plans every catalog gap against a catalog that has none of them', () => {
    const plan = planOrgUnitCatalogGapSeed(catalog);
    expect(plan.blocked).toEqual([]);
    expect(summarizeOrgUnitSeedPlan(plan)).toEqual({
      created: 1,
      aliasUpdates: 4,
      satisfied: 0,
      blocked: 0,
    });
    const created = plan.rows.find((row) => row.action === 'create-department');
    expect(created).toMatchObject({
      name: 'Social and Behavioral Sciences',
      slug: 'social-and-behavioral-sciences',
      parentId: 'sph',
    });
  });

  it('is idempotent: a catalog that already carries the gaps plans nothing', () => {
    const seeded: ExistingOrgUnitRow[] = [
      ...catalog.map((row) => {
        const gap = ORG_UNIT_CATALOG_GAPS.find(
          (candidate) => candidate.action === 'add-aliases' && candidate.targetName === row.name,
        );
        return gap && gap.action === 'add-aliases' ? { ...row, aliases: gap.aliases } : row;
      }),
      {
        id: 'sbs',
        name: 'Social and Behavioral Sciences',
        slug: 'social-and-behavioral-sciences',
        kind: 'DEPARTMENT',
      },
    ];
    const plan = planOrgUnitCatalogGapSeed(seeded);
    expect(plan.rows).toEqual([]);
    expect(plan.blocked).toEqual([]);
    expect(plan.satisfied).toHaveLength(ORG_UNIT_CATALOG_GAPS.length);
  });

  it('reports a blocked gap instead of guessing when the target or parent is missing', () => {
    const plan = planOrgUnitCatalogGapSeed([]);
    expect(plan.rows).toEqual([]);
    expect(plan.blocked).toHaveLength(ORG_UNIT_CATALOG_GAPS.length);
  });

  it('lets the roster labels resolve once the planned rows exist', () => {
    const plan = planOrgUnitCatalogGapSeed(catalog);
    const rows = catalog.map((row) => {
      const update = plan.rows.find(
        (candidate) => candidate.action === 'add-aliases' && candidate.targetId === row.id,
      );
      return update && update.action === 'add-aliases' ? { ...row, aliases: update.aliases } : row;
    });
    for (const created of plan.rows) {
      if (created.action !== 'create-department') continue;
      rows.push({
        id: 'new',
        name: created.name,
        slug: created.slug,
        kind: 'DEPARTMENT',
        aliases: created.aliases,
      });
    }
    const canonicalizer = createOrgUnitCanonicalizer(buildOrgUnitResolverIndex(rows));
    const result = canonicalizer.canonicalizeDepartments([
      'Germanic Languages & Literatures',
      'Italian Language and Literature',
      'History of Science, Medicine & Public Health',
      'Social & Behavioral Sciences',
      'Social and Behavioral Sciences (SBS)',
      'Divinity',
    ]);
    expect(result.values).toEqual([
      'German Studies',
      'Italian Studies',
      'History of Science and Medicine',
      'Social and Behavioral Sciences',
    ]);
    expect(result.dropped).toEqual(['Divinity']);
    expect(result.affiliationLabels).toEqual([]);
  });
});
