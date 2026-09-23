import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Account } from '../../models/account';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { getResearchEntityRoster } from '../../services/researchEntityMembershipAccessor';
import { materializeEntity } from '../entityMaterializer';

const ENTITY_KEY = 'ysm-disputed-edge-fixture';
const PROFILE_URL = 'https://medicine.yale.edu/profile/example-person/';
const DETACH_NOTE = 'Retired as a lead claim on someone whose title cannot own a research home.';

interface StoredRoleAssignment {
  archived?: boolean;
  reviewStatus?: string;
  reviewNotes?: string;
  role?: string;
}

describe('a materialize pass must not resurrect a disputed role edge (#3143)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'observations',
      'research_entities',
      'role_assignments',
      'researchers',
      'accounts',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedFixture = async () => {
    const entity = await ResearchEntity.create({
      slug: ENTITY_KEY,
      name: 'Disputed Edge Fixture Lab',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      archived: false,
      sourceUrls: [PROFILE_URL],
    });
    const account = await Account.create({
      netid: 'zz998',
      email: 'zz998@example.test',
      status: 'UNKNOWN',
      archived: false,
    });
    const researcher = await Researcher.create({
      displayName: 'Example Person',
      accountId: account._id,
      profileLinks: [],
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field: 'inferredPiUserId',
      value: researcher._id.toString(),
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'ysm-a-to-z-index',
      sourceUrl: PROFILE_URL,
      confidence: 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
    return { entityId: entity._id as mongoose.Types.ObjectId, personId: researcher._id };
  };

  const materialize = () => materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

  const storedEdges = (entityId: mongoose.Types.ObjectId) =>
    RoleAssignment.find({ 'target.id': entityId }).lean<StoredRoleAssignment[]>();

  it('mints a live PI edge on the first pass, then keeps a disputed detachment detached across the next pass', async () => {
    const { entityId } = await seedFixture();

    await materialize();
    const minted = await storedEdges(entityId);
    expect(minted).toHaveLength(1);
    expect(minted[0].role).toBe('PI');
    expect(minted[0].archived).toBe(false);

    await RoleAssignment.updateMany(
      { 'target.id': entityId, role: 'PI' },
      { $set: { archived: true, reviewStatus: 'DISPUTED', reviewNotes: DETACH_NOTE } },
    );

    await materialize();

    const afterRemat = await storedEdges(entityId);
    expect(afterRemat).toHaveLength(1);
    expect(afterRemat[0].archived).toBe(true);
    expect(afterRemat[0].reviewStatus).toBe('DISPUTED');
    expect(afterRemat[0].reviewNotes).toBe(DETACH_NOTE);

    const roster = await getResearchEntityRoster(entityId.toString());
    expect(roster.filter((entry) => entry.role === 'PI')).toHaveLength(0);
  });

  it('still re-attaches an edge archived without a recorded dispute, so the engine keeps its own supersede loop', async () => {
    const { entityId } = await seedFixture();

    await materialize();
    await RoleAssignment.updateMany(
      { 'target.id': entityId, role: 'PI' },
      { $set: { archived: true }, $unset: { reviewNotes: '' } },
    );

    await materialize();

    const afterRemat = await storedEdges(entityId);
    expect(afterRemat).toHaveLength(1);
    expect(afterRemat[0].archived).toBe(false);
  });
});
