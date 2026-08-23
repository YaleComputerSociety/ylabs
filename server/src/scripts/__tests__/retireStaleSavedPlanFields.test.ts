import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  assertRetireStaleSavedPlanFieldsApplyAllowed,
  parseRetireStaleSavedPlanFieldsArgs,
  retireStaleSavedPlanFields,
} from '../retireStaleSavedPlanFields';

describe('retireStaleSavedPlanFields CLI helpers', () => {
  it('defaults to a dry-run and parses apply safety flags', () => {
    expect(parseRetireStaleSavedPlanFieldsArgs([])).toEqual({
      apply: false,
      confirmRetireStaleSavedPlanFields: false,
    });
    expect(
      parseRetireStaleSavedPlanFieldsArgs([
        '--apply',
        '--confirm-retire-stale-saved-plan-fields',
      ]),
    ).toEqual({
      apply: true,
      confirmRetireStaleSavedPlanFields: true,
    });
  });

  it('rejects malformed CLI arguments', () => {
    expect(() => parseRetireStaleSavedPlanFieldsArgs(['prod'])).toThrow(
      /Unknown retire:stale-saved-plan-fields argument: prod/,
    );
    expect(() =>
      parseRetireStaleSavedPlanFieldsArgs(['--confirm-retire-stale-saved-plan-fields=1']),
    ).toThrow(/does not accept a value/);
  });

  it('requires confirmation when applying', () => {
    expect(() =>
      assertRetireStaleSavedPlanFieldsApplyAllowed({
        apply: true,
        confirmRetireStaleSavedPlanFields: false,
      }),
    ).toThrow(/--confirm-retire-stale-saved-plan-fields is required/);
    expect(() =>
      assertRetireStaleSavedPlanFieldsApplyAllowed({
        apply: false,
        confirmRetireStaleSavedPlanFields: false,
      }),
    ).not.toThrow();
  });
});

let memoryReplSet: MongoMemoryReplSet | undefined;

describe('retireStaleSavedPlanFields with MongoDB', () => {
  beforeAll(async () => {
    let mongoUrl = process.env.RETIRE_SAVED_PLAN_TEST_MONGO_URL;
    if (!mongoUrl) {
      memoryReplSet = await MongoMemoryReplSet.create({
        binary: { version: '8.0.12' },
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      mongoUrl = memoryReplSet.getUri('retire_saved_plan_test');
    }
    await mongoose.connect(mongoUrl);
  }, 120_000);

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    const db = mongoose.connection.db!;

    await db.collection('users').insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        netid: 'synthetic.person.with.stale.plans',
        savedResearchEntityPlans: { 'entity-1': { stage: 'saved' } },
        savedResearchEntityPlanMigrationConflicts: { 'entity-2': { collision: true } },
        savedPathwayPlans: { 'pathway-1': { intent: 'later' } },
        savedResearchEntityMigrationCompleted: true,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        netid: 'synthetic.person.already.clean',
        savedResearchEntityMigrationCompleted: true,
      },
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  it('performs no writes in dry-run mode', async () => {
    const db = mongoose.connection.db!;
    const result = await retireStaleSavedPlanFields({ apply: false });

    expect(result.mode).toBe('dry-run');
    expect(result.presentBefore).toBe(1);
    expect(result.presentAfter).toBe(1);
    expect(result.modified).toBe(0);

    const user = await db
      .collection('users')
      .findOne({ netid: 'synthetic.person.with.stale.plans' });
    expect(user?.savedResearchEntityPlans).toEqual({ 'entity-1': { stage: 'saved' } });
  });

  it('unsets only the stale saved-plan fields on apply', async () => {
    const db = mongoose.connection.db!;
    const result = await retireStaleSavedPlanFields({ apply: true });

    expect(result.mode).toBe('apply');
    expect(result.presentBefore).toBe(1);
    expect(result.presentAfter).toBe(0);
    expect(result.modified).toBe(1);

    const user = await db
      .collection('users')
      .findOne({ netid: 'synthetic.person.with.stale.plans' });
    expect(user?.savedResearchEntityPlans).toBeUndefined();
    expect(user?.savedResearchEntityPlanMigrationConflicts).toBeUndefined();
    expect(user?.savedPathwayPlans).toBeUndefined();
    expect(user?.savedResearchEntityMigrationCompleted).toBe(true);
    expect(user?.netid).toBe('synthetic.person.with.stale.plans');
  });
});
