import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  return {
    ...actual,
    recomputeBrowseRankForEntities: vi.fn().mockResolvedValue({ updated: 0, indexSyncFailures: 0 }),
  };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { writeCanonicalMembership } from '../canonicalMembershipMaterializer';
import { materializeEntity } from '../entityMaterializer';

const SITE = 'https://synthetic.yale.edu/lab/humanitarian/';
const ENDED_AT = new Date('2025-12-31T00:00:00.000Z');

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});

beforeEach(async () => {
  for (const name of ['observations', 'research_entities', 'role_assignments', 'researchers']) {
    await mongoose.connection.db!.collection(name).deleteMany({});
  }
});

const seedOperatorEndedLab = async () => {
  const person = await Researcher.create({ displayName: 'Ada Quill', archived: false });
  const row = await ResearchEntity.create({
    slug: 'synthetic-humanitarian-lab',
    name: 'Synthetic Humanitarian Lab',
    entityType: 'LAB',
    websiteUrl: SITE,
    sourceUrls: [SITE],
    archived: false,
  });
  await RoleAssignment.collection.insertOne({
    personId: person._id,
    target: { kind: 'RESEARCH_ENTITY', id: row._id },
    role: 'PI',
    state: 'HISTORICAL',
    endedAt: ENDED_AT,
    confidence: 0.7,
    reviewStatus: 'UNREVIEWED',
    archived: false,
    rosterProvenance: { sourceName: 'dept-faculty-roster', sourceUrl: SITE },
    operatorEnd: {
      endedAt: ENDED_AT,
      reason: 'operator end: the page states the founder stepped down',
      citationUrl: SITE,
      decidedBy: 'agent',
      recordedAt: new Date('2026-11-12T00:00:00.000Z'),
      previousState: 'UNKNOWN',
    },
  });
  await Observation.create({
    entityType: 'researchEntity',
    entityKey: row.slug,
    field: 'inferredPiUserId',
    value: person._id.toString(),
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'dept-faculty-roster',
    sourceUrl: SITE,
    confidence: 0.7,
    observedAt: new Date('2026-11-12T00:00:00.000Z'),
    superseded: false,
  });
  return { personId: person._id, row };
};

const leadEdges = (personId: mongoose.Types.ObjectId) =>
  RoleAssignment.find({ personId }).lean<Array<{ state: string; operatorEnd?: unknown }>>();

describe('an operator-ended lead edge under lead-edge resolution (#5979)', () => {
  it('plans no new lead edge for the person in a dry run', async () => {
    const { personId, row } = await seedOperatorEndedLab();
    const plan = (
      await materializeEntity(
        'researchEntity',
        { entityKey: row.slug },
        { leadEdgesOnly: true, dryRun: true },
      )
    ).leadEdgeResolution;

    expect(plan?.asserted.filter((edge) => edge.personId === String(personId))).toEqual([]);
  });

  it('writes no new lead edge for the person on apply, scoped or full', async () => {
    const { personId, row } = await seedOperatorEndedLab();
    const scoped = (
      await materializeEntity('researchEntity', { entityKey: row.slug }, { leadEdgesOnly: true })
    ).leadEdgeResolution;
    await materializeEntity('researchEntity', { entityKey: row.slug }, {});

    const edges = await leadEdges(personId);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ state: 'HISTORICAL' });
    expect(scoped?.asserted.filter((edge) => edge.personId === String(personId))).toEqual([]);
  });

  it('writes no new director edge for an operator-ended director', async () => {
    const { personId, row } = await seedOperatorEndedLab();
    await RoleAssignment.updateOne({ personId }, { $set: { role: 'DIRECTOR' } });
    const write = await writeCanonicalMembership(
      String(row._id),
      {
        legacyRole: 'director',
        displayName: 'Ada Quill',
        isCurrentMember: true,
        confidence: 0.9,
        rosterProvenance: { sourceName: 'center-director', sourceUrl: SITE },
      },
      { displayName: 'Ada Quill', hasCanonicalSourceReference: true, resolvedPersonId: personId },
    );

    expect(write.outcome).toBe('refused-operator-ended');
    const edges = await leadEdges(personId);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ state: 'HISTORICAL' });
  });
});
