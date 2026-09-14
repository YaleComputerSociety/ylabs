import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const syncEntitiesMock = vi.fn(
  async (_entityType: string, _docs: Array<Record<string, unknown>>) => {},
);

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: (entityType: string, docs: Array<Record<string, unknown>>) =>
    syncEntitiesMock(entityType, docs),
}));

import { Department, DepartmentCategory, categoryColorKeys } from '../../models/department';
import { OrgUnit } from '../../models/orgUnit';
import { ResearchEntity } from '../../models/researchEntity';
import { resetOrgUnitCanonicalizerCache } from '../../scrapers/orgUnitCanonicalization';
import { getConfig, invalidateConfigCache } from '../../services/configService';
import { runOrgUnitBackfill } from '../backfillResearchEntityOrgUnits';
import { runDepartmentDisplayAlignment } from '../alignDepartmentDisplayCatalog';
import { runOrgUnitCatalogGapSeed } from '../seedOrgUnitCatalogGaps';

const PRIOR_TO_OFFICIAL: Array<{ abbreviation: string; prior: string; official: string }> = [
  {
    abbreviation: 'CENG',
    prior: 'Chemical Engineering',
    official: 'Chemical & Environmental Engineering',
  },
  {
    abbreviation: 'EENG',
    prior: 'Electrical Engineering',
    official: 'Electrical & Computer Engineering',
  },
  { abbreviation: 'ASTR', prior: 'Astronomy & Astrophysics', official: 'Astronomy' },
  {
    abbreviation: 'EPS',
    prior: 'Earth and Planetary Sciences',
    official: 'Earth & Planetary Sciences',
  },
];

const entitySlugFor = (abbreviation: string) =>
  `official-name-alignment-${abbreviation.toLowerCase()}`;

const seedCatalogsAndCorpus = async () => {
  const school = await OrgUnit.create({
    slug: 'alignment-parent-school',
    name: 'School of Engineering & Applied Science',
    kind: 'SCHOOL',
    status: 'ACTIVE',
  });

  for (const row of PRIOR_TO_OFFICIAL) {
    await OrgUnit.create({
      slug: row.prior
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
      name: row.prior,
      kind: 'DEPARTMENT',
      aliases: [row.abbreviation],
      parentOrgUnitId: school._id,
      status: 'ACTIVE',
    });

    await Department.create({
      abbreviation: row.abbreviation,
      name: row.prior,
      displayName: `${row.abbreviation} - ${row.prior}`,
      categories: [DepartmentCategory.PHYSICAL_SCIENCES],
      primaryCategory: DepartmentCategory.PHYSICAL_SCIENCES,
      colorKey: categoryColorKeys[DepartmentCategory.PHYSICAL_SCIENCES],
      aliases: [],
      isActive: true,
    });

    await ResearchEntity.create({
      slug: entitySlugFor(row.abbreviation),
      name: `Alignment Fixture Lab ${row.abbreviation}`,
      kind: 'lab',
      entityType: 'LAB',
      departments: [row.prior],
      school: 'School of Engineering & Applied Science',
      schools: ['School of Engineering & Applied Science'],
      archived: false,
      studentVisibilityTier: 'student_ready',
    });
  }
};

const runOperatorSequence = async () => {
  const orgUnits = await runOrgUnitCatalogGapSeed({ dryRun: false });
  const display = await runDepartmentDisplayAlignment({ dryRun: false });
  invalidateConfigCache();
  resetOrgUnitCanonicalizerCache();
  const backfill = await runOrgUnitBackfill({ dryRun: false, batchSize: 50 });
  return { orgUnits, display, backfill };
};

const servedDepartmentRow = async (abbreviation: string) => {
  const config = await getConfig(true);
  return config.departments.list.find((row) => row.abbreviation === abbreviation);
};

const storedDepartments = async (abbreviation: string) => {
  const entity = await ResearchEntity.findOne({ slug: entitySlugFor(abbreviation) }).lean<{
    departments?: string[];
  }>();
  return entity?.departments ?? [];
};

describe('adopting Yale official department names reaches the browse department facet (#2673)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const collection of ['org_units', 'departments', 'research_entities']) {
      await db.collection(collection).deleteMany({});
    }
    invalidateConfigCache();
    resetOrgUnitCanonicalizerCache();
    syncEntitiesMock.mockClear();
    await seedCatalogsAndCorpus();
  });

  it('serves the prior names until the operator sequence runs', async () => {
    for (const row of PRIOR_TO_OFFICIAL) {
      expect(await servedDepartmentRow(row.abbreviation)).toMatchObject({ name: row.prior });
      expect(await storedDepartments(row.abbreviation)).toEqual([row.prior]);
    }
  });

  it('moves org_units, the display table, and the stored facet value onto the official name together', async () => {
    const { orgUnits, display, backfill } = await runOperatorSequence();

    expect(orgUnits.summary.renames).toBeGreaterThanOrEqual(PRIOR_TO_OFFICIAL.length);
    expect(display.summary.renamed).toBeGreaterThanOrEqual(PRIOR_TO_OFFICIAL.length);
    expect(display.plan.blocked).toEqual([]);
    expect(backfill.summary.departmentRewrites).toBe(PRIOR_TO_OFFICIAL.length);

    for (const row of PRIOR_TO_OFFICIAL) {
      const orgUnit = await OrgUnit.findOne({ name: row.official }).lean<{ aliases?: string[] }>();
      expect(orgUnit).not.toBeNull();
      expect(orgUnit?.aliases).toContain(row.prior);

      const served = await servedDepartmentRow(row.abbreviation);
      expect(served).toMatchObject({
        name: row.official,
        displayName: `${row.abbreviation} - ${row.official}`,
      });
      expect(served?.aliases).toContain(row.prior);

      expect(await storedDepartments(row.abbreviation)).toEqual([row.official]);
    }
  });

  it('keeps every department search target filtering on a value the corpus still holds', async () => {
    await runOperatorSequence();

    const config = await getConfig(true);
    const storedValues = new Set(
      (
        await ResearchEntity.find({ slug: { $regex: '^official-name-alignment-' } }).lean<
          { departments?: string[] }[]
        >()
      ).flatMap((entity) => entity.departments ?? []),
    );

    for (const row of PRIOR_TO_OFFICIAL) {
      const served = config.departments.list.find(
        (entry) => entry.abbreviation === row.abbreviation,
      );
      expect(served).toBeDefined();
      expect(storedValues.has(served!.name)).toBe(true);
    }
  });

  it('is idempotent: a second pass plans no further writes', async () => {
    await runOperatorSequence();
    const second = await runOperatorSequence();

    expect(second.orgUnits.plan.rows).toEqual([]);
    expect(second.display.plan.rows).toEqual([]);
    expect(second.backfill.summary.changed).toBe(0);
  });
});
