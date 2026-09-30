import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const gate = vi.hoisted(() => ({ researchEntityServesPublicDetail: vi.fn() }));

vi.mock('../researchEntityPublicDescription', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../researchEntityPublicDescription')>();
  gate.researchEntityServesPublicDetail.mockImplementation(actual.researchEntityServesPublicDetail);
  return {
    ...actual,
    researchEntityServesPublicDetail: gate.researchEntityServesPublicDetail,
  };
});

const cardBuild = vi.hoisted(() => ({ leadGuardedServingInput: vi.fn() }));

vi.mock('../researchGroupService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../researchGroupService')>();
  cardBuild.leadGuardedServingInput.mockImplementation(actual.leadGuardedServingInput);
  return { ...actual, leadGuardedServingInput: cardBuild.leadGuardedServingInput };
});
import {
  addSavedResearchEntities,
  addWatchedPrograms,
  getSavedResearchEntityList,
  getSavedResearchEntityPlans,
  getSavedResearchEntitySlugs,
  getWatchedProgramPlans,
  removeSavedResearchEntities,
  removeWatchedPrograms,
  updateSavedResearchEntityPlan,
  updateWatchedProgramPlan,
} from '../researchPlanService';
import { toPublicResearchEntityDto } from '../researchEntityDto';
import { researchPlanSchema } from '../../models/researchPlan';
import { RoleAssignment } from '../../models/roleAssignment';

const NETID = 'teststud1';
const ENTITY_ID = new mongoose.Types.ObjectId('64a0000000000000000000ab');
const PROGRAM_ID = new mongoose.Types.ObjectId('64a0000000000000000000cd');

const plannedDeadline = { label: 'Submit application', dueAt: '2026-09-01T00:00:00.000Z' };
const plannedChecklist = [{ label: 'Read three papers', completed: false }];

let memoryReplSet: MongoMemoryReplSet | undefined;

const findPlan = (targetId: mongoose.Types.ObjectId) =>
  mongoose.connection.db!.collection('research_plans').findOne({ 'target.id': targetId });

describe('researchPlanService saved plans', () => {
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
  });

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

  const expireRestoreWindow = (targetId: mongoose.Types.ObjectId) =>
    mongoose.connection
      .db!.collection('research_plans')
      .updateOne(
        { 'target.id': targetId },
        { $set: { restorableUntil: new Date(Date.now() - 1) } },
      );

  it('restores the whole saved-entity plan when the student undoes an unsave', async () => {
    const entityId = ENTITY_ID.toHexString();
    await addSavedResearchEntities(NETID, [entityId]);
    await updateSavedResearchEntityPlan(NETID, entityId, {
      stage: 'CONTACTED',
      privateNotes: 'my private strategy notes',
      checklist: plannedChecklist,
      deadlines: [plannedDeadline],
    });
    const before = (await getSavedResearchEntityPlans(NETID))[entityId];

    await removeSavedResearchEntities(NETID, [entityId]);
    expect(await getSavedResearchEntityPlans(NETID)).toEqual({});
    await addSavedResearchEntities(NETID, [entityId]);

    const restored = (await getSavedResearchEntityPlans(NETID))[entityId];
    expect(restored.stage).toBe('CONTACTED');
    expect(restored.privateNotes).toBe('my private strategy notes');
    expect(restored.checklist).toEqual(before.checklist);
    expect(restored.deadlines).toEqual([plannedDeadline]);
  });

  it('does not resurrect saved-entity private notes on a re-save after the restore window', async () => {
    const entityId = ENTITY_ID.toHexString();
    await addSavedResearchEntities(NETID, [entityId]);
    await updateSavedResearchEntityPlan(NETID, entityId, {
      stage: 'CONTACTED',
      privateNotes: 'my private strategy notes',
      checklist: plannedChecklist,
      deadlines: [plannedDeadline],
    });

    await removeSavedResearchEntities(NETID, [entityId]);
    const archivedDoc = await findPlan(ENTITY_ID);
    expect(archivedDoc?.archived).toBe(true);
    expect(archivedDoc?.restorableUntil).toBeInstanceOf(Date);

    await expireRestoreWindow(ENTITY_ID);
    await addSavedResearchEntities(NETID, [entityId]);
    const resavedPlans = await getSavedResearchEntityPlans(NETID);
    expect(resavedPlans[entityId].privateNotes).toBe('');
    expect(resavedPlans[entityId].checklist).toEqual([]);
    expect(resavedPlans[entityId].deadlines).toEqual([]);
    expect(resavedPlans[entityId].stage).toBe('SAVED');
    expect((await findPlan(ENTITY_ID))?.restorableUntil).toBeUndefined();
  });

  it('declares a TTL index that deletes an archived plan when its restore window passes', () => {
    const ttlIndex = researchPlanSchema
      .indexes()
      .find(([fields]) => Object.keys(fields).join() === 'restorableUntil');
    expect(ttlIndex?.[1]).toMatchObject({ expireAfterSeconds: 0 });
  });

  it('restores the watched-program plan when the student undoes an unwatch', async () => {
    const programId = PROGRAM_ID.toHexString();
    await addWatchedPrograms(NETID, [programId]);
    await updateWatchedProgramPlan(NETID, programId, {
      stage: 'APPLIED',
      privateNotes: 'secret note',
      checklist: plannedChecklist,
      deadlines: [plannedDeadline],
    });

    await removeWatchedPrograms(NETID, [programId]);
    expect(await getWatchedProgramPlans(NETID)).toEqual({});
    await addWatchedPrograms(NETID, [programId]);

    const restored = (await getWatchedProgramPlans(NETID))[programId];
    expect(restored.stage).toBe('APPLIED');
    expect(restored.privateNotes).toBe('secret note');
    expect(restored.checklist.map((item) => item.label)).toEqual(['Read three papers']);
    expect(restored.deadlines).toEqual([plannedDeadline]);
  });

  it('does not resurrect watched-program private notes on a re-watch after the restore window', async () => {
    const programId = PROGRAM_ID.toHexString();
    await addWatchedPrograms(NETID, [programId]);
    await updateWatchedProgramPlan(NETID, programId, {
      stage: 'CONTACTED',
      privateNotes: 'secret note',
    });

    await removeWatchedPrograms(NETID, [programId]);
    await expireRestoreWindow(PROGRAM_ID);
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

  it('reports saved entities by the same id the public detail DTO serves (#3637)', async () => {
    const storedEntity = await mongoose.connection
      .db!.collection('research_entities')
      .findOne({ _id: ENTITY_ID });
    const servedId = toPublicResearchEntityDto(storedEntity!)._id;

    expect(await addSavedResearchEntities(NETID, [ENTITY_ID.toHexString()])).toEqual([servedId]);
    expect(await getSavedResearchEntitySlugs(NETID)).toEqual([servedId]);
    expect(await removeSavedResearchEntities(NETID, [servedId])).toEqual([]);
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
    const { savedResearchEntities: savedEntities } = await getSavedResearchEntityList(NETID);
    const savedSlugs = savedEntities.map((entity) => entity.slug);

    expect(savedSlugs).toContain('test-lab');
    expect(savedSlugs).not.toContain('hollow-lab');
    expect(savedPlans[ENTITY_ID.toHexString()].privateNotes).toBe('healthy save');
    expect(savedPlans[hollowId.toHexString()]).toBeUndefined();
  });

  describe('a saved plan the list cannot show is reported rather than dropped (#2174)', () => {
    const entityId = ENTITY_ID.toHexString();

    const saveWhilePublished = async () => {
      await addSavedResearchEntities(NETID, [entityId]);
      await updateSavedResearchEntityPlan(NETID, entityId, { privateNotes: 'why I saved this' });
    };

    it('reports a target the visibility gate has stopped publishing as UNAVAILABLE', async () => {
      await saveWhilePublished();
      await mongoose.connection
        .db!.collection('research_entities')
        .updateOne({ _id: ENTITY_ID }, { $set: { studentVisibilityTier: 'operator_review' } });

      const list = await getSavedResearchEntityList(NETID);

      expect(list.savedResearchEntities).toEqual([]);
      expect(list.unavailableSavedResearchEntities).toEqual([
        { _id: entityId, reason: 'UNAVAILABLE' },
      ]);
    });

    it('reports an archived target as UNAVAILABLE rather than removed', async () => {
      await saveWhilePublished();
      await mongoose.connection
        .db!.collection('research_entities')
        .updateOne({ _id: ENTITY_ID }, { $set: { archived: true } });

      const list = await getSavedResearchEntityList(NETID);

      expect(list.unavailableSavedResearchEntities).toEqual([
        { _id: entityId, reason: 'UNAVAILABLE' },
      ]);
    });

    it('reports a target whose record no longer exists as REMOVED', async () => {
      await saveWhilePublished();
      await mongoose.connection.db!.collection('research_entities').deleteOne({ _id: ENTITY_ID });

      const list = await getSavedResearchEntityList(NETID);

      expect(list.savedResearchEntities).toEqual([]);
      expect(list.unavailableSavedResearchEntities).toEqual([{ _id: entityId, reason: 'REMOVED' }]);
    });

    it('names the id and the reason and nothing the gate withheld', async () => {
      await saveWhilePublished();
      await mongoose.connection
        .db!.collection('research_entities')
        .updateOne({ _id: ENTITY_ID }, { $set: { studentVisibilityTier: 'suppressed' } });

      const [reported] = (await getSavedResearchEntityList(NETID)).unavailableSavedResearchEntities;

      expect(Object.keys(reported).sort()).toEqual(['_id', 'reason']);
    });

    it('keeps the plan and its note so a re-published target comes back whole', async () => {
      await saveWhilePublished();
      const entities = mongoose.connection.db!.collection('research_entities');
      await entities.updateOne(
        { _id: ENTITY_ID },
        { $set: { studentVisibilityTier: 'operator_review' } },
      );
      expect((await getSavedResearchEntityList(NETID)).savedResearchEntities).toEqual([]);

      await entities.updateOne(
        { _id: ENTITY_ID },
        { $set: { studentVisibilityTier: 'student_ready' } },
      );
      const list = await getSavedResearchEntityList(NETID);

      expect(list.unavailableSavedResearchEntities).toEqual([]);
      expect(list.savedResearchEntities.map((entity) => entity.slug)).toEqual(['test-lab']);
      expect((await getSavedResearchEntityPlans(NETID))[entityId].privateNotes).toBe(
        'why I saved this',
      );
    });

    it('reports nothing when every saved plan serves', async () => {
      await saveWhilePublished();

      const list = await getSavedResearchEntityList(NETID);

      expect(list.savedResearchEntities).toHaveLength(1);
      expect(list.unavailableSavedResearchEntities).toEqual([]);
    });
  });

  describe('a saved-list read does the work it needs once and writes nothing (#3954)', () => {
    const publicCopy = {
      shortDescription:
        'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
      fullDescription:
        'This research studies molecular dynamics, protein folding, and cellular signaling across complex biological systems.',
    };
    const extraEntity = (hex: string, slug: string, overrides: Record<string, unknown> = {}) => ({
      _id: new mongoose.Types.ObjectId(hex),
      slug,
      name: `${slug} name`,
      kind: 'group',
      departments: ['Computer Science'],
      studentVisibilityTier: 'student_ready',
      ...publicCopy,
      sourceUrls: [`https://example.yale.edu/labs/${slug}`],
      archived: false,
      ...overrides,
    });
    const accounts = () => mongoose.connection.db!.collection('accounts');

    const saveMixedTargets = async () => {
      const entities = mongoose.connection.db!.collection('research_entities');
      const targets = [
        extraEntity('64a0000000000000000001a1', 'second-servable'),
        extraEntity('64a0000000000000000001a2', 'archived-target'),
        extraEntity('64a0000000000000000001a3', 'held-target'),
        extraEntity('64a0000000000000000001a4', 'hollow-target'),
        extraEntity('64a0000000000000000001a5', 'removed-target'),
      ];
      await entities.insertMany(targets);
      await addSavedResearchEntities(NETID, [
        ENTITY_ID.toHexString(),
        ...targets.map((target) => target._id.toHexString()),
      ]);
      await entities.updateOne({ slug: 'archived-target' }, { $set: { archived: true } });
      await entities.updateOne(
        { slug: 'held-target' },
        { $set: { studentVisibilityTier: 'operator_review' } },
      );
      await entities.updateOne(
        { slug: 'hollow-target' },
        { $set: { shortDescription: '', fullDescription: '', sourceUrls: [] } },
      );
      await entities.deleteOne({ slug: 'removed-target' });
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('leaves the account untouched on every saved-list read', async () => {
      await addSavedResearchEntities(NETID, [ENTITY_ID.toHexString()]);
      const before = await accounts().findOne({ netid: NETID });
      await new Promise((resolve) => setTimeout(resolve, 20));

      await getSavedResearchEntityList(NETID);
      await getSavedResearchEntitySlugs(NETID);
      await getSavedResearchEntityPlans(NETID);

      const after = await accounts().findOne({ netid: NETID });
      expect(after?.updatedAt?.getTime()).toBe(before?.updatedAt?.getTime());
      expect(await accounts().countDocuments({ netid: NETID })).toBe(1);
    });

    it('still creates a missing account when the student saves', async () => {
      expect(await accounts().countDocuments({ netid: NETID })).toBe(0);

      await addSavedResearchEntities(NETID, [ENTITY_ID.toHexString()]);

      expect(await accounts().countDocuments({ netid: NETID })).toBe(1);
      expect(await getSavedResearchEntitySlugs(NETID)).toEqual(['test-lab']);
    });

    it('serves an empty list to an account that does not exist yet', async () => {
      expect(await getSavedResearchEntityList(NETID)).toEqual({
        savedResearchEntities: [],
        unavailableSavedResearchEntities: [],
      });
      expect(await getSavedResearchEntitySlugs(NETID)).toEqual([]);
      expect(await getSavedResearchEntityPlans(NETID)).toEqual({});
    });

    it('runs the detail gate once per saved row that reaches it', async () => {
      await saveMixedTargets();
      gate.researchEntityServesPublicDetail.mockClear();

      await getSavedResearchEntityList(NETID);

      expect(gate.researchEntityServesPublicDetail).toHaveBeenCalledTimes(3);
    });

    it('serves the same rows and reasons from the list, the slug read and the plan read', async () => {
      await saveMixedTargets();

      const list = await getSavedResearchEntityList(NETID);
      const slugs = await getSavedResearchEntitySlugs(NETID);
      const plans = await getSavedResearchEntityPlans(NETID);

      expect([...list.savedResearchEntities.map((entity) => entity.slug)].sort()).toEqual([
        'second-servable',
        'test-lab',
      ]);
      expect(slugs).toEqual(list.savedResearchEntities.map((entity) => entity.slug));
      expect(Object.keys(plans).sort()).toEqual(
        list.savedResearchEntities.map((entity) => entity._id).sort(),
      );
      expect(
        [...list.unavailableSavedResearchEntities].sort((a, b) => a._id.localeCompare(b._id)),
      ).toEqual([
        { _id: '64a0000000000000000001a2', reason: 'UNAVAILABLE' },
        { _id: '64a0000000000000000001a3', reason: 'UNAVAILABLE' },
        { _id: '64a0000000000000000001a4', reason: 'UNAVAILABLE' },
        { _id: '64a0000000000000000001a5', reason: 'REMOVED' },
      ]);
    });

    it('answers the slug read without a roster read', async () => {
      await saveMixedTargets();
      const rosterRead = vi.spyOn(RoleAssignment, 'find');

      await getSavedResearchEntitySlugs(NETID);
      expect(rosterRead).not.toHaveBeenCalled();

      await getSavedResearchEntityList(NETID);
      expect(rosterRead).toHaveBeenCalled();
    });

    it('answers the plan read without a roster read or a card build (#4077)', async () => {
      await saveMixedTargets();
      const rosterRead = vi.spyOn(RoleAssignment, 'find');
      cardBuild.leadGuardedServingInput.mockClear();

      const plans = await getSavedResearchEntityPlans(NETID);

      expect(Object.keys(plans)).toHaveLength(2);
      expect(rosterRead).not.toHaveBeenCalled();
      expect(cardBuild.leadGuardedServingInput).not.toHaveBeenCalled();

      await getSavedResearchEntityList(NETID);
      expect(rosterRead).toHaveBeenCalled();
      expect(cardBuild.leadGuardedServingInput).toHaveBeenCalledTimes(2);
    });

    it('keys the plan map by the served card id, in the served list order (#4077)', async () => {
      await saveMixedTargets();

      const list = await getSavedResearchEntityList(NETID);
      const plans = await getSavedResearchEntityPlans(NETID);

      expect(Object.keys(plans)).toEqual(list.savedResearchEntities.map((entity) => entity._id));
      for (const entity of list.savedResearchEntities) {
        expect(plans[entity._id]).toBeDefined();
      }
    });

    it('keys the plan map by entity id and never by a saved target it cannot serve (#4077)', async () => {
      await saveMixedTargets();
      await updateSavedResearchEntityPlan(NETID, ENTITY_ID.toHexString(), {
        stage: 'CONTACTED',
        privateNotes: 'synthetic planning note',
        checklist: plannedChecklist,
        deadlines: [plannedDeadline],
      });

      const plans = await getSavedResearchEntityPlans(NETID);

      for (const key of Object.keys(plans)) expect(key).toMatch(/^[a-f0-9]{24}$/);
      expect(Object.keys(plans)).toContain(ENTITY_ID.toHexString());
      expect(Object.keys(plans)).not.toContain('64a0000000000000000001a2');
      expect(Object.keys(plans)).not.toContain('64a0000000000000000001a5');
      expect(plans[ENTITY_ID.toHexString()]).toEqual(
        expect.objectContaining({
          stage: 'CONTACTED',
          privateNotes: 'synthetic planning note',
          checklist: plannedChecklist,
          deadlines: [plannedDeadline],
        }),
      );
    });
  });

  it('serves undergraduate-access fields on saved entities, omitting neutral defaults (#1382)', async () => {
    const openId = new mongoose.Types.ObjectId('64a0000000000000000000f1');
    const db = mongoose.connection.db!;
    await db.collection('research_entities').updateOne(
      { _id: ENTITY_ID },
      {
        $set: {
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
      pastUndergradAdvisees: [{ name: 'Synthetic Advisee', count: 1 }],
      archived: false,
    });

    await addSavedResearchEntities(NETID, [ENTITY_ID.toHexString(), openId.toHexString()]);
    const { savedResearchEntities: savedEntities } = await getSavedResearchEntityList(NETID);
    const byId = new Map(savedEntities.map((entity) => [entity._id, entity]));

    const open = byId.get(openId.toHexString());
    expect(open?.hasUndergradHostingEvidence).toBe(true);

    const neutral = byId.get(ENTITY_ID.toHexString());
    expect(neutral).toBeDefined();
    // Availability was removed because no source publishes it. Keep pinning its
    // absence from the served summary so a later change cannot reintroduce it.
    expect(neutral).not.toHaveProperty('undergraduateCurrentAvailability');
    expect(open).not.toHaveProperty('undergraduateCurrentAvailability');
    expect(neutral).not.toHaveProperty('hasUndergradHostingEvidence');
  });
});
