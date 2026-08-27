import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  addSavedResearchEntities,
  addWatchedPrograms,
  getSavedResearchEntities,
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
      shortDescription:
        'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
      fullDescription:
        'This research studies molecular dynamics, protein folding, and cellular signaling across complex biological systems.',
      sourceUrls: ['https://example.yale.edu/labs/test-lab'],
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

  it('updates a saved-entity plan addressed by slug, not just hex id (#1051)', async () => {
    await addSavedResearchEntities(NETID, ['test-lab']);

    const savedPlans = await updateSavedResearchEntityPlan(NETID, 'test-lab', {
      privateNotes: 'slug-addressed note',
    });
    const entityKey = ENTITY_ID.toHexString();
    expect(savedPlans[entityKey].privateNotes).toBe('slug-addressed note');
  });

  it('rejects a plan update for a slug that resolves to no visible entity (#1051)', async () => {
    await expect(
      updateSavedResearchEntityPlan(NETID, 'no-such-lab', { privateNotes: 'x' }),
    ).rejects.toThrow(/not found/i);
  });

  it('hides a saved entity whose stored student_ready tier is stale against the live public-description invariant (#998)', async () => {
    const hollowId = new mongoose.Types.ObjectId('64a0000000000000000000ef');
    await mongoose.connection.db!.collection('research_entities').insertOne({
      _id: hollowId,
      slug: 'hollow-lab',
      name: 'Hollow Lab',
      kind: 'group',
      departments: ['History'],
      researchAreas: ['Middle East Studies', 'Iranian Studies'],
      descriptionSource: 'PI_PROFILE_SYNTHESIS',
      studentVisibilityTier: 'student_ready',
      shortDescription: '',
      fullDescription: '',
      sourceUrls: [],
      archived: false,
    });

    await addSavedResearchEntities(NETID, [ENTITY_ID.toHexString(), hollowId.toHexString()]);
    await updateSavedResearchEntityPlan(NETID, ENTITY_ID.toHexString(), {
      privateNotes: 'healthy save',
    });

    const savedPlans = await getSavedResearchEntityPlans(NETID);
    const savedEntities = await getSavedResearchEntities(NETID);
    const savedSlugs = savedEntities.map((entity) => entity.slug);

    expect(savedSlugs).toContain('test-lab');
    expect(savedSlugs).not.toContain('hollow-lab');
    expect(savedPlans[ENTITY_ID.toHexString()].privateNotes).toBe('healthy save');
    expect(savedPlans[hollowId.toHexString()]).toBeUndefined();
  });

  it('serves undergraduate-access fields on saved entities, omitting neutral defaults (#1382)', async () => {
    const openId = new mongoose.Types.ObjectId('64a0000000000000000000f1');
    const db = mongoose.connection.db!;
    await db.collection('research_entities').updateOne(
      { _id: ENTITY_ID },
      {
        $set: {
          undergraduateCurrentAvailability: 'UNKNOWN',
          hasUndergradHostingEvidence: false,
        },
      },
    );
    await db.collection('research_entities').insertOne({
      _id: openId,
      slug: 'open-lab',
      name: 'Open Lab',
      kind: 'group',
      departments: ['Computer Science'],
      studentVisibilityTier: 'student_ready',
      shortDescription:
        'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
      fullDescription:
        'This research studies molecular dynamics, protein folding, and cellular signaling across complex biological systems.',
      sourceUrls: ['https://example.yale.edu/labs/open-lab'],
      undergraduateCurrentAvailability: 'OPEN',
      hasUndergradHostingEvidence: true,
      archived: false,
    });

    await addSavedResearchEntities(NETID, [ENTITY_ID.toHexString(), openId.toHexString()]);
    const savedEntities = await getSavedResearchEntities(NETID);
    const byId = new Map(savedEntities.map((entity) => [entity._id, entity]));

    const open = byId.get(openId.toHexString());
    expect(open?.undergraduateCurrentAvailability).toBe('OPEN');
    expect(open?.hasUndergradHostingEvidence).toBe(true);

    const neutral = byId.get(ENTITY_ID.toHexString());
    expect(neutral).toBeDefined();
    expect(neutral).not.toHaveProperty('undergraduateCurrentAvailability');
    expect(neutral).not.toHaveProperty('hasUndergradHostingEvidence');
  });
});
