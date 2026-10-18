import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { retargetResearchPlansToMergeSurvivors } from '../researchPlanSurvivorRetarget';

const oid = () => new mongoose.Types.ObjectId();

describe('re-pointing saved plans to merge survivors after a promotion (#5208)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await mongoose.connection
      .db!.collection('research_plans')
      .createIndex({ accountId: 1, 'target.kind': 1, 'target.id': 1 }, { unique: true });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    for (const name of ['research_entities', 'research_plans']) {
      await mongoose.connection.db!.collection(name).deleteMany({});
    }
  });

  const seed = async () => {
    const survivorId = oid();
    const middleId = oid();
    const mergedId = oid();
    const retiredId = oid();
    await mongoose.connection.db!.collection('research_entities').insertMany([
      { _id: survivorId, slug: 'synthetic-survivor', name: 'Survivor', archived: false },
      { _id: middleId, slug: 'synthetic-middle', archived: true, canonicalGroupId: survivorId },
      { _id: mergedId, slug: 'synthetic-merged', archived: true, canonicalGroupId: middleId },
      { _id: retiredId, slug: 'synthetic-retired', archived: true },
    ]);
    const accountId = oid();
    await mongoose.connection.db!.collection('research_plans').insertMany([
      {
        accountId,
        target: { kind: 'RESEARCH_ENTITY', id: mergedId },
        stage: 'CONTACTED',
        privateNotes: 'synthetic note',
        archived: false,
      },
      { accountId, target: { kind: 'RESEARCH_ENTITY', id: retiredId }, archived: false },
    ]);
    return { survivorId, mergedId, retiredId, accountId };
  };

  it('reports what it would move without writing on a dry run', async () => {
    const { mergedId } = await seed();
    const report = await retargetResearchPlansToMergeSurvivors({ apply: false });
    expect(report).toMatchObject({
      archivedTargets: 2,
      mergedTargets: 1,
      retiredTargets: 1,
      survivors: 1,
    });
    expect(report.carry).toMatchObject({ plansOnDuplicates: 1, moved: 1 });
    expect(
      await mongoose.connection
        .db!.collection('research_plans')
        .countDocuments({ 'target.id': mergedId }),
    ).toBe(1);
  });

  it('follows a multi-hop tombstone to the live survivor and keeps the student note', async () => {
    const { survivorId, retiredId, accountId } = await seed();
    await retargetResearchPlansToMergeSurvivors({ apply: true });
    const plans = await mongoose.connection
      .db!.collection('research_plans')
      .find({ accountId })
      .toArray();
    expect(plans.find((plan) => String(plan.target.id) === String(survivorId))).toMatchObject({
      stage: 'CONTACTED',
      privateNotes: 'synthetic note',
    });
    expect(plans.some((plan) => String(plan.target.id) === String(retiredId))).toBe(true);
  });
});
