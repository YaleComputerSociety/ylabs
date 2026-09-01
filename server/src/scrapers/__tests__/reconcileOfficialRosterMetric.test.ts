import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { RoleAssignment } from '../../models/roleAssignment';
import { materializeFromRun } from '../entityMaterializer';

const OFFICIAL_ROSTER_SOURCE_NAME = 'official-research-home-roster';

describe('reconcileOfficialRosterSnapshotsFromRun archive metric', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'observations', 'scrape_runs', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const departingAssignment = (
    personId: mongoose.Types.ObjectId,
    entityId: mongoose.Types.ObjectId,
    role: string,
    membershipKey: string,
  ) => ({
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: entityId },
    role,
    state: 'CURRENT',
    archived: false,
    confidence: 0.9,
    reviewStatus: 'APPROVED',
    evidenceClaimIds: [],
    rosterProvenance: {
      sourceName: OFFICIAL_ROSTER_SOURCE_NAME,
      membershipKey,
    },
  });

  it('counts each departing person once even when they hold several departing assignments', async () => {
    const sourceId = new mongoose.Types.ObjectId();
    const entity = await ResearchEntity.create({
      slug: 'reconcile-metric-lab',
      name: 'Reconcile Metric Lab',
      kind: 'lab',
      archived: false,
    });
    const scrapeRun = await ScrapeRun.create({
      sourceId,
      sourceName: OFFICIAL_ROSTER_SOURCE_NAME,
      startedAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    await Observation.create({
      entityType: 'researchEntity',
      entityKey: entity.slug,
      field: 'rosterEnrichment',
      value: {
        complete: true,
        memberKeys: ['retained-key'],
        observedAt: '2026-07-01T00:00:00.000Z',
      },
      sourceId,
      sourceName: OFFICIAL_ROSTER_SOURCE_NAME,
      scrapeRunId: scrapeRun._id,
      confidence: 1,
      observedAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    const personWithTwoRoles = new mongoose.Types.ObjectId();
    const personWithOneRole = new mongoose.Types.ObjectId();
    const retainedPerson = new mongoose.Types.ObjectId();

    await RoleAssignment.create(
      departingAssignment(personWithTwoRoles, entity._id, 'STAFF', 'departing-staff'),
    );
    await RoleAssignment.create(
      departingAssignment(personWithTwoRoles, entity._id, 'AFFILIATED', 'departing-affiliated'),
    );
    await RoleAssignment.create(
      departingAssignment(personWithOneRole, entity._id, 'POSTDOC', 'departing-postdoc'),
    );
    await RoleAssignment.create(
      departingAssignment(retainedPerson, entity._id, 'PI', 'retained-key'),
    );

    await materializeFromRun(scrapeRun._id.toString());

    const persisted = await ScrapeRun.findById(scrapeRun._id).lean<{ entitiesArchived: number }>();
    expect(persisted?.entitiesArchived).toBe(2);

    const historical = await RoleAssignment.find({ state: 'HISTORICAL' }).select('personId').lean();
    const archivedPersonKeys = new Set(historical.map((a: any) => a.personId.toString()));
    expect(archivedPersonKeys).toEqual(
      new Set([personWithTwoRoles.toString(), personWithOneRole.toString()]),
    );

    const retained = await RoleAssignment.findOne({ personId: retainedPerson }).lean<{
      state: string;
    }>();
    expect(retained?.state).toBe('CURRENT');
  });
});
