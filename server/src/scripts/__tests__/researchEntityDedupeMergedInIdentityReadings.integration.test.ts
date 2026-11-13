import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    syncEntities: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

import { Observation } from '../../models/observation';
import { OrgUnit } from '../../models/orgUnit';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../../scrapers/entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../../scrapers/orgUnitCanonicalization';
import { applyResearchEntityDedupeMergeGroup } from '../dedupeResearchEntitiesByPi';

const SURVIVOR_SLUG = 'fixture-survivor-lab';
const TWIN_SLUG = 'fixture-twin-center';
const SURVIVOR_PAGE = 'https://fixture-survivor.example.edu/';
const TWIN_PAGE = 'https://fixture-twin.example.edu/';

describe('a PI-dedupe merge keeps merged-in identity readings off the survivor (#6183)', () => {
  let replSet: MongoMemoryReplSet;
  let survivorId: mongoose.Types.ObjectId;
  let twinId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    resetOrgUnitCanonicalizerCache();
    await mongoose.disconnect();
    await replSet?.stop();
  });

  const observe = (
    entityId: mongoose.Types.ObjectId,
    entityKey: string,
    field: string,
    value: unknown,
    sourceUrl: string,
    confidence: number,
  ) =>
    Observation.create({
      entityType: 'researchEntity',
      entityId,
      entityKey,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'fixture-lane',
      sourceUrl,
      confidence,
      observedAt: new Date('2026-10-01T00:00:00Z'),
      superseded: false,
    });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'research_entities',
      'research_entity_redirects',
      'role_assignments',
      'observations',
      'org_units',
    ]) {
      await db.collection(name).deleteMany({});
    }
    for (const [slug, name] of [
      ['school-of-medicine', 'School of Medicine'],
      ['school-of-public-health', 'School of Public Health'],
    ] as const) {
      await OrgUnit.create({ slug, name, kind: 'SCHOOL', status: 'ACTIVE' });
    }
    resetOrgUnitCanonicalizerCache();

    survivorId = new mongoose.Types.ObjectId();
    twinId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertMany([
      {
        _id: survivorId,
        slug: SURVIVOR_SLUG,
        name: 'Fixture Survivor Lab',
        kind: 'lab',
        entityType: 'LAB',
        school: 'School of Public Health',
        schools: ['School of Public Health'],
        websiteUrl: SURVIVOR_PAGE,
        sourceUrls: [SURVIVOR_PAGE],
        archived: false,
        studentVisibilityTier: 'student_ready',
      },
      {
        _id: twinId,
        slug: TWIN_SLUG,
        name: 'Fixture Twin Lab',
        kind: 'center',
        entityType: 'CENTER',
        school: 'School of Medicine',
        schools: ['School of Medicine'],
        websiteUrl: TWIN_PAGE,
        sourceUrls: [TWIN_PAGE],
        archived: false,
        studentVisibilityTier: 'student_ready',
      },
    ]);

    await observe(survivorId, SURVIVOR_SLUG, 'name', 'Fixture Survivor Lab', SURVIVOR_PAGE, 0.7);
    await observe(
      survivorId,
      SURVIVOR_SLUG,
      'school',
      'School of Public Health',
      SURVIVOR_PAGE,
      0.7,
    );
    await observe(survivorId, SURVIVOR_SLUG, 'entityType', 'LAB', SURVIVOR_PAGE, 0.7);
    await observe(survivorId, SURVIVOR_SLUG, 'kind', 'lab', SURVIVOR_PAGE, 0.7);
    await observe(survivorId, SURVIVOR_SLUG, 'websiteUrl', SURVIVOR_PAGE, SURVIVOR_PAGE, 0.7);
    await observe(
      survivorId,
      SURVIVOR_SLUG,
      'inferredPiUserKey',
      'netid:fixture-001',
      SURVIVOR_PAGE,
      0.7,
    );

    await observe(twinId, TWIN_SLUG, 'name', 'Fixture Twin Lab', TWIN_PAGE, 0.95);
    await observe(twinId, TWIN_SLUG, 'school', 'School of Medicine', TWIN_PAGE, 0.95);
    await observe(twinId, TWIN_SLUG, 'entityType', 'CENTER', TWIN_PAGE, 0.95);
    await observe(twinId, TWIN_SLUG, 'kind', 'center', TWIN_PAGE, 0.95);
    await observe(twinId, TWIN_SLUG, 'websiteUrl', TWIN_PAGE, TWIN_PAGE, 0.95);
    await observe(twinId, TWIN_SLUG, 'inferredPiUserKey', 'netid:fixture-002', TWIN_PAGE, 0.95);

    await applyResearchEntityDedupeMergeGroup(
      {
        canonicalEntityId: survivorId.toHexString(),
        duplicateEntityIds: [twinId.toHexString()],
        mergedDepartments: [],
        mergedResearchAreas: [],
        mergedSourceUrls: [SURVIVOR_PAGE],
      },
      { deleteDuplicates: false, relinkReferences: true },
    );
  });

  const plan = async () => {
    const result = await materializeEntity(
      'researchEntity',
      { entityKey: SURVIVOR_SLUG },
      { dryRun: true },
    );
    return (result.plannedSet ?? {}) as Record<string, unknown>;
  };

  const stored = async () =>
    (await ResearchEntity.findById(survivorId).lean()) as Record<string, unknown> | null;

  it('re-points the merged-in readings onto the survivor through the real merge path', async () => {
    const twinReadings = await Observation.find({ entityKey: TWIN_SLUG }).lean();
    expect(twinReadings.length).toBeGreaterThan(0);
    expect(twinReadings.every((o) => String(o.entityId) === survivorId.toHexString())).toBe(true);
    expect((await ResearchEntity.findById(twinId).lean())?.archived).toBe(true);
  });

  it.each([
    ['school', 'School of Public Health'],
    ['entityType', 'LAB'],
    ['kind', 'lab'],
    ['inferredPiUserKey', 'netid:fixture-001'],
  ])('resolves the survivor %s from its own readings only', async (field, own) => {
    const planned = await plan();
    const survivor = await stored();
    expect(field in planned ? planned[field] : survivor?.[field]).toBe(own);
  });

  it('still lets the re-pointed name and website readings compete as the survivor own, as today', async () => {
    const planned = await plan();
    expect(planned.name).toBe('Fixture Twin Lab');
    expect(planned.websiteUrl).toBe(TWIN_PAGE);
  });
});
