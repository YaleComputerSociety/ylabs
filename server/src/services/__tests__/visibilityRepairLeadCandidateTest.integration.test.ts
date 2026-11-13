import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
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

const seed = async (title: string) => {
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
    profile: { title },
    archived: false,
  });
  const row = await ResearchEntity.create({
    slug: 'ysm-faculty-ada-quill',
    name: 'Ada Quill Faculty Research',
    entityType: 'FACULTY_RESEARCH_AREA',
    sourceUrls: [PROFILE],
    archived: false,
  });
  return { personId: person._id, rowId: row._id };
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

const rawEdges = (rowId: mongoose.Types.ObjectId) =>
  mongoose.connection
    .db!.collection('role_assignments')
    .find({ 'target.id': rowId })
    .sort({ _id: 1 })
    .toArray();

describe("the repair queue's PI identity stage asks the gate's lead test (#5979)", () => {
  it('blocks a postdoc-titled match and writes nothing', async () => {
    const { rowId } = await seed('Postdoctoral Associate');
    const attempt = await repair(rowId);

    expect(attempt).toMatchObject({ applied: false, status: 'blocked' });
    expect(attempt.remainingBlockers).toEqual(
      expect.arrayContaining(['missing_lead', 'lead_candidate_cannot_own_research_home']),
    );
    expect(await rawEdges(rowId)).toEqual([]);
  });

  it('blocks a match that already holds a live lead edge and leaves it byte-identical', async () => {
    const { personId, rowId } = await seed('Postdoctoral Associate');
    await mongoose.connection.db!.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: rowId },
      role: 'PI',
      state: 'UNKNOWN',
      archived: false,
      reviewStatus: 'UNREVIEWED',
      confidence: 0.7,
      rosterProvenance: { sourceName: 'dept-faculty-roster', sourceUrl: PROFILE },
    });
    const before = await rawEdges(rowId);
    const attempt = await repair(rowId);

    expect(attempt).toMatchObject({ applied: false, status: 'blocked' });
    expect(attempt.remainingBlockers).toEqual(
      expect.arrayContaining(['missing_lead', 'lead_candidate_already_leads']),
    );
    expect(await rawEdges(rowId)).toEqual(before);
  });

  it('still patches a faculty match', async () => {
    const { personId, rowId } = await seed('Associate Professor of Medicine');
    const attempt = await repair(rowId);

    expect(attempt).toMatchObject({ applied: true });
    expect(attempt.remainingBlockers).not.toContain('missing_lead');
    const edges = await rawEdges(rowId);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ personId, role: 'PI', archived: false });
  });
});
