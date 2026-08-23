import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ResearchPlan } from '../../models/researchPlan';
import {
  resolveAccountIdByNetid,
} from '../accountService';
import {
  deleteWatchedProgramPlan,
  removeSavedResearchEntities,
  removeWatchedPrograms,
} from '../researchPlanService';

const NETID = 'planret1';

const seedPlan = async (
  kind: 'RESEARCH_ENTITY' | 'PROGRAM',
): Promise<mongoose.Types.ObjectId> => {
  const accountId = await resolveAccountIdByNetid(NETID);
  const targetId = new mongoose.Types.ObjectId();
  await ResearchPlan.create({
    accountId,
    target: { kind, id: targetId },
    stage: 'CONTACTED',
    privateNotes: 'my private strategy notes',
    checklist: [{ label: 'email the PI', completed: false }],
    deadlines: [{ label: 'submit application', dueAt: new Date('2026-09-01T00:00:00.000Z') }],
    archived: false,
  });
  return targetId;
};

const readRawPlan = async (targetId: mongoose.Types.ObjectId) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  return db.collection('research_plans').findOne({ 'target.id': targetId });
};

describe('research plan retention on unsave/unwatch (integration)', () => {
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
    await db.collection('research_plans').deleteMany({});
    await db.collection('accounts').deleteMany({});
  });

  it('clears private plan fields when a saved research entity is unsaved', async () => {
    const targetId = await seedPlan('RESEARCH_ENTITY');

    await removeSavedResearchEntities(NETID, [targetId.toHexString()]);

    const doc = await readRawPlan(targetId);
    expect(doc).toBeTruthy();
    expect(doc?.archived).toBe(true);
    expect(doc?.privateNotes).toBe('');
    expect(doc?.checklist).toEqual([]);
    expect(doc?.deadlines).toEqual([]);
    expect(doc?.stage).toBe('SAVED');
  });

  it('clears private plan fields when a watched program is unwatched', async () => {
    const targetId = await seedPlan('PROGRAM');

    await removeWatchedPrograms(NETID, [targetId.toHexString()]);

    const doc = await readRawPlan(targetId);
    expect(doc).toBeTruthy();
    expect(doc?.archived).toBe(true);
    expect(doc?.privateNotes).toBe('');
    expect(doc?.checklist).toEqual([]);
    expect(doc?.deadlines).toEqual([]);
    expect(doc?.stage).toBe('SAVED');
  });

  it('wipes an active watched-program plan without archiving via deleteWatchedProgramPlan', async () => {
    const targetId = await seedPlan('PROGRAM');

    await deleteWatchedProgramPlan(NETID, targetId.toHexString());

    const doc = await readRawPlan(targetId);
    expect(doc).toBeTruthy();
    expect(doc?.archived).toBe(false);
    expect(doc?.privateNotes).toBe('');
    expect(doc?.checklist).toEqual([]);
    expect(doc?.deadlines).toEqual([]);
    expect(doc?.stage).toBe('SAVED');
  });
});
