import { describe, expect, it } from 'vitest';
import {
  ORG_UNIT_CATALOG_GAPS,
  planOrgUnitCatalogGapSeed,
  summarizeOrgUnitSeedPlan,
  type ExistingOrgUnitRow,
  type OrgUnitCatalogGap,
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

const ROSTER_GAPS = ORG_UNIT_CATALOG_GAPS.filter((gap) =>
  gap.source.includes('DEFAULT_DEPT_CONFIGS'),
);

describe('planOrgUnitCatalogGapSeed roster gaps', () => {
  it('resolves the parent past an archived row that shares its name', () => {
    const shadowed: ExistingOrgUnitRow[] = [
      {
        id: 'sph-archived',
        name: 'School of Public Health',
        slug: 'ysph',
        kind: 'SCHOOL',
        archived: true,
      },
      ...catalog,
    ];
    const created = planOrgUnitCatalogGapSeed(shadowed, ROSTER_GAPS).rows.find(
      (row) => row.action === 'create-department',
    );
    expect(created).toMatchObject({ name: 'Social and Behavioral Sciences', parentId: 'sph' });
  });

  it('refuses a create whose slug an archived row already holds', () => {
    const taken: ExistingOrgUnitRow[] = [
      ...catalog,
      {
        id: 'sbs-archived',
        name: 'Retired Social Behaviour Unit',
        slug: 'social-and-behavioral-sciences',
        kind: 'DEPARTMENT',
        archived: true,
      },
    ];
    const plan = planOrgUnitCatalogGapSeed(taken, ROSTER_GAPS);
    expect(plan.rows.some((row) => row.action === 'create-department')).toBe(false);
    expect(plan.blocked).toContainEqual({
      gap: 'Social and Behavioral Sciences',
      reason: 'slug social-and-behavioral-sciences already taken',
    });
  });

  it('plans every catalog gap against a catalog that has none of them', () => {
    const plan = planOrgUnitCatalogGapSeed(catalog, ROSTER_GAPS);
    expect(plan.blocked).toEqual([]);
    expect(summarizeOrgUnitSeedPlan(plan)).toEqual({
      created: 1,
      aliasUpdates: 4,
      aliasRemovals: 0,
      renames: 0,
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
        const gap = ROSTER_GAPS.find(
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
    const plan = planOrgUnitCatalogGapSeed(seeded, ROSTER_GAPS);
    expect(plan.rows).toEqual([]);
    expect(plan.blocked).toEqual([]);
    expect(plan.satisfied).toHaveLength(ROSTER_GAPS.length);
  });

  it('reports a blocked gap instead of guessing when the target or parent is missing', () => {
    const plan = planOrgUnitCatalogGapSeed([], ROSTER_GAPS);
    expect(plan.rows).toEqual([]);
    expect(plan.blocked).toHaveLength(ROSTER_GAPS.length);
  });

  it('reports a later gap that lands on a row this run only plans to create', () => {
    const gaps: OrgUnitCatalogGap[] = [
      {
        action: 'create-department',
        name: 'Social and Behavioral Sciences',
        slug: 'social-and-behavioral-sciences',
        parentName: 'School of Public Health',
        aliases: ['SBS'],
        source: 'test',
      },
      {
        action: 'add-aliases',
        targetName: 'Social and Behavioral Sciences',
        aliases: ['Social & Behavioural Sciences'],
        source: 'test',
      },
      {
        action: 'create-department',
        name: 'Social and Behavioral Sciences',
        slug: 'social-and-behavioral-sciences',
        parentName: 'School of Public Health',
        aliases: [],
        source: 'test',
      },
    ];
    const plan = planOrgUnitCatalogGapSeed(catalog, gaps);
    expect(plan.rows.filter((row) => row.action === 'create-department')).toHaveLength(1);
    expect(plan.rows.some((row) => row.action === 'add-aliases')).toBe(false);
    expect(plan.blocked).toContainEqual({
      gap: 'Social and Behavioral Sciences',
      reason:
        'social-and-behavioral-sciences is created by this run, so fold the change into its create gap',
    });
    expect(plan.satisfied).toContain(
      'Social and Behavioral Sciences (already DEPARTMENT Social and Behavioral Sciences)',
    );
  });

  it('lets the roster labels resolve once the planned rows exist', () => {
    const plan = planOrgUnitCatalogGapSeed(catalog, ROSTER_GAPS);
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

const OFFICIAL_GAPS = ORG_UNIT_CATALOG_GAPS.filter((gap) =>
  gap.source.includes('official department index'),
);

const MEDICINE_GAPS = ORG_UNIT_CATALOG_GAPS.filter(
  (gap) =>
    !gap.source.includes('official department index') &&
    (gap.source.startsWith('Yale School of Medicine') ||
      gap.source.includes('Yale HR/directory org string')),
);

const medicineCatalog: ExistingOrgUnitRow[] = [
  { id: 'ysm', name: 'School of Medicine', slug: 'school-of-medicine', kind: 'SCHOOL' },
  { id: 'sph', name: 'School of Public Health', slug: 'school-of-public-health', kind: 'SCHOOL' },
  { id: 'surgery', name: 'Surgery', slug: 'surgery', kind: 'DEPARTMENT' },
  { id: 'intmed', name: 'Internal Medicine', slug: 'internal-medicine', kind: 'DEPARTMENT' },
  { id: 'peds', name: 'Pediatrics', slug: 'pediatrics', kind: 'DEPARTMENT' },
  { id: 'neuro', name: 'Neurology', slug: 'neurology', kind: 'DEPARTMENT' },
  { id: 'nsgy', name: 'Neurosurgery', slug: 'neurosurgery', kind: 'DEPARTMENT' },
  { id: 'uro', name: 'Urology', slug: 'urology', kind: 'DEPARTMENT' },
  { id: 'em', name: 'Emergency Medicine', slug: 'emergency-medicine', kind: 'DEPARTMENT' },
  { id: 'cpmd', name: 'Comparative Medicine', slug: 'comparative-medicine', kind: 'DEPARTMENT' },
  {
    id: 'bmi',
    name: 'Biomedical Informatics & Data Science',
    slug: 'biomedical-informatics-and-data-science',
    kind: 'DEPARTMENT',
  },
  {
    id: 'rbi',
    name: 'Radiology & Biomedical Imaging',
    slug: 'radiology-and-biomedical-imaging',
    kind: 'DEPARTMENT',
  },
  {
    id: 'tra',
    name: 'Therapeutic Radiology/Radiation Oncology',
    slug: 'therapeutic-radiology',
    kind: 'DEPARTMENT',
  },
  {
    id: 'obgyn',
    name: 'Obstetrics, Gynecology & Reproductive Sciences',
    slug: 'obstetrics-gynecology-and-reproductive-sciences',
    kind: 'DEPARTMENT',
  },
  {
    id: 'cde',
    name: 'Chronic Disease Epidemiology',
    slug: 'chronic-disease-epidemiology',
    kind: 'DEPARTMENT',
  },
  {
    id: 'medonc',
    name: 'Medical Oncology and Hematology',
    slug: 'medical-oncology-and-hematology',
    kind: 'SECTION',
  },
  {
    id: 'cvmed',
    name: 'Cardiovascular Medicine',
    slug: 'cardiovascular-medicine',
    kind: 'SECTION',
  },
  {
    id: 'endo',
    name: 'Endocrinology',
    slug: 'endocrinology',
    kind: 'SECTION',
  },
];

describe('planOrgUnitCatalogGapSeed School of Medicine gaps', () => {
  it('creates each new unit at the section altitude under its own department', () => {
    const plan = planOrgUnitCatalogGapSeed(medicineCatalog, MEDICINE_GAPS);
    expect(plan.blocked).toEqual([]);

    const created = plan.rows
      .filter((row) => row.action === 'create-department')
      .map((row) => [row.name, row.kind, row.parentName]);
    expect(created).toEqual([
      ['Surgical Oncology', 'SECTION', 'Surgery'],
      ['Plastic & Reconstructive Surgery', 'SECTION', 'Surgery'],
      ['Thoracic Surgery', 'SECTION', 'Surgery'],
      ['Colon & Rectal Surgery', 'SECTION', 'Surgery'],
      ['General Internal Medicine', 'SECTION', 'Internal Medicine'],
      ['General Pediatrics', 'SECTION', 'Pediatrics'],
      ['Pediatric Hematology & Oncology', 'SECTION', 'Pediatrics'],
    ]);
  });

  it('resolves the corpus spellings these gaps exist for', () => {
    const plan = planOrgUnitCatalogGapSeed(medicineCatalog, MEDICINE_GAPS);
    const rows: ExistingOrgUnitRow[] = [
      ...medicineCatalog.map((row) => {
        const update = plan.rows.find(
          (planned) => planned.action === 'add-aliases' && planned.targetId === row.id,
        );
        return update && update.action === 'add-aliases'
          ? { ...row, aliases: update.aliases }
          : row;
      }),
      ...plan.rows
        .filter((row) => row.action === 'create-department')
        .map((row) =>
          row.action === 'create-department'
            ? {
                id: row.slug,
                name: row.name,
                slug: row.slug,
                kind: row.kind,
                aliases: row.aliases,
                parentOrgUnitId: row.parentId,
              }
            : row,
        ),
    ] as ExistingOrgUnitRow[];
    const canonicalizer = createOrgUnitCanonicalizer(buildOrgUnitResolverIndex(rows));
    const result = canonicalizer.canonicalizeDepartments([
      'Surgical Oncology',
      'Colorectal Surgery',
      'General Internal Medicine',
      'MEDCCC Medical Oncology',
      'MEDINT Cardiology',
      'MEDEME Emergency Medicine - All',
      'R&BI - Radiology & Biomedical Imaging',
      'NRSG - Neurosurgery',
      'SPHDPT Chronic Disease Epidemiology (CDE)',
    ]);
    expect(result.values).toEqual([
      'Surgical Oncology',
      'Colon & Rectal Surgery',
      'General Internal Medicine',
      'Medical Oncology and Hematology',
      'Cardiovascular Medicine',
      'Emergency Medicine',
      'Radiology & Biomedical Imaging',
      'Neurosurgery',
      'Chronic Disease Epidemiology',
    ]);
    expect(result.unmatched).toEqual([]);
  });
});

describe('ORG_UNIT_CATALOG_GAPS', () => {
  it('is partitioned by the two suites with no gap left unexercised', () => {
    expect(ROSTER_GAPS.length).toBeGreaterThan(0);
    expect(OFFICIAL_GAPS.length).toBeGreaterThan(0);
    expect(MEDICINE_GAPS.length).toBeGreaterThan(0);
    expect(ROSTER_GAPS.length + OFFICIAL_GAPS.length + MEDICINE_GAPS.length).toBe(
      ORG_UNIT_CATALOG_GAPS.length,
    );
  });
});

/**
 * The Development rows whose shape the official-index gaps have to handle: an
 * alias that duplicates the adopted name, a school label aliased onto a
 * department, an archived row claiming two live rows' names, and a live row
 * renamed onto one of those names. The punctuation-only renames touch rows this
 * fixture leaves out, so they surface here as blocked and stay that way across
 * runs.
 */
const drifted: ExistingOrgUnitRow[] = [
  {
    id: 'astro',
    name: 'Astronomy & Astrophysics',
    slug: 'astronomy-and-astrophysics',
    kind: 'DEPARTMENT',
    aliases: ['ASTR', 'Astronomy'],
  },
  {
    id: 'bio',
    name: 'Biology',
    slug: 'biology',
    kind: 'DEPARTMENT',
    aliases: ['BIOL', 'Biological & Biomedical Sciences', 'BBS'],
  },
  {
    id: 'evst',
    name: 'Environmental Studies',
    slug: 'environmental-studies',
    kind: 'DEPARTMENT',
    aliases: ['EVST', 'Environment'],
  },
  {
    id: 'yse',
    name: 'School of the Environment',
    slug: 'yale-school-of-the-environment',
    kind: 'SCHOOL',
    aliases: ['YSE'],
  },
  {
    id: 'hshm-live',
    name: 'History of Science and Medicine',
    slug: 'history-of-science-and-medicine',
    kind: 'DEPARTMENT',
    aliases: ['HSHM'],
  },
  {
    id: 'hshm-archived',
    name: 'History of Science, Medicine, and Public Health',
    slug: 'history-of-science-medicine-and-public-health',
    kind: 'DEPARTMENT',
    aliases: ['HSHM', 'History of Science & Medicine', 'History of Medicine'],
    archived: true,
  },
  {
    id: 'histmed',
    name: 'History of Medicine',
    slug: 'history-of-medicine',
    kind: 'DEPARTMENT',
  },
];

const officialPlan = (rows: ExistingOrgUnitRow[]) => planOrgUnitCatalogGapSeed(rows, OFFICIAL_GAPS);

describe('planOrgUnitCatalogGapSeed official-index gaps', () => {
  it('adopts the published name and keeps the prior name resolvable', () => {
    const rename = officialPlan(drifted).rows.find(
      (row) => row.action === 'rename-department' && row.toName === 'Astronomy',
    );
    expect(rename).toMatchObject({
      action: 'rename-department',
      targetId: 'astro',
      fromName: 'Astronomy & Astrophysics',
      toName: 'Astronomy',
    });
    expect(rename && rename.action === 'rename-department' && rename.aliases).toEqual([
      'ASTR',
      'Astronomy & Astrophysics',
    ]);
  });

  it('drops an alias that duplicates the adopted name', () => {
    const rename = officialPlan(drifted).rows.find(
      (row) =>
        row.action === 'rename-department' && row.toName === 'Biological & Biomedical Sciences',
    );
    expect(rename && rename.action === 'rename-department' && rename.aliases).toEqual([
      'BIOL',
      'BBS',
      'Biology',
    ]);
  });

  it('leaves no alias repeating the demoted name in another casing', () => {
    const hrVariant = drifted.map((row) =>
      row.id === 'bio' ? { ...row, aliases: ['BIOL', 'BIOLOGY', 'BBS'] } : row,
    );
    const rename = officialPlan(hrVariant).rows.find(
      (row) => row.action === 'rename-department' && row.targetId === 'bio',
    );
    const aliases = rename && rename.action === 'rename-department' ? rename.aliases : [];
    expect(aliases).toEqual(['BIOL', 'BIOLOGY', 'BBS']);
    expect(new Set(aliases.map((alias) => alias.trim().toLocaleLowerCase())).size).toBe(
      aliases.length,
    );
  });

  it('blocks a rename when a same-key duplicate still carries the stale spelling', () => {
    const duplicated: ExistingOrgUnitRow[] = [
      {
        id: 'eps-published',
        name: 'Earth & Planetary Sciences',
        slug: 'earth-and-planetary-sciences',
        kind: 'DEPARTMENT',
      },
      {
        id: 'eps-stale',
        name: 'Earth and Planetary Sciences',
        slug: 'earth-planetary-sciences-legacy',
        kind: 'DEPARTMENT',
      },
      ...drifted,
    ];
    const plan = officialPlan(duplicated);
    expect(plan.satisfied).not.toContain('Earth & Planetary Sciences (already named)');
    expect(plan.blocked).toContainEqual({
      gap: 'Earth & Planetary Sciences',
      reason:
        'earth-and-planetary-sciences already carries that name while earth-planetary-sciences-legacy still carries Earth and Planetary Sciences',
    });
    expect(
      plan.rows.some((row) => row.action === 'rename-department' && row.targetId === 'eps-stale'),
    ).toBe(false);
  });

  it('moves a school label off the department it was aliased onto', () => {
    const plan = officialPlan(drifted);
    const removal = plan.rows.find(
      (row) => row.action === 'remove-aliases' && row.targetSlug === 'environmental-studies',
    );
    expect(removal).toMatchObject({ removedAliases: ['Environment'], aliases: ['EVST'] });
    const addition = plan.rows.find(
      (row) => row.action === 'add-aliases' && row.targetId === 'yse',
    );
    expect(addition).toMatchObject({ addedAliases: ['Environment'] });
  });

  it('strips ambiguous aliases from an archived row without renaming it', () => {
    const plan = officialPlan(drifted);
    const removal = plan.rows.find(
      (row) =>
        row.action === 'remove-aliases' &&
        row.targetSlug === 'history-of-science-medicine-and-public-health',
    );
    expect(removal).toMatchObject({
      removedAliases: ['History of Science & Medicine', 'History of Medicine'],
      aliases: ['HSHM'],
    });
    expect(
      plan.rows.some(
        (row) => row.action === 'rename-department' && row.targetId === 'hshm-archived',
      ),
    ).toBe(false);
  });

  it('renames the live row onto a name the archived row also claimed', () => {
    const rename = officialPlan(drifted).rows.find(
      (row) => row.action === 'rename-department' && row.targetId === 'hshm-live',
    );
    expect(rename).toMatchObject({
      fromName: 'History of Science and Medicine',
      toName: 'History of Science & Medicine',
    });
  });

  it('is idempotent once the published names are adopted', () => {
    const first = officialPlan(drifted);
    const applied = drifted.map((row) => {
      const next = { ...row, aliases: [...(row.aliases || [])] };
      for (const planned of first.rows) {
        if (planned.action === 'rename-department' && planned.targetId === row.id) {
          next.name = planned.toName;
          next.aliases = planned.aliases;
        }
        if (planned.action === 'remove-aliases' && planned.targetId === row.id) {
          next.aliases = planned.aliases;
        }
        if (planned.action === 'add-aliases' && planned.targetId === row.id) {
          next.aliases = planned.aliases;
        }
      }
      return next;
    });
    const second = officialPlan(applied);
    expect(second.rows).toEqual([]);
    expect(second.blocked).toEqual(first.blocked);
  });

  it('renames the live row, not an INACTIVE namesake listed ahead of it', () => {
    const shadowed: ExistingOrgUnitRow[] = [
      {
        id: 'astro-inactive',
        name: 'Astronomy & Astrophysics',
        slug: 'astronomy-astrophysics-legacy',
        kind: 'DEPARTMENT',
        status: 'INACTIVE',
      },
      ...drifted,
    ];
    const renames = officialPlan(shadowed).rows.filter(
      (row) => row.action === 'rename-department' && row.toName === 'Astronomy',
    );
    expect(renames).toHaveLength(1);
    expect(renames[0]).toMatchObject({ targetId: 'astro' });
  });

  it('is not blocked by an INACTIVE row that carries the published name', () => {
    const shadowed: ExistingOrgUnitRow[] = [
      ...drifted,
      {
        id: 'astronomy-inactive',
        name: 'Astronomy',
        slug: 'astronomy-legacy',
        kind: 'DEPARTMENT',
        status: 'INACTIVE',
      },
    ];
    const plan = officialPlan(shadowed);
    expect(
      plan.rows.some((row) => row.action === 'rename-department' && row.targetId === 'astro'),
    ).toBe(true);
    expect(plan.blocked.map((entry) => entry.gap)).not.toContain('Astronomy');
  });

  it('refuses a rename onto a name another live row already carries', () => {
    const collided: ExistingOrgUnitRow[] = [
      ...drifted,
      { id: 'squatter', name: 'Astronomy', slug: 'astronomy', kind: 'DEPARTMENT' },
    ];
    const plan = officialPlan(collided);
    expect(
      plan.rows.some((row) => row.action === 'rename-department' && row.targetId === 'astro'),
    ).toBe(false);
    expect(plan.blocked).toContainEqual({
      gap: 'Astronomy',
      reason: 'astronomy already carries that name',
    });
  });

  it('serves the published name once the plan is applied', () => {
    const plan = officialPlan(drifted);
    const rows = drifted.map((row) => {
      const rename = plan.rows.find(
        (candidate) => candidate.action === 'rename-department' && candidate.targetId === row.id,
      );
      return rename && rename.action === 'rename-department'
        ? { ...row, name: rename.toName, aliases: rename.aliases }
        : row;
    });
    const canonicalizer = createOrgUnitCanonicalizer(
      buildOrgUnitResolverIndex(rows.filter((row) => row.archived !== true)),
    );
    const result = canonicalizer.canonicalizeDepartments([
      'Astronomy & Astrophysics',
      'ASTR',
      'BBS',
    ]);
    expect(result.values).toEqual(['Astronomy', 'Biological & Biomedical Sciences']);
  });
});
