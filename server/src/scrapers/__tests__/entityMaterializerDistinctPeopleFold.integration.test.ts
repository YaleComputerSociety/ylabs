import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearC4Flags } from './c4FlagTestEnv';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(true),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { materializeEntity } from '../entityMaterializer';

beforeEach(clearC4Flags);

const SITE = 'https://coastal-sediment.example.edu';

const observe = (entityKey: string, field: string, value: unknown, sourceName: string) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey,
    field,
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl: `${SITE}/people`,
    confidence: 0.9,
    observedAt: new Date('2026-09-01T00:00:00Z'),
    superseded: false,
  });

async function seedPeople(options: { verdict: boolean }) {
  const x = await Researcher.create({ displayName: 'Ada Quill' });
  const y = await Researcher.create({ displayName: 'Wren Ortolan' });
  if (options.verdict) {
    await Researcher.updateOne({ _id: x._id }, { $set: { distinctFromResearcherIds: [y._id] } });
  }
  return { x: x._id, y: y._id };
}

const leadEdge = (entityId: unknown, personId: unknown) =>
  RoleAssignment.create({
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: entityId },
    role: 'PI',
    state: 'CURRENT',
    confidence: 0.9,
    archived: false,
  });

describe('materializer folds honour a recorded distinct-people verdict (#5802)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await ResearchEntity.createIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    delete process.env.C4_RESOLVE_AT_MINT_ENTITIES;
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
  });

  async function mintAgainstAnotherPersonsSite(options: { verdict: boolean }) {
    process.env.C4_RESOLVE_AT_MINT_ENTITIES = 'true';
    const people = await seedPeople(options);
    await observe('quill-coastal-lab', 'name', 'Coastal Sediment Lab', 'lab-microsite');
    await observe('quill-coastal-lab', 'websiteUrl', SITE, 'lab-microsite');
    const first = await materializeEntity('researchEntity', { entityKey: 'quill-coastal-lab' });
    await leadEdge(first.entityId, people.x);

    await observe('ortolan-coastal-lab', 'name', 'Coastal Sediment Lab', 'lab-people-page');
    await observe('ortolan-coastal-lab', 'websiteUrl', SITE, 'lab-people-page');
    await observe('ortolan-coastal-lab', 'inferredPiUserId', String(people.y), 'lab-people-page');
    const second = await materializeEntity('researchEntity', { entityKey: 'ortolan-coastal-lab' });
    return { first, second, people };
  }

  it('resolve-at-mint mints its own row instead of adopting one led by a person recorded as distinct', async () => {
    const { first, second, people } = await mintAgainstAnotherPersonsSite({ verdict: true });
    expect(second.skipped).toBeUndefined();
    expect(second.created).toBe(true);
    expect(String(second.entityId ?? '')).not.toBe(String(first.entityId));
    expect(await ResearchEntity.countDocuments({ archived: { $ne: true } })).toBe(2);
    expect(
      await RoleAssignment.countDocuments({ 'target.id': first.entityId, personId: people.y }),
    ).toBe(0);
  });

  it('resolve-at-mint still adopts the same row when no verdict separates the two leads', async () => {
    const { first, second } = await mintAgainstAnotherPersonsSite({ verdict: false });
    expect(second.created).toBe(false);
    expect(String(second.entityId)).toBe(String(first.entityId));
  });

  async function foldDeptRosterShellOfAnotherPerson(options: { verdict: boolean }) {
    const people = await seedPeople(options);
    const lab = await ResearchEntity.create({
      slug: 'ada-quill-lab',
      name: 'Ada Quill Lab',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await leadEdge(lab._id, people.x);
    const key = 'dept-chemistry-ada-quill';
    await observe(key, 'name', 'Ada Quill Faculty Research', 'dept-faculty-roster');
    await observe(key, 'departments', ['Chemistry'], 'dept-faculty-roster');
    await observe(key, 'inferredPiUserId', String(people.y), 'dept-faculty-roster');
    await materializeEntity('researchEntity', { entityKey: key }, {});
    const shell = await ResearchEntity.findOne({ slug: key }).lean<{
      archived?: boolean;
      canonicalGroupId?: unknown;
    }>();
    return { shell, lab };
  }

  it('the dept-roster shell fold does not fold a shell led by a person recorded as distinct', async () => {
    const { shell } = await foldDeptRosterShellOfAnotherPerson({ verdict: true });
    expect(shell?.archived).not.toBe(true);
    expect(shell?.canonicalGroupId ?? null).toBeNull();
  });

  it('the dept-roster shell fold still folds the same shell when no verdict is recorded', async () => {
    const { shell, lab } = await foldDeptRosterShellOfAnotherPerson({ verdict: false });
    expect(shell?.archived).toBe(true);
    expect(String(shell?.canonicalGroupId)).toBe(String(lab._id));
  });
});
