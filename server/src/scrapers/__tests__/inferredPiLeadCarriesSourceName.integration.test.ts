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
import { materializeEntity } from '../entityMaterializer';
import {
  planNonOwnerPiEdgeRetirement,
  type NonOwnerPiEdgeRow,
} from '../../scripts/retireNonOwnerPiEdgesCore';

const ENTITY_KEY = 'ysm-source-name-fixture';
const LAB_URL = 'https://medicine.yale.edu/lab/fixture/';
const SOURCE_NAME = 'ysm-atoz-index';

describe('an inferred-PI lead edge carries the sourceName its retirement guard reads (#3254)', () => {
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

  const seed = async () => {
    const entity = await ResearchEntity.create({
      slug: ENTITY_KEY,
      name: 'Source Name Fixture Lab',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      archived: false,
      sourceUrls: [LAB_URL],
    });
    const account = await Account.create({
      netid: 'zz991',
      email: 'zz991@example.test',
      status: 'UNKNOWN',
      archived: false,
    });
    const researcher = await Researcher.create({
      displayName: 'Fixture Lead',
      accountId: account._id,
      profileLinks: [],
      archived: false,
      profile: { title: 'Postdoctoral Associate' },
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: ENTITY_KEY,
      field: 'inferredPiUserId',
      value: researcher._id.toString(),
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: SOURCE_NAME,
      sourceUrl: LAB_URL,
      confidence: 0.84,
      observedAt: new Date('2026-05-25T00:00:00Z'),
      superseded: false,
    });
    return { entityId: entity._id as mongoose.Types.ObjectId, personId: researcher._id };
  };

  const storedEdge = async (entityId: mongoose.Types.ObjectId) =>
    RoleAssignment.findOne({ 'target.id': entityId, role: 'PI' }).lean<{
      rosterProvenance?: { sourceName?: string; sourceUrl?: string };
    }>();

  it('writes rosterProvenance.sourceName, the field the guard reads, not only the url', async () => {
    const { entityId } = await seed();
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

    const edge = await storedEdge(entityId);
    expect(edge).toBeTruthy();
    expect(edge?.rosterProvenance?.sourceUrl).toBe(LAB_URL);
    expect(edge?.rosterProvenance?.sourceName).toBe(SOURCE_NAME);
  });

  it('makes the retirement lane refuse the edge as citing a source, which it could not before', async () => {
    const { entityId, personId } = await seed();
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});
    const edge = await storedEdge(entityId);

    const row: NonOwnerPiEdgeRow = {
      id: 'edge-1',
      personId: String(personId),
      entityId: String(entityId),
      role: 'PI',
      reviewStatus: 'UNREVIEWED',
      sourceName: edge?.rosterProvenance?.sourceName,
    };
    // The lead cannot host, so the only thing standing between this edge and a bulk
    // retirement is the provenance refusal.
    const plan = planNonOwnerPiEdgeRetirement(
      [row],
      () => true,
      new Map([[String(personId), 'Postdoctoral Associate']]),
    );
    expect(plan.retire).toEqual([]);
    expect(plan.refused[0]?.reason).toBe('edge-carries-provenance');
  });
});
