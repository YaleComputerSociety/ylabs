import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MERGED_RESEARCH_PLAN_NOTES_SEPARATOR,
  carryResearchPlansToSurvivor,
  combineResearchPlans,
  type StoredResearchPlan,
} from '../researchPlanMergeCarry';
import {
  previewResearchEntityMergeTombstonePlanCarry,
  recordResearchEntityMergeTombstone,
} from '../researchEntityCanonicalTombstone';
import { applyResearchEntityDedupeMergeGroup } from '../../scripts/dedupeResearchEntitiesByPi';
import { MAX_RESEARCH_PLAN_NOTES_LENGTH } from '../../models/researchPlan';

const oid = () => new mongoose.Types.ObjectId();
const NOW = new Date('2026-10-04T12:00:00.000Z');
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);

const storedPlan = (overrides: Partial<StoredResearchPlan> = {}): StoredResearchPlan => ({
  _id: oid(),
  accountId: oid(),
  target: { kind: 'RESEARCH_ENTITY', id: oid() },
  stage: 'SAVED',
  privateNotes: '',
  checklist: [],
  deadlines: [],
  exportPreferences: {
    includePrivateNotes: false,
    includeChecklist: false,
    includeDeadlines: false,
  },
  archived: false,
  ...overrides,
});

describe('combineResearchPlans', () => {
  it('keeps the more advanced stage whichever plan holds it', () => {
    const survivor = storedPlan({ stage: 'EXPLORING' });
    const duplicate = storedPlan({ stage: 'CONTACTED' });
    const forward = combineResearchPlans(survivor, duplicate, NOW);
    const backward = combineResearchPlans(duplicate, survivor, NOW);
    expect(forward.ok && forward.fields.stage).toBe('CONTACTED');
    expect(backward.ok && backward.fields.stage).toBe('CONTACTED');
  });

  it('keeps both sets of notes behind a visible separator', () => {
    const result = combineResearchPlans(
      storedPlan({ privateNotes: 'first plan notes' }),
      storedPlan({ privateNotes: 'second plan notes' }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.privateNotes).toBe(
      `first plan notes${MERGED_RESEARCH_PLAN_NOTES_SEPARATOR}second plan notes`,
    );
  });

  it('does not add a separator when only one plan has notes or both say the same thing', () => {
    const oneSided = combineResearchPlans(
      storedPlan({ privateNotes: '' }),
      storedPlan({ privateNotes: 'only notes' }),
      NOW,
    );
    const identical = combineResearchPlans(
      storedPlan({ privateNotes: 'same notes' }),
      storedPlan({ privateNotes: 'same notes ' }),
      NOW,
    );
    expect(oneSided.ok && oneSided.fields.privateNotes).toBe('only notes');
    expect(identical.ok && identical.fields.privateNotes).toBe('same notes');
  });

  it('unions checklists by label and keeps an item completed if either plan completed it', () => {
    const completedAt = daysFromNow(-2);
    const result = combineResearchPlans(
      storedPlan({
        checklist: [
          { label: 'Read recent papers', completed: false },
          { label: 'Draft email', completed: false },
        ],
      }),
      storedPlan({
        checklist: [
          { label: 'read recent  papers', completed: true, completedAt },
          { label: 'Ask advisor', completed: false },
        ],
      }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.checklist.map((item) => item.label)).toEqual([
      'read recent  papers',
      'Draft email',
      'Ask advisor',
    ]);
    expect(result.fields.checklist[0]).toMatchObject({ completed: true, completedAt });
  });

  it('keeps the earliest open deadline for a shared label and every distinct deadline', () => {
    const result = combineResearchPlans(
      storedPlan({
        deadlines: [
          { label: 'Application', dueAt: daysFromNow(20) },
          { label: 'Interview', dueAt: daysFromNow(-3) },
        ],
      }),
      storedPlan({
        deadlines: [
          { label: 'application', dueAt: daysFromNow(5) },
          { label: 'Interview', dueAt: daysFromNow(9) },
          { label: 'Poster', dueAt: daysFromNow(40) },
        ],
      }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.fields.deadlines.map((deadline) => [
        String(deadline.label).toLowerCase(),
        (deadline.dueAt as Date).toISOString(),
      ]),
    ).toEqual([
      ['application', daysFromNow(5).toISOString()],
      ['interview', daysFromNow(9).toISOString()],
      ['poster', daysFromNow(40).toISOString()],
    ]);
  });

  it('exports a field only when both plans opted in to exporting it', () => {
    const result = combineResearchPlans(
      storedPlan({
        exportPreferences: {
          includePrivateNotes: true,
          includeChecklist: true,
          includeDeadlines: false,
        },
      }),
      storedPlan({
        exportPreferences: {
          includePrivateNotes: false,
          includeChecklist: true,
          includeDeadlines: true,
        },
      }),
      NOW,
    );
    expect(result.ok && result.fields.exportPreferences).toEqual({
      includePrivateNotes: false,
      includeChecklist: true,
      includeDeadlines: false,
    });
  });

  it('refuses a combination that would exceed the notes limit instead of truncating it', () => {
    const half = 'n'.repeat(Math.ceil(MAX_RESEARCH_PLAN_NOTES_LENGTH / 2) + 1);
    const result = combineResearchPlans(
      storedPlan({ privateNotes: half }),
      storedPlan({ privateNotes: `${half}x` }),
      NOW,
    );
    expect(result).toEqual({ ok: false, overflow: ['privateNotes'] });
  });
});

describe('research plans carried through a dedupe merge', () => {
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
    const db = mongoose.connection.db!;
    for (const name of ['research_entities', 'research_plans', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedPair = async () => {
    const survivorId = oid();
    const duplicateId = oid();
    await mongoose.connection.db!.collection('research_entities').insertMany([
      { _id: survivorId, slug: 'synthetic-survivor-lab', archived: false },
      { _id: duplicateId, slug: 'synthetic-duplicate-lab', archived: false },
    ]);
    return { survivorId, duplicateId };
  };

  const mergeGroup = (survivorId: mongoose.Types.ObjectId, duplicateId: mongoose.Types.ObjectId) =>
    ({
      canonicalEntityId: survivorId.toHexString(),
      duplicateEntityIds: [duplicateId.toHexString()],
      mergedDepartments: [],
      mergedResearchAreas: [],
      mergedSourceUrls: [],
    }) as any;

  it("keeps a student's notes and stage on the survivor even when the merge skips reference relinking", async () => {
    const db = mongoose.connection.db!;
    const { survivorId, duplicateId } = await seedPair();
    const accountId = oid();
    const planId = oid();
    await db.collection('research_plans').insertOne({
      _id: planId,
      accountId,
      target: { kind: 'RESEARCH_ENTITY', id: duplicateId },
      stage: 'CONTACTED',
      privateNotes: 'synthetic outreach notes',
      checklist: [{ _id: oid(), label: 'Send follow-up', completed: false }],
      deadlines: [{ _id: oid(), label: 'Reply by', dueAt: daysFromNow(10) }],
      archived: false,
    });

    const result = await applyResearchEntityDedupeMergeGroup(mergeGroup(survivorId, duplicateId), {
      deleteDuplicates: false,
    });

    const plans = await db.collection('research_plans').find({ accountId }).toArray();
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      _id: planId,
      target: { kind: 'RESEARCH_ENTITY', id: survivorId },
      stage: 'CONTACTED',
      privateNotes: 'synthetic outreach notes',
      archived: false,
    });
    expect(plans[0].checklist).toHaveLength(1);
    expect(plans[0].deadlines).toHaveLength(1);
    expect(result.researchPlanCarry).toMatchObject({ plansOnDuplicates: 1, moved: 1 });
  });

  it('combines a plan on the duplicate with the same student plan on the survivor', async () => {
    const db = mongoose.connection.db!;
    const { survivorId, duplicateId } = await seedPair();
    const accountId = oid();
    const survivorPlanId = oid();
    const duplicatePlanId = oid();
    await db.collection('research_plans').insertMany([
      {
        _id: survivorPlanId,
        accountId,
        target: { kind: 'RESEARCH_ENTITY', id: survivorId },
        stage: 'EXPLORING',
        privateNotes: 'survivor side notes',
        checklist: [{ _id: oid(), label: 'Read papers', completed: false }],
        deadlines: [{ _id: oid(), label: 'Apply', dueAt: daysFromNow(30) }],
        archived: false,
      },
      {
        _id: duplicatePlanId,
        accountId,
        target: { kind: 'RESEARCH_ENTITY', id: duplicateId },
        stage: 'APPLIED',
        privateNotes: 'duplicate side notes',
        checklist: [{ _id: oid(), label: 'Email lab manager', completed: false }],
        deadlines: [{ _id: oid(), label: 'Apply', dueAt: daysFromNow(7) }],
        archived: false,
      },
    ]);

    const result = await applyResearchEntityDedupeMergeGroup(mergeGroup(survivorId, duplicateId), {
      deleteDuplicates: false,
      relinkReferences: true,
    });

    const plans = await db.collection('research_plans').find({ accountId }).toArray();
    expect(plans).toHaveLength(1);
    const [combined] = plans;
    expect(String(combined._id)).toBe(String(survivorPlanId));
    expect(combined.archived).toBe(false);
    expect(combined.stage).toBe('APPLIED');
    expect(combined.privateNotes).toBe(
      `survivor side notes${MERGED_RESEARCH_PLAN_NOTES_SEPARATOR}duplicate side notes`,
    );
    expect(combined.checklist.map((item: { label: string }) => item.label)).toEqual([
      'Read papers',
      'Email lab manager',
    ]);
    expect(combined.deadlines).toHaveLength(1);
    expect(new Date(combined.deadlines[0].dueAt).getTime()).toBeLessThan(daysFromNow(20).getTime());
    expect(result.researchPlanCarry).toMatchObject({ plansOnDuplicates: 1, merged: 1 });
  });

  it('never archives a plan, and leaves an over-limit combination live on the duplicate', async () => {
    const db = mongoose.connection.db!;
    const { survivorId, duplicateId } = await seedPair();
    const accountId = oid();
    const half = 'n'.repeat(Math.ceil(MAX_RESEARCH_PLAN_NOTES_LENGTH / 2) + 1);
    await db.collection('research_plans').insertMany([
      {
        accountId,
        target: { kind: 'RESEARCH_ENTITY', id: survivorId },
        privateNotes: half,
        archived: false,
      },
      {
        accountId,
        target: { kind: 'RESEARCH_ENTITY', id: duplicateId },
        privateNotes: `${half}x`,
        archived: false,
      },
    ]);

    const report = await carryResearchPlansToSurvivor({
      survivorId,
      duplicateIds: [duplicateId],
      apply: true,
      now: NOW,
    });

    expect(report).toMatchObject({ heldOverCapacity: 1, merged: 0, moved: 0 });
    expect(await db.collection('research_plans').countDocuments({ archived: true })).toBe(0);
    expect(
      await db
        .collection('research_plans')
        .countDocuments({ 'target.id': duplicateId, privateNotes: `${half}x` }),
    ).toBe(1);
  });

  it('reports what a dry run would carry without writing anything', async () => {
    const db = mongoose.connection.db!;
    const { survivorId, duplicateId } = await seedPair();
    await db.collection('research_plans').insertMany([
      { accountId: oid(), target: { kind: 'RESEARCH_ENTITY', id: duplicateId }, archived: false },
      { accountId: oid(), target: { kind: 'RESEARCH_ENTITY', id: duplicateId }, archived: false },
    ]);
    const before = await db.collection('research_plans').find({}).sort({ _id: 1 }).toArray();

    const report = await carryResearchPlansToSurvivor({
      survivorId,
      duplicateIds: [duplicateId],
      apply: false,
    });

    expect(report).toMatchObject({ plansOnDuplicates: 2, moved: 2 });
    expect(await db.collection('research_plans').find({}).sort({ _id: 1 }).toArray()).toEqual(
      before,
    );
  });

  it('carries plans off an archived row that a merge tombstone points at the survivor', async () => {
    const db = mongoose.connection.db!;
    const survivorId = oid();
    const archivedId = oid();
    await db.collection('research_entities').insertMany([
      { _id: survivorId, slug: 'synthetic-tombstone-survivor', archived: false },
      { _id: archivedId, slug: 'synthetic-tombstone-key', archived: true },
    ]);
    const planId = oid();
    await db.collection('research_plans').insertOne({
      _id: planId,
      accountId: oid(),
      target: { kind: 'RESEARCH_ENTITY', id: archivedId },
      stage: 'PREPARING',
      privateNotes: 'synthetic tombstone notes',
      archived: false,
    });

    await recordResearchEntityMergeTombstone({
      slug: 'synthetic-tombstone-key',
      canonicalEntityId: survivorId,
    });

    expect(await db.collection('research_plans').findOne({ _id: planId })).toMatchObject({
      target: { kind: 'RESEARCH_ENTITY', id: survivorId },
      stage: 'PREPARING',
      privateNotes: 'synthetic tombstone notes',
    });
  });

  it('restores a plan a system lane archived instead of leaving it archived', async () => {
    const db = mongoose.connection.db!;
    const { survivorId, duplicateId } = await seedPair();
    const movedAccountId = oid();
    const mergedAccountId = oid();
    const survivorPlanId = oid();
    await db.collection('research_plans').insertMany([
      {
        accountId: movedAccountId,
        target: { kind: 'RESEARCH_ENTITY', id: duplicateId },
        stage: 'CONTACTED',
        privateNotes: 'synthetic moved notes',
        archived: true,
        archivedReason: 'synthetic_system_archive',
        archivedAt: daysFromNow(-30),
      },
      {
        _id: survivorPlanId,
        accountId: mergedAccountId,
        target: { kind: 'RESEARCH_ENTITY', id: survivorId },
        stage: 'SAVED',
        privateNotes: 'synthetic survivor notes',
        archived: false,
      },
      {
        accountId: mergedAccountId,
        target: { kind: 'RESEARCH_ENTITY', id: duplicateId },
        stage: 'APPLIED',
        privateNotes: 'synthetic conflict-archived notes',
        archived: true,
        archivedReason: 'synthetic_system_archive',
        archivedAt: daysFromNow(-30),
      },
    ]);

    const report = await carryResearchPlansToSurvivor({
      survivorId,
      duplicateIds: [duplicateId],
      apply: true,
      now: NOW,
    });

    expect(report).toMatchObject({
      plansOnDuplicates: 2,
      moved: 1,
      merged: 1,
      keptStudentArchivedPlans: 0,
      restoredSystemArchivedPlans: 2,
    });
    const moved = await db.collection('research_plans').findOne({ accountId: movedAccountId });
    expect(moved).toMatchObject({
      target: { kind: 'RESEARCH_ENTITY', id: survivorId },
      stage: 'CONTACTED',
      privateNotes: 'synthetic moved notes',
      archived: false,
    });
    expect(moved).not.toHaveProperty('archivedReason');
    expect(moved).not.toHaveProperty('archivedAt');
    const merged = await db
      .collection('research_plans')
      .find({ accountId: mergedAccountId })
      .toArray();
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ _id: survivorPlanId, stage: 'APPLIED', archived: false });
    expect(merged[0].privateNotes).toBe(
      `synthetic survivor notes${MERGED_RESEARCH_PLAN_NOTES_SEPARATOR}synthetic conflict-archived notes`,
    );
  });

  it('keeps a plan the student archived archived when the student has a survivor plan', async () => {
    const db = mongoose.connection.db!;
    const { survivorId, duplicateId } = await seedPair();
    const accountId = oid();
    await db.collection('research_plans').insertMany([
      { accountId, target: { kind: 'RESEARCH_ENTITY', id: survivorId }, archived: false },
      {
        accountId,
        target: { kind: 'RESEARCH_ENTITY', id: duplicateId },
        archived: true,
        restorableUntil: daysFromNow(1),
      },
    ]);

    const report = await carryResearchPlansToSurvivor({
      survivorId,
      duplicateIds: [duplicateId],
      apply: true,
      now: NOW,
    });

    expect(report).toMatchObject({ keptStudentArchivedPlans: 1, restoredSystemArchivedPlans: 0 });
    expect(
      await db
        .collection('research_plans')
        .countDocuments({ 'target.id': duplicateId, archived: true }),
    ).toBe(1);
  });

  it('previews the plans a merge tombstone would carry without writing anything', async () => {
    const db = mongoose.connection.db!;
    const survivorId = oid();
    const archivedId = oid();
    await db.collection('research_entities').insertMany([
      { _id: survivorId, slug: 'synthetic-preview-survivor', archived: false },
      { _id: archivedId, slug: 'synthetic-preview-key', archived: true },
    ]);
    await db.collection('research_plans').insertOne({
      accountId: oid(),
      target: { kind: 'RESEARCH_ENTITY', id: archivedId },
      archived: false,
    });
    const before = await db.collection('research_plans').find({}).toArray();

    const report = await previewResearchEntityMergeTombstonePlanCarry({
      slug: 'synthetic-preview-key',
      canonicalEntityId: survivorId,
    });

    expect(report).toMatchObject({ plansOnDuplicates: 1, moved: 1 });
    expect(await db.collection('research_plans').find({}).toArray()).toEqual(before);
    expect(
      await db.collection('research_entities').findOne({ _id: archivedId }),
    ).not.toHaveProperty('canonicalGroupId');
  });
});
