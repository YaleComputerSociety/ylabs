import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { updateFellowship } from '../fellowshipService';

const FUND_ID = new mongoose.Types.ObjectId('000000000000000000004289');
const FUND_KEY = 'student-grants-database:fixture-summer-research-fellowship';

const servableFund = {
  _id: FUND_ID,
  sourceKey: FUND_KEY,
  sourceName: 'student-grants-database',
  title: 'Fixture Summer Research Fellowship',
  summary:
    'Funds undergraduates conducting independent summer research with a faculty mentor at Yale.',
  programKind: 'FELLOWSHIP_FUNDING',
  studentFacingCategory: 'Research travel funding',
  sourceUrl: 'https://yale.communityforce.com/Funds/FundDetails.aspx?FIXTURE',
  applicationLink: 'https://yale.communityforce.com/Funds/FundDetails.aspx?FIXTURE',
  deadline: new Date('2027-03-24T17:00:00.000Z'),
  undergraduateOnly: true,
  archived: false,
  studentVisibilityTier: 'suppressed',
  studentVisibilityOverrideTier: 'suppressed',
  studentVisibilitySuppressionReason: 'fixture operator note',
};

const overrideObservations = () =>
  [
    { field: 'studentVisibilityOverrideTier', value: 'suppressed' },
    { field: 'studentVisibilitySuppressionReason', value: 'fixture operator note' },
  ].map((observation) => ({
    ...observation,
    entityType: 'fellowship',
    entityKey: FUND_KEY,
    sourceName: 'manual-admin-edit',
    observedAt: new Date('2026-06-11T00:00:00Z'),
    superseded: false,
  }));

const fund = () => mongoose.connection.db!.collection('fellowships').findOne({ _id: FUND_ID });
const liveOverrideObservations = () =>
  mongoose.connection
    .db!.collection('observations')
    .countDocuments({ entityKey: FUND_KEY, superseded: { $ne: true } });

let memoryServer: MongoMemoryServer | undefined;

describe('an operator lifts a fellowship visibility override in the admin editor (#4289)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('admin_lifts_fellowship_override_test'));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    await db.collection('fellowships').deleteMany({});
    await db.collection('observations').deleteMany({});
    await db.collection('fellowships').insertOne({ ...servableFund } as any);
    await db.collection('observations').insertMany(overrideObservations() as any[]);
  });

  it('clears the override, retires the observations that assert it, and re-gates the row', async () => {
    await updateFellowship(FUND_ID.toHexString(), { studentVisibilityOverrideTier: null });

    const lifted = await fund();
    expect(lifted).not.toHaveProperty('studentVisibilityOverrideTier');
    expect(lifted).not.toHaveProperty('studentVisibilitySuppressionReason');
    expect(lifted?.studentVisibilityTier).toBe('student_ready');
    expect(await liveOverrideObservations()).toBe(0);
    const retired = await mongoose.connection
      .db!.collection('observations')
      .findOne({ entityKey: FUND_KEY, field: 'studentVisibilityOverrideTier' });
    expect(retired?.superseded).toBe(true);
    expect(retired?.rollback?.reason).toMatch(/lifted/);
  });

  it('leaves the override alone when an edit does not ask to lift it', async () => {
    await updateFellowship(FUND_ID.toHexString(), { studentVisibilityOverrideTier: 'not-a-tier' });
    await updateFellowship(FUND_ID.toHexString(), { title: 'Fixture Summer Research Fellowship' });

    expect((await fund())?.studentVisibilityOverrideTier).toBe('suppressed');
    expect(await liveOverrideObservations()).toBe(2);
  });

  it('still sets an override an operator names', async () => {
    await updateFellowship(FUND_ID.toHexString(), {
      studentVisibilityOverrideTier: 'operator_review',
    });

    expect((await fund())?.studentVisibilityOverrideTier).toBe('operator_review');
  });
});
