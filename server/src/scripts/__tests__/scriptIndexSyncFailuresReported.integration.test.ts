import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async (_entityType: string, _docs: unknown[]) => 0),
}));

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
}));

vi.mock('../../services/studentVisibilityGateService', async (importActual) => ({
  ...(await importActual<typeof import('../../services/studentVisibilityGateService')>()),
  runStudentVisibilityGate: vi.fn(async () => ({ counts: { changed: 0 } })),
  planStudentVisibilityGate: vi.fn(async () => []),
  applyStudentVisibilityGatePlans: vi.fn(async () => undefined),
  runStudentVisibilityGateForPlans: vi.fn(async () => ({ counts: {} })),
}));

vi.mock('../backfillSchoolHostMismatchCore', async (importActual) => ({
  ...(await importActual<typeof import('../backfillSchoolHostMismatchCore')>()),
  planSchoolHostMismatchRow: vi.fn(async (entity: { id: string; slug?: string }) => ({
    id: entity.id,
    slug: entity.slug,
    evidenceUrl: 'https://synthetic.example.edu/lab',
    beforeSchool: 'Synthetic School A',
    afterSchool: 'Synthetic School B',
    beforeSchools: [],
    afterSchools: ['Synthetic School B'],
    update: { school: 'Synthetic School B' },
  })),
}));

vi.mock('../backfillSchoolFromProfileHostCore', async (importActual) => ({
  ...(await importActual<typeof import('../backfillSchoolFromProfileHostCore')>()),
  planSchoolProfileHostRow: vi.fn(async (entity: { id: string; slug?: string }) => ({
    id: entity.id,
    slug: entity.slug,
    evidenceUrl: 'https://synthetic.example.edu/profile',
    observedAt: new Date('2026-01-01T00:00:00.000Z'),
    afterSchool: 'Synthetic School B',
    afterSchools: ['Synthetic School B'],
    update: { school: 'Synthetic School B' },
  })),
}));

vi.mock('../orgUnitSchoolAssertion', async (importActual) => ({
  ...(await importActual<typeof import('../orgUnitSchoolAssertion')>()),
  assertInferredSchoolObservation: vi.fn(async () => ({})),
}));

vi.mock('../../services/researchEntityMembershipAccessor', async (importActual) => ({
  ...(await importActual<typeof import('../../services/researchEntityMembershipAccessor')>()),
  getResearchEntityRosterByEntityId: vi.fn(
    async (ids: unknown[]) => new Map(ids.map((id) => [String(id), [{}]])),
  ),
}));

vi.mock('../retireForeignLeadGraftsCore', async (importActual) => ({
  ...(await importActual<typeof import('../retireForeignLeadGraftsCore')>()),
  buildGateLeadRow: vi.fn(() => ({})),
  planForeignLeadGraftRetirement: vi.fn(
    ({ entity }: { entity: { _id: unknown; slug?: string } }) => ({
      entityId: String(entity._id),
      slug: entity.slug,
      roleAssignmentIds: [],
      personIds: [],
      graftedLeadNames: [],
      remainingGateLeadCount: 1,
    }),
  ),
}));

vi.mock('../promoteFacultyResearchToLabCore', async (importActual) => {
  const actual = await importActual<typeof import('../promoteFacultyResearchToLabCore')>();
  return {
    ...actual,
    planFacultyResearchPromotion: vi.fn((inputs: Array<{ id: unknown; slug?: string }>) =>
      inputs.map((input) => ({
        ...input,
        decision: 'PROMOTE',
        toKind: true,
        websiteUrl: 'https://synthetic.example.edu/lab',
      })),
    ),
  };
});

vi.mock('../personCentricLabDescriptionBackfillCore', async (importActual) => ({
  ...(await importActual<typeof import('../personCentricLabDescriptionBackfillCore')>()),
  selectPersonCentricLabDescriptionTargets: vi.fn((docs: unknown[]) => docs),
  planPersonCentricLabDescriptionRewrite: vi.fn(() => ({
    hasWrites: true,
    action: 'cleared',
    set: { fullDescription: '' },
  })),
  filterPersonCentricLabDescriptionPlanByManualLocks: vi.fn((plan: unknown) => plan),
}));

import { runYaleStatusCacheBackfill } from '../backfillYaleStatusCache';
import { regateAndResyncTouchedEntities } from '../retireListingItemResearchAreas';
import { reindexChangedSlugs } from '../purgeSameNameCollisionAreaGrafts';
import { regateRematerializedEntities } from '../rematerializeResearchEntities';
import { runSchoolHostMismatchBackfill } from '../backfillSchoolHostMismatch';
import { DISJOINT_SCHOOLS } from '../backfillSchoolHostMismatchCore';
import { runSchoolProfileHostBackfill } from '../backfillSchoolFromProfileHost';
import { runForeignLeadGraftRetirement } from '../retireForeignLeadGrafts';
import { PROMOTABLE_SOURCE_ENTITY_TYPE } from '../promoteFacultyResearchToLabCore';
import { runFacultyResearchPromotion } from '../promoteFacultyResearchToLab';
import { runPersonCentricLabDescriptionBackfill } from '../personCentricLabDescriptionBackfill';

const SLUG = 'synthetic-index-sync-lab';

const researchEntities = () => mongoose.connection.db!.collection('research_entities');

const seedOne = async (fields: Record<string, unknown> = {}): Promise<string> => {
  const _id = new mongoose.Types.ObjectId();
  await researchEntities().insertOne({
    _id,
    slug: SLUG,
    name: 'Synthetic Index Sync Lab',
    archived: false,
    ...fields,
  });
  return _id.toHexString();
};

const refuseEveryIndexWrite = () => meiliMocks.syncEntities.mockResolvedValue(0);
const acceptEveryIndexWrite = () =>
  meiliMocks.syncEntities.mockImplementation(async (_entityType, docs) => docs.length);

describe('a refused index sync reaches each script report as a failure (#3726)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    meiliMocks.syncEntities.mockReset();
    refuseEveryIndexWrite();
    const db = mongoose.connection.db!;
    for (const name of ['research_entities', 'observations', 'sources', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const guard = { environment: 'development' as const, dbLabel: 'synthetic' };

  it('research:backfill-yale-status-cache', async () => {
    await seedOne({ activeAtYaleCache: false, yaleStatusCache: 'departed' });
    const options = {
      apply: true,
      confirmYaleStatusCacheBackfill: true,
      limit: 10,
      output: undefined,
    };

    const refused = await runYaleStatusCacheBackfill(options, guard);
    expect(refused.writtenThisRun).toBe(1);
    expect(refused).toMatchObject({ indexResynced: 0, indexSyncFailures: 1 });

    await researchEntities().updateOne(
      { slug: SLUG },
      { $set: { activeAtYaleCache: false, yaleStatusCache: 'departed' } },
    );
    acceptEveryIndexWrite();
    const accepted = await runYaleStatusCacheBackfill(options, guard);
    expect(accepted).toMatchObject({ indexResynced: 1, indexSyncFailures: 0 });
  });

  it('research-areas:retire-listing-item-harvests', async () => {
    const id = await seedOne();

    expect(await regateAndResyncTouchedEntities([id])).toEqual({
      visibilityTierChanges: 0,
      resyncedEntities: 0,
      indexSyncFailures: 1,
    });
    acceptEveryIndexWrite();
    expect(await regateAndResyncTouchedEntities([id])).toMatchObject({
      resyncedEntities: 1,
      indexSyncFailures: 0,
    });
  });

  it('purgeSameNameCollisionAreaGrafts', async () => {
    await seedOne();

    expect(await reindexChangedSlugs([SLUG])).toEqual({ resynced: 0, indexSyncFailures: 1 });
  });

  it('research-entity:rematerialize', async () => {
    const id = await seedOne();

    expect(await regateRematerializedEntities([id])).toMatchObject({
      indexResynced: 0,
      indexSyncFailures: 1,
    });
  });

  it('research:backfill-school-host-mismatch', async () => {
    await seedOne({ school: DISJOINT_SCHOOLS[0] });

    expect(await runSchoolHostMismatchBackfill({ dryRun: false })).toMatchObject({
      indexResynced: 0,
      indexSyncFailures: 1,
    });
  });

  it('research:backfill-school-from-profile-host', async () => {
    await seedOne();

    expect(await runSchoolProfileHostBackfill({ dryRun: false })).toMatchObject({
      indexResynced: 0,
      indexSyncFailures: 1,
    });
  });

  it('research:retire-foreign-lead-grafts', async () => {
    await seedOne();

    expect(
      await runForeignLeadGraftRetirement({ dryRun: false, slugs: [SLUG], entityIds: [] }),
    ).toMatchObject({ indexResynced: 0, indexSyncFailures: 1 });
  });

  it('research-entity:promote-faculty-research-to-lab', async () => {
    await seedOne({ entityType: PROMOTABLE_SOURCE_ENTITY_TYPE, kind: 'faculty-research-area' });
    await mongoose.connection.db!.collection('sources').insertOne({ name: 'lab-site-type-probe' });

    const result = await runFacultyResearchPromotion({
      dryRun: false,
      probe: async () => new Map(),
    });

    expect(result).toMatchObject({ updated: 1, synced: 0, indexSyncFailures: 1, errors: 0 });
  });

  it('research-entity:person-centric-lab-descriptions', async () => {
    await seedOne({ fullDescription: 'Synthetic person-centric prose.' });

    const result = await runPersonCentricLabDescriptionBackfill({
      dryRun: false,
      fetchPage: async () => null,
      log: () => {},
    });

    expect(result).toMatchObject({ entitiesChanged: 1, meiliSynced: 0, indexSyncFailures: 1 });
  });
});
