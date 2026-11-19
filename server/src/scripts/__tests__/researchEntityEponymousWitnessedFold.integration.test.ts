import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', () => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../services/studentVisibilityGateService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/studentVisibilityGateService')>()),
  runStudentVisibilityGate: vi.fn(async () => ({ counts: { scanned: 0 } })),
  planStudentVisibilityGate: vi.fn(async () => []),
}));

import { loadSamePiCandidateRows } from '../dedupeResearchEntitiesByPi';
import { runEponymousFraLabMergeStage } from '../researchEntityEponymousMergeStage';

describe('a witnessed fold keeps every co-director of the lab (#5969)', () => {
  let replSet: MongoMemoryReplSet;
  const leadId = new mongoose.Types.ObjectId();
  const coDirectorId = new mongoose.Types.ObjectId();
  const facultyRowId = new mongoose.Types.ObjectId();
  const labId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'role_assignments', 'researchers', 'observations']) {
      await db.collection(name).deleteMany({});
    }
    await db.collection('researchers').insertMany([
      { _id: leadId, displayName: 'Ada Alpha', archived: false },
      { _id: coDirectorId, displayName: 'Bram Orlo', archived: false },
    ]);
    await db.collection('research_entities').insertMany([
      {
        _id: facultyRowId,
        slug: 'ysm-faculty-ada-alpha',
        name: 'Ada Alpha Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        archived: false,
      },
      {
        _id: labId,
        slug: 'synthetic-family-safety-collaborative',
        name: 'Synthetic Family Safety Collaborative',
        entityType: 'LAB',
        websiteUrl: 'https://medicine.yale.edu/lab/synthetic-family-safety/',
        archived: false,
      },
    ]);
    const edge = (
      personId: mongoose.Types.ObjectId,
      id: mongoose.Types.ObjectId,
      role: string,
    ) => ({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id },
      role,
      state: 'CURRENT',
      archived: false,
    });
    await db
      .collection('role_assignments')
      .insertMany([
        edge(leadId, facultyRowId, 'PI'),
        edge(leadId, labId, 'CO_DIRECTOR'),
        edge(coDirectorId, labId, 'CO_DIRECTOR'),
      ]);
  });

  const run = (apply: boolean) =>
    runEponymousFraLabMergeStage({
      apply,
      maxMerges: 10,
      sinceIso: '2020-01-01T00:00:00Z',
      loadRows: () =>
        loadSamePiCandidateRows(100, { includeRetiredMembers: false, personIds: [leadId] }),
      ballotPairs: [
        { label: 'P99', facultyRowId: facultyRowId.toHexString(), labId: labId.toHexString() },
      ],
    });

  it('plans the ballot fold in a dry run and writes nothing', async () => {
    const delta = await run(false);
    expect(delta.witnessedFolds.map((fold) => [fold.label, fold.witness])).toEqual([
      ['P99', 'ballot'],
    ]);
    expect(delta.appliedMergeCount).toBe(0);
    expect(
      await mongoose.connection
        .db!.collection('research_entities')
        .countDocuments({ _id: facultyRowId, archived: { $ne: true } }),
    ).toBe(1);
  });

  it('folds the row into the lab and leaves both co-directors leading the survivor', async () => {
    const delta = await run(true);
    expect(delta.appliedMergeCount).toBe(1);
    const db = mongoose.connection.db!;
    expect(
      await db
        .collection('research_entities')
        .countDocuments({ _id: facultyRowId, archived: true }),
    ).toBe(1);
    const live = await db
      .collection('role_assignments')
      .find({ 'target.id': labId, state: { $ne: 'HISTORICAL' }, archived: { $ne: true } })
      .toArray();
    expect(live.map((edge) => `${String(edge.personId)}:${edge.role}`).sort()).toEqual(
      [
        `${String(leadId)}:CO_DIRECTOR`,
        `${String(leadId)}:PI`,
        `${String(coDirectorId)}:CO_DIRECTOR`,
      ].sort(),
    );
    const second = await run(true);
    expect(second.witnessedFolds).toEqual([]);
    expect(second.appliedMergeCount).toBe(0);
  });
});
