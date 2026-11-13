import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { writeCanonicalMembership } from '../../scrapers/canonicalMembershipMaterializer';
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
    await RoleAssignment.collection.insertOne({
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

    expect(write.outcome).not.toBe('refused-disputed-edge');
    const edges = await rawEdges(rowId);
    expect(edges.find((edge) => edge.reviewStatus === 'DISPUTED')).toMatchObject(DISPUTED);
  });
});
