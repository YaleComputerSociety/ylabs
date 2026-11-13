import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { writeCanonicalMembership } from '../../scrapers/canonicalMembershipMaterializer';
import { findOrCreateForOwner } from '../researchGroupService';
import {
  attemptVisibilityRepair,
  buildVisibilityRepairPlan,
  defaultRepairDeps,
} from '../visibilityRepairQueueService';

const PROFILE = 'https://medicine.yale.edu/profile/ada-quill/';

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
  for (const name of [
    'research_entities',
    'role_assignments',
    'researchers',
    'directory_removals',
  ]) {
    await mongoose.connection.db!.collection(name).deleteMany({});
  }
});

const seed = async (edge?: Record<string, unknown>) => {
  const person = await Researcher.create({
    displayName: 'Ada Quill',
    profileLinks: [
      {
        kind: 'YALE_OFFICIAL',
        purpose: 'PRIMARY_IDENTITY',
        url: PROFILE,
        verifiedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ],
    archived: false,
  });
  const row = await ResearchEntity.create({
    slug: 'ysm-faculty-ada-quill',
    name: 'Ada Quill Faculty Research',
    entityType: 'FACULTY_RESEARCH_AREA',
    sourceUrls: [PROFILE],
    archived: false,
  });
  const edgeId = new mongoose.Types.ObjectId();
  if (edge) {
    await RoleAssignment.collection.insertOne({
      _id: edgeId,
      personId: person._id,
      target: { kind: 'RESEARCH_ENTITY', id: row._id },
      role: 'PI',
      confidence: 0.4,
      rosterProvenance: { sourceName: 'synthetic-roster', sourceUrl: PROFILE },
      ...edge,
    });
  }
  return { personId: person._id, rowId: row._id, edgeId };
};

const DISPUTED = {
  state: 'UNKNOWN',
  archived: true,
  reviewStatus: 'DISPUTED',
  reviewNotes: 'synthetic detachment',
};

const OPERATOR_ENDED = {
  state: 'HISTORICAL',
  archived: false,
  reviewStatus: 'UNREVIEWED',
  endedAt: new Date('2025-12-31T00:00:00.000Z'),
  operatorEnd: {
    endedAt: new Date('2025-12-31T00:00:00.000Z'),
    reason: 'synthetic operator end',
    citationUrl: PROFILE,
    decidedBy: 'agent',
    recordedAt: new Date('2026-11-12T00:00:00.000Z'),
    previousState: 'UNKNOWN',
  },
};

const repair = (rowId: mongoose.Types.ObjectId) =>
  attemptVisibilityRepair(
    buildVisibilityRepairPlan({
      _id: 'queue-1',
      collection: 'research',
      recordId: String(rowId),
      label: 'Queued Row',
      blockerReasons: ['missing_lead'],
      sourceNames: ['ysm-faculty-directory'],
    }),
    'apply',
    { ...defaultRepairDeps, runGate: vi.fn().mockResolvedValue({}) },
  );

const rawEdges = async (rowId: mongoose.Types.ObjectId) =>
  mongoose.connection
    .db!.collection('role_assignments')
    .find({ 'target.id': rowId })
    .sort({ _id: 1 })
    .toArray();

describe('the repair queue never touches a refusal edge (#5979)', () => {
  it('blocks on a disputed same-triple edge and leaves it byte-identical', async () => {
    const { rowId } = await seed(DISPUTED);
    const before = await rawEdges(rowId);
    const attempt = await repair(rowId);

    expect(attempt).toMatchObject({ applied: false, status: 'blocked' });
    expect(attempt.remainingBlockers).toContain('lead_edge_disputed');
    expect(await rawEdges(rowId)).toEqual(before);
  });

  it('blocks on an operator-ended same-triple edge and leaves it byte-identical', async () => {
    const { rowId } = await seed(OPERATOR_ENDED);
    const before = await rawEdges(rowId);
    const attempt = await repair(rowId);

    expect(attempt).toMatchObject({ applied: false, status: 'blocked' });
    expect(attempt.remainingBlockers).toContain('lead_edge_operator_ended');
    expect(await rawEdges(rowId)).toEqual(before);
  });

  it('still patches a missing lead with no same-triple edge', async () => {
    const { personId, rowId } = await seed();
    const attempt = await repair(rowId);

    expect(attempt).toMatchObject({ applied: true });
    const edges = await rawEdges(rowId);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ personId, role: 'PI', state: 'CURRENT', archived: false });
  });

  it('keeps a lane re-assertion off a disputed edge too', async () => {
    const { personId, rowId } = await seed(DISPUTED);
    const before = await rawEdges(rowId);
    const write = await writeCanonicalMembership(
      String(rowId),
      {
        legacyRole: 'pi',
        displayName: 'Ada Quill',
        isCurrentMember: true,
        confidence: 0.7,
        rosterProvenance: { sourceName: 'dept-faculty-roster', sourceUrl: PROFILE },
      },
      { displayName: 'Ada Quill', hasCanonicalSourceReference: true, resolvedPersonId: personId },
    );

    expect(write.outcome).toBe('refused-disputed-edge');
    expect(await rawEdges(rowId)).toEqual(before);
  });

  it('still refreshes a live edge when a disputed twin sits beside it', async () => {
    const { personId, rowId } = await seed(DISPUTED);
    const liveEdgeId = new mongoose.Types.ObjectId();
    await RoleAssignment.collection.insertOne({
      _id: liveEdgeId,
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: rowId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      reviewStatus: 'UNREVIEWED',
      confidence: 0.5,
    });
    const write = await writeCanonicalMembership(
      String(rowId),
      {
        legacyRole: 'pi',
        displayName: 'Ada Quill',
        isCurrentMember: true,
        confidence: 0.7,
        rosterProvenance: { sourceName: 'dept-faculty-roster', sourceUrl: PROFILE },
      },
      { displayName: 'Ada Quill', hasCanonicalSourceReference: true, resolvedPersonId: personId },
    );

    expect(write.outcome).toBe('updated');
    const edges = await rawEdges(rowId);
    expect(edges.find((edge) => edge.reviewStatus === 'DISPUTED')).toMatchObject(DISPUTED);
    const live = edges.find((edge) => String(edge._id) === String(liveEdgeId));
    expect(live).toMatchObject({ archived: false, confidence: 0.7 });
    expect(live?.rosterProvenance?.sourceName).toBe('dept-faculty-roster');
  });

  it('keeps the owner PI write off a disputed edge on the owner slug row', async () => {
    const owner = { netid: 'aq9001', fname: 'Ada', lname: 'Quill' };
    const first = await findOrCreateForOwner(owner);
    const ownerRowId = first.group._id as mongoose.Types.ObjectId;
    const ownerEdge = await RoleAssignment.findOne({ 'target.id': ownerRowId, role: 'PI' }).lean();
    const ownerPersonId = ownerEdge!.personId;
    await RoleAssignment.collection.deleteMany({});
    await RoleAssignment.collection.insertOne({
      personId: ownerPersonId,
      target: { kind: 'RESEARCH_ENTITY', id: new mongoose.Types.ObjectId() },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      reviewStatus: 'UNREVIEWED',
      confidence: 1,
    });
    await RoleAssignment.collection.insertOne({
      personId: ownerPersonId,
      target: { kind: 'RESEARCH_ENTITY', id: ownerRowId },
      role: 'PI',
      confidence: 0.4,
      endedAt: new Date('2026-02-01T00:00:00.000Z'),
      ...DISPUTED,
    });
    const before = await rawEdges(ownerRowId);

    const second = await findOrCreateForOwner(owner);

    expect(String(second.group._id)).toBe(String(ownerRowId));
    expect(second.created).toBe(false);
    expect(await rawEdges(ownerRowId)).toEqual(before);
  });
});
