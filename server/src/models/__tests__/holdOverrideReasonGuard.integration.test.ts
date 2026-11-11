import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Fellowship } from '../fellowship';
import {
  HoldingOverrideWithoutReasonError,
  checkUpdateKeepsHoldReason,
  isHoldWithoutRecordedReason,
} from '../holdOverrideReasonGuard';
import { ResearchEntity } from '../researchEntity';

const REASON = 'fixture_hold: the synthetic row is held for a fixture reason';

const researchRows = () => mongoose.connection.db!.collection('research_entities');

const seedResearchRow = async (fields: Record<string, unknown> = {}) => {
  const _id = new mongoose.Types.ObjectId();
  await researchRows().insertOne({
    _id,
    slug: `fixture-row-${_id.toHexString()}`,
    name: 'Fixture Orbital Lab',
    kind: 'lab',
    entityType: 'LAB',
    archived: false,
    studentVisibilityTier: 'student_ready',
    ...fields,
  });
  return _id;
};

const stored = (_id: mongoose.Types.ObjectId) => researchRows().findOne({ _id });

let memoryServer: MongoMemoryServer | undefined;

describe('the hold-reason predicate', () => {
  it('reads only a holding tier with an empty or absent reason as unexplained', () => {
    expect(isHoldWithoutRecordedReason({ studentVisibilityOverrideTier: 'suppressed' })).toBe(true);
    expect(
      isHoldWithoutRecordedReason({
        studentVisibilityOverrideTier: 'operator_review',
        studentVisibilitySuppressionReason: ' , ',
      }),
    ).toBe(true);
    expect(
      isHoldWithoutRecordedReason({
        studentVisibilityOverrideTier: 'suppressed',
        studentVisibilitySuppressionReason: REASON,
      }),
    ).toBe(false);
    expect(isHoldWithoutRecordedReason({ studentVisibilityOverrideTier: 'student_ready' })).toBe(
      false,
    );
  });

  it('decides from the update alone when it names both fields', () => {
    expect(
      checkUpdateKeepsHoldReason({
        $set: {
          studentVisibilityOverrideTier: 'suppressed',
          studentVisibilitySuppressionReason: '',
        },
      }),
    ).toEqual({ verdict: 'refused' });
    expect(
      checkUpdateKeepsHoldReason({
        studentVisibilityOverrideTier: 'operator_review',
        studentVisibilitySuppressionReason: REASON,
      }),
    ).toEqual({ verdict: 'allowed' });
    expect(
      checkUpdateKeepsHoldReason({ $set: { studentVisibilityOverrideTier: 'limited_but_safe' } }),
    ).toEqual({ verdict: 'allowed' });
    expect(checkUpdateKeepsHoldReason({ $unset: { studentVisibilityOverrideTier: '' } })).toEqual({
      verdict: 'allowed',
    });
  });
});

describe('a Mongoose write cannot leave a hold without a recorded reason (#5856)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('hold_override_reason_guard_test'));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  beforeEach(async () => {
    await researchRows().deleteMany({});
    await mongoose.connection.db!.collection('fellowships').deleteMany({});
  });

  it('refuses an update that sets a hold with an empty reason', async () => {
    const _id = await seedResearchRow();
    await expect(
      ResearchEntity.updateOne(
        { _id },
        {
          $set: {
            studentVisibilityOverrideTier: 'suppressed',
            studentVisibilitySuppressionReason: '  ',
          },
        },
      ),
    ).rejects.toBeInstanceOf(HoldingOverrideWithoutReasonError);
    expect((await stored(_id))?.studentVisibilityOverrideTier).toBeUndefined();
  });

  it('refuses a hold on a row with no reason when the update records none', async () => {
    const _id = await seedResearchRow();
    await expect(
      ResearchEntity.updateOne(
        { _id },
        { $set: { studentVisibilityOverrideTier: 'operator_review' } },
      ),
    ).rejects.toBeInstanceOf(HoldingOverrideWithoutReasonError);
  });

  it('accepts a hold with a reason, and a hold on a row that already records one', async () => {
    const withReason = await seedResearchRow();
    await ResearchEntity.updateOne(
      { _id: withReason },
      {
        $set: {
          studentVisibilityOverrideTier: 'suppressed',
          studentVisibilitySuppressionReason: REASON,
        },
      },
    );
    expect((await stored(withReason))?.studentVisibilityOverrideTier).toBe('suppressed');

    const alreadyExplained = await seedResearchRow({ studentVisibilitySuppressionReason: REASON });
    await ResearchEntity.updateOne(
      { _id: alreadyExplained },
      { $set: { studentVisibilityOverrideTier: 'operator_review' } },
    );
    expect((await stored(alreadyExplained))?.studentVisibilityOverrideTier).toBe('operator_review');
  });

  it('refuses emptying the reason of a held row and allows it on an unheld one', async () => {
    const held = await seedResearchRow({
      studentVisibilityOverrideTier: 'suppressed',
      studentVisibilitySuppressionReason: REASON,
    });
    await expect(
      ResearchEntity.updateOne(
        { _id: held },
        { $unset: { studentVisibilitySuppressionReason: '' } },
      ),
    ).rejects.toBeInstanceOf(HoldingOverrideWithoutReasonError);
    expect((await stored(held))?.studentVisibilitySuppressionReason).toBe(REASON);

    const unheld = await seedResearchRow({ studentVisibilitySuppressionReason: REASON });
    await ResearchEntity.updateOne(
      { _id: unheld },
      { $set: { studentVisibilitySuppressionReason: '' } },
    );
    expect((await stored(unheld))?.studentVisibilitySuppressionReason).toBe('');
  });

  it('leaves non-hold overrides alone', async () => {
    const _id = await seedResearchRow();
    await ResearchEntity.updateOne(
      { _id },
      {
        $set: {
          studentVisibilityOverrideTier: 'student_ready',
          studentVisibilitySuppressionReason: '',
        },
      },
    );
    expect((await stored(_id))?.studentVisibilityOverrideTier).toBe('student_ready');
  });

  it('still reads, rewrites and explains an existing reasonless hold without changing its tier', async () => {
    const _id = await seedResearchRow({
      studentVisibilityTier: 'suppressed',
      studentVisibilityOverrideTier: 'suppressed',
    });

    expect((await ResearchEntity.findById(_id).lean()) as any).toMatchObject({
      studentVisibilityOverrideTier: 'suppressed',
    });
    await ResearchEntity.updateOne(
      { _id },
      { $set: { studentVisibilityComputedTier: 'student_ready', name: 'Fixture Orbital Lab' } },
    );
    await ResearchEntity.updateOne(
      { _id },
      { $set: { studentVisibilitySuppressionReason: REASON } },
    );

    expect(await stored(_id)).toMatchObject({
      studentVisibilityTier: 'suppressed',
      studentVisibilityOverrideTier: 'suppressed',
      studentVisibilitySuppressionReason: REASON,
    });
  });

  it('guards save, insertMany, replaceOne and bulkWrite too', async () => {
    const document = new ResearchEntity({
      slug: 'fixture-saved-row',
      name: 'Fixture Saved Lab',
      kind: 'lab',
      entityType: 'LAB',
      studentVisibilityOverrideTier: 'suppressed',
    });
    await expect(document.save()).rejects.toBeInstanceOf(HoldingOverrideWithoutReasonError);

    await expect(
      ResearchEntity.insertMany([
        {
          slug: 'fixture-inserted-row',
          name: 'Fixture Inserted Lab',
          kind: 'lab',
          entityType: 'LAB',
          studentVisibilityOverrideTier: 'operator_review',
        },
      ]),
    ).rejects.toBeInstanceOf(HoldingOverrideWithoutReasonError);

    const replaced = await seedResearchRow();
    await expect(
      ResearchEntity.replaceOne(
        { _id: replaced },
        {
          slug: 'fixture-replaced-row',
          name: 'Fixture Replaced Lab',
          studentVisibilityOverrideTier: 'suppressed',
        },
      ),
    ).rejects.toBeInstanceOf(HoldingOverrideWithoutReasonError);

    const bulk = await seedResearchRow();
    await expect(
      ResearchEntity.bulkWrite([
        {
          updateOne: {
            filter: { _id: bulk },
            update: { $set: { studentVisibilityOverrideTier: 'suppressed' } },
          },
        },
      ]),
    ).rejects.toBeInstanceOf(HoldingOverrideWithoutReasonError);
    expect((await stored(bulk))?.studentVisibilityOverrideTier).toBeUndefined();
  });

  it('guards the fellowship collection the admin editor writes', async () => {
    const _id = new mongoose.Types.ObjectId();
    await mongoose.connection.db!.collection('fellowships').insertOne({
      _id,
      title: 'Fixture Summer Research Fellowship',
      archived: false,
    });
    await expect(
      Fellowship.findByIdAndUpdate(_id, { studentVisibilityOverrideTier: 'suppressed' }),
    ).rejects.toBeInstanceOf(HoldingOverrideWithoutReasonError);
    await Fellowship.findByIdAndUpdate(_id, {
      studentVisibilityOverrideTier: 'suppressed',
      studentVisibilitySuppressionReason: REASON,
    });
    expect(
      (await mongoose.connection.db!.collection('fellowships').findOne({ _id }))
        ?.studentVisibilityOverrideTier,
    ).toBe('suppressed');
  });
});
