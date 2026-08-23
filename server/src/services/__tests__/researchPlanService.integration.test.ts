import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  addSavedResearchEntities,
  addWatchedPrograms,
  deleteSavedResearchEntityPlan,
  deleteWatchedProgramPlan,
  getSavedResearchEntityPlans,
  getWatchedProgramPlans,
  removeSavedResearchEntities,
  removeWatchedPrograms,
  updateSavedResearchEntityPlan,
  updateWatchedProgramPlan,
} from '../researchPlanService';

const NETID = 'teststud1';
const ENTITY_ID = new mongoose.Types.ObjectId('64a0000000000000000000ab');
const PROGRAM_ID = new mongoose.Types.ObjectId('64a0000000000000000000cd');

const plannedDeadline = { label: 'Submit application', dueAt: '2026-09-01T00:00:00.000Z' };
const plannedChecklist = [{ label: 'Read three papers', completed: false }];

let memoryReplSet: MongoMemoryReplSet | undefined;

const findPlan = (targetId: mongoose.Types.ObjectId) =>
  mongoose.connection.db!.collection('research_plans').findOne({ 'target.id': targetId });

describe('researchPlanService unsave/unwatch clears private plan data', () => {
  beforeAll(async () => {
    let mongoUrl = process.env.RESEARCH_PLAN_TEST_MONGO_URL;
    if (!mongoUrl) {
      memoryReplSet = await MongoMemoryReplSet.create({
        binary: { version: '8.0.12' },
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      mongoUrl = memoryReplSet.getUri('research_plan_test');
    }
    await mongoose.connect(mongoUrl);
  }, 120_000);

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    const db = mongoose.connection.db!;
    await db.collection('research_entities').insertOne({
      _id: ENTITY_ID,
      slug: 'test-lab',
      name: 'Test Lab',
      kind: 'group',
      departments: ['Computer Science'],
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await db.collection('fellowships').insertOne({
      _id: PROGRAM_ID,
      title: 'Test Program',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('clears saved-entity private notes on unsave and does not resurrect them on re-save', async () => {
    const entityId = ENTITY_ID.toHexString();
    await addSavedResearchEntities(NETID, [entityId]);
    await updateSavedResearchEntityPlan(NETID, entityId, {
      stage: 'CONTACTED',
      privateNotes: 'my private strategy notes',
      checklist: plannedChecklist,
      deadlines: [plannedDeadline],
    });

    const savedPlans = await getSavedResearchEntityPlans(NETID);
    expect(savedPlans[entityId].privateNotes).toBe('my private strategy notes');
    expect(savedPlans[entityId].stage).toBe('CONTACTED');

    await removeSavedResearchEntities(NETID, [entityId]);
    const archivedDoc = await findPlan(ENTITY_ID);
    expect(archivedDoc?.archived).toBe(true);
    expect(archivedDoc?.privateNotes).toBe('');
    expect(archivedDoc?.checklist).toEqual([]);
    expect(archivedDoc?.deadlines).toEqual([]);
    expect(archivedDoc?.stage).toBe('SAVED');

    await addSavedResearchEntities(NETID, [entityId]);
    const resavedPlans = await getSavedResearchEntityPlans(NETID);
    expect(resavedPlans[entityId].privateNotes).toBe('');
    expect(resavedPlans[entityId].checklist).toEqual([]);
    expect(resavedPlans[entityId].deadlines).toEqual([]);
    expect(resavedPlans[entityId].stage).toBe('SAVED');
  });

  it('clears watched-program private notes on unwatch and does not resurrect them on re-watch', async () => {
    const programId = PROGRAM_ID.toHexString();
    await addWatchedPrograms(NETID, [programId]);
    await updateWatchedProgramPlan(NETID, programId, {
      stage: 'CONTACTED',
      privateNotes: 'secret note',
    });

    const watchedPlans = await getWatchedProgramPlans(NETID);
    expect(watchedPlans[programId].privateNotes).toBe('secret note');

    await removeWatchedPrograms(NETID, [programId]);
    const archivedDoc = await findPlan(PROGRAM_ID);
    expect(archivedDoc?.archived).toBe(true);
    expect(archivedDoc?.privateNotes).toBe('');
    expect(archivedDoc?.stage).toBe('SAVED');

    await addWatchedPrograms(NETID, [programId]);
    const rewatchedPlans = await getWatchedProgramPlans(NETID);
    expect(rewatchedPlans[programId].privateNotes).toBe('');
    expect(rewatchedPlans[programId].stage).toBe('SAVED');
  });

  it('deleteWatchedProgramPlan clears plan data while keeping the program watched', async () => {
    const programId = PROGRAM_ID.toHexString();
    await addWatchedPrograms(NETID, [programId]);
    await updateWatchedProgramPlan(NETID, programId, { privateNotes: 'secret note' });

    const clearedPlans = await deleteWatchedProgramPlan(NETID, programId);
    expect(clearedPlans[programId].privateNotes).toBe('');
    expect(clearedPlans[programId].stage).toBe('SAVED');

    const doc = await findPlan(PROGRAM_ID);
    expect(doc?.archived).not.toBe(true);
    expect(doc?.privateNotes).toBe('');
  });

  it('updates and deletes a saved-entity plan addressed by slug, not just hex id (#1051)', async () => {
    await addSavedResearchEntities(NETID, ['test-lab']);

    const savedPlans = await updateSavedResearchEntityPlan(NETID, 'test-lab', {
      privateNotes: 'slug-addressed note',
    });
    const entityKey = ENTITY_ID.toHexString();
    expect(savedPlans[entityKey].privateNotes).toBe('slug-addressed note');

    const clearedPlans = await deleteSavedResearchEntityPlan(NETID, 'test-lab');
    expect(clearedPlans[entityKey].privateNotes).toBe('');

    const doc = await findPlan(ENTITY_ID);
    expect(doc?.archived).not.toBe(true);
    expect(doc?.privateNotes).toBe('');
  });

  it('rejects a plan update for a slug that resolves to no visible entity (#1051)', async () => {
    await expect(
      updateSavedResearchEntityPlan(NETID, 'no-such-lab', { privateNotes: 'x' }),
    ).rejects.toThrow(/not found/i);
  });
});
