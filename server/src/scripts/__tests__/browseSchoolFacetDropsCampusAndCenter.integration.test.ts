import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import { OrgUnit } from '../../models/orgUnit';
import { ResearchEntity } from '../../models/researchEntity';
import { resetOrgUnitCanonicalizerCache } from '../../scrapers/orgUnitCanonicalization';
import { searchResearchGroupsViaMeili } from '../../services/researchGroupService';
import { runOrgUnitBackfill } from '../backfillResearchEntityOrgUnits';

const MEDICINE = 'Yale School of Medicine';
const PUBLIC_HEALTH = 'Yale School of Public Health';
const CAMPUS = 'Yale West Campus';
const CENTER = 'MacMillan Center for International and Area Studies at Yale';

const READY_SHORT =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const READY_FULL =
  'The lab studies neonatal care quality improvement across community hospital nurseries, combining bedside outcome audits, staffing and transfer pattern analysis, and implementation trials of standardized resuscitation protocols to reduce avoidable transfers to tertiary intensive care.';

interface SeedRow {
  slug: string;
  school: string;
  schools: string[];
  departments: string[];
  orgAffiliationLabels?: string[];
}

/**
 * The stored shape a scrape wrote while `canonicalizeSchool` kept an unresolved
 * label raw: the campus or the center sits in `school` and in the `schools[]` the
 * browse dropdown is built from, beside the school the canonical department
 * derives.
 */
const SEED_ROWS: SeedRow[] = [
  {
    slug: 'facet-campus-lab-one',
    school: CAMPUS,
    schools: [CAMPUS, MEDICINE],
    departments: ['Internal Medicine'],
  },
  {
    slug: 'facet-campus-lab-two',
    school: CAMPUS,
    schools: [CAMPUS, MEDICINE],
    departments: ['Internal Medicine'],
  },
  {
    slug: 'facet-center-lab-one',
    school: CENTER,
    schools: [CENTER, PUBLIC_HEALTH],
    departments: ['Biostatistics'],
    orgAffiliationLabels: ['Yale Cancer Center'],
  },
  {
    slug: 'facet-canonical-lab-one',
    school: PUBLIC_HEALTH,
    schools: [PUBLIC_HEALTH],
    departments: ['Biostatistics'],
  },
];

const entityDocument = (row: SeedRow, index: number): Record<string, unknown> => ({
  schemaVersion: 1,
  slug: row.slug,
  name: `Synthetic Facet Lab ${index + 1}`,
  displayName: `Synthetic Facet Lab ${index + 1}`,
  kind: 'lab',
  entityType: 'LAB',
  shortDescription: READY_SHORT,
  fullDescription: READY_FULL,
  researchAreas: ['neonatal outcomes'],
  methods: ['outcome audits'],
  departments: row.departments,
  school: row.school,
  schools: row.schools,
  orgAffiliationLabels: row.orgAffiliationLabels ?? [],
  websiteUrl: `https://example.invalid/${row.slug}`,
  hasUndergradHostingEvidence: true,
  browseRankScore: 100 - index,
  lastObservedAt: new Date('2026-08-24T00:00:00.000Z'),
  archived: false,
  studentVisibilityTier: 'student_ready',
  studentVisibilityComputedTier: 'student_ready',
  studentVisibilityReasons: ['facet-fixture'],
});

const browseSchoolFacet = async (): Promise<Record<string, number>> => {
  const result = await searchResearchGroupsViaMeili('', {}, 1, 24, {}, {});
  return result.facetDistribution?.school ?? {};
};

const servedBySchoolFilter = async (
  school: string,
): Promise<Array<{ slug: string; school: string }>> => {
  const result = (await searchResearchGroupsViaMeili(
    '',
    { school: [school] },
    1,
    24,
    {},
    {},
  )) as unknown as { researchEntities?: Array<{ slug?: string; school?: string }> };
  return (result.researchEntities ?? [])
    .map((entity) => ({ slug: String(entity.slug), school: String(entity.school ?? '') }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
};

describe('the browse school dropdown stops offering a campus or a center (#2277)', () => {
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
    if (!db) throw new Error('no database connection');
    await Promise.all([
      db.collection('research_entities').deleteMany({}),
      db.collection('org_units').deleteMany({}),
    ]);
    resetOrgUnitCanonicalizerCache();

    const medicine = await OrgUnit.create({
      slug: 'yale-school-of-medicine',
      name: MEDICINE,
      kind: 'SCHOOL',
      status: 'ACTIVE',
    });
    const publicHealth = await OrgUnit.create({
      slug: 'yale-school-of-public-health',
      name: PUBLIC_HEALTH,
      kind: 'SCHOOL',
      status: 'ACTIVE',
    });
    await OrgUnit.create({
      slug: 'internal-medicine',
      name: 'Internal Medicine',
      kind: 'DEPARTMENT',
      status: 'ACTIVE',
      parentOrgUnitId: medicine._id,
    });
    await OrgUnit.create({
      slug: 'biostatistics',
      name: 'Biostatistics',
      kind: 'DEPARTMENT',
      status: 'ACTIVE',
      parentOrgUnitId: publicHealth._id,
    });

    await ResearchEntity.insertMany(SEED_ROWS.map(entityDocument), { ordered: true });
  });

  it('offers the campus and the center before the re-canonicalization operation runs', async () => {
    expect(await browseSchoolFacet()).toEqual({
      [CAMPUS]: 2,
      [CENTER]: 1,
      [MEDICINE]: 2,
      [PUBLIC_HEALTH]: 2,
    });
  });

  it('publishes the department parent school and drops the campus and the center after it runs', async () => {
    await runOrgUnitBackfill({ dryRun: false, batchSize: 200 });

    const facet = await browseSchoolFacet();
    expect(Object.keys(facet).sort()).toEqual([MEDICINE, PUBLIC_HEALTH].sort());
    expect(facet).toEqual({ [MEDICINE]: 2, [PUBLIC_HEALTH]: 2 });

    expect(await servedBySchoolFilter(MEDICINE)).toEqual([
      { slug: 'facet-campus-lab-one', school: MEDICINE },
      { slug: 'facet-campus-lab-two', school: MEDICINE },
    ]);
    expect(await servedBySchoolFilter(PUBLIC_HEALTH)).toEqual([
      { slug: 'facet-canonical-lab-one', school: PUBLIC_HEALTH },
      { slug: 'facet-center-lab-one', school: PUBLIC_HEALTH },
    ]);
    expect(await servedBySchoolFilter(CAMPUS)).toEqual([]);
  });

  it('keeps the cleared campus and center labels searchable as affiliation text', async () => {
    await runOrgUnitBackfill({ dryRun: false, batchSize: 200 });

    const campusRow = await ResearchEntity.findOne({ slug: 'facet-campus-lab-one' }).lean<{
      school?: string;
      schools?: string[];
      orgAffiliationLabels?: string[];
    }>();
    expect(campusRow?.school).toBe(MEDICINE);
    expect(campusRow?.schools).toEqual([MEDICINE]);
    expect(campusRow?.orgAffiliationLabels).toEqual([CAMPUS]);

    const centerRow = await ResearchEntity.findOne({ slug: 'facet-center-lab-one' }).lean<{
      school?: string;
      orgAffiliationLabels?: string[];
    }>();
    expect(centerRow?.school).toBe(PUBLIC_HEALTH);
    expect(centerRow?.orgAffiliationLabels).toEqual(['Yale Cancer Center', CENTER]);
  });
});
