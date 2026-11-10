import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: meiliMocks.syncEntities,
  syncEntity: meiliMocks.syncEntity,
  deleteFromIndex: meiliMocks.deleteFromIndex,
}));

import { ResearchEntity } from '../../models/researchEntity';
import { directoryRemovalDigest } from '../../utils/directoryRemovalDigest';
import {
  DIRECTORY_REMOVAL_GATE_REFUSAL,
  freshDirectoryRemovalServing,
  setDirectoryRemovalServingForTest,
} from '../directoryRemovalServing';
import { runStudentVisibilityGate } from '../studentVisibilityGateService';
import { RESEARCHER_REMOVED_REASON } from '../studentVisibilityTier';

const KEY = 'synthetic-directory-removal-key-0123456789';
const SOLE_LEAD_SLUG = 'synthetic-removal-sole-lead-lab';
const CO_LED_SLUG = 'synthetic-removal-co-led-lab';
const READY_SHORT =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const READY_FULL =
  'The lab studies neonatal care quality improvement across community hospital nurseries, combining bedside outcome audits, staffing and transfer pattern analysis, and implementation trials of standardized resuscitation protocols to reduce avoidable transfers to tertiary intensive care.';

type Persisted = {
  studentVisibilityTier?: string;
  studentVisibilityReasons?: string[];
  studentVisibilityOverrideTier?: string;
  manuallyLockedFields?: string[];
};

const persisted = (slug: string) =>
  ResearchEntity.findOne({ slug }).lean<Persisted>() as Promise<Persisted>;

describe('the gate suppresses a row whose every lead asked to be removed (#4160)', () => {
  let replSet: MongoMemoryReplSet;
  const previousKey = process.env.DIRECTORY_REMOVAL_KEY;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    process.env.DIRECTORY_REMOVAL_KEY = previousKey;
    setDirectoryRemovalServingForTest(undefined);
    await mongoose.disconnect();
    await replSet?.stop();
  });

  const personIdsByNetid = new Map<string, mongoose.Types.ObjectId>();

  const seedLead = async (entityId: mongoose.Types.ObjectId, lastName: string, netid: string) => {
    const db = mongoose.connection.db!;
    let personId = personIdsByNetid.get(netid);
    if (!personId) {
      personId = new mongoose.Types.ObjectId();
      personIdsByNetid.set(netid, personId);
      await db.collection('researchers').insertOne({
        _id: personId,
        schemaVersion: 1,
        displayName: `Robin ${lastName}`,
        identifiers: { netid },
        profileLinks: [],
        status: 'ACTIVE',
        archived: false,
      });
    }
    await db.collection('role_assignments').insertOne({
      schemaVersion: 1,
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      confidence: 1,
      reviewStatus: 'APPROVED',
      archived: false,
    });
  };

  const seedLab = async (slug: string, leads: Array<[string, string]>) => {
    const db = mongoose.connection.db!;
    const entityId = new mongoose.Types.ObjectId();
    const sourceUrl = `https://medicine.example.edu/labs/${slug}/`;
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug,
      name: `${leads[0][0]} Neonatal Outcomes Lab`,
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Pediatrics'],
      researchAreas: ['Neonatology'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
      shortDescription: READY_SHORT,
      fullDescription: READY_FULL,
      websiteUrl: sourceUrl,
      sourceUrls: [sourceUrl],
      activeAtYaleCache: true,
      fieldProvenance: {
        shortDescription: { sourceName: 'fixture-lab', sourceUrl },
        fullDescription: { sourceName: 'fixture-lab', sourceUrl },
      },
    });
    for (const [lastName, netid] of leads) await seedLead(entityId, lastName, netid);
  };

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    for (const name of [
      'research_entities',
      'role_assignments',
      'researchers',
      'visibility_release_queue_items',
      'signals',
      'observations',
      'directory_removals',
    ]) {
      await db.collection(name).deleteMany({});
    }
    personIdsByNetid.clear();
    process.env.DIRECTORY_REMOVAL_KEY = KEY;
    setDirectoryRemovalServingForTest(undefined);
    await seedLab(SOLE_LEAD_SLUG, [['Quill', 'zz9101']]);
    await seedLab(CO_LED_SLUG, [
      ['Teal', 'zz9102'],
      ['Quill', 'zz9101'],
    ]);
  });

  const recordRemoval = () =>
    mongoose.connection.db!.collection('directory_removals').insertOne({
      digest: directoryRemovalDigest(KEY, 'netid', 'zz9101'),
      kind: 'netid',
      recordedAt: new Date(),
    });

  it('suppresses the sole-lead row, keeps the co-led row, and holds on a second pass with no lock', async () => {
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    expect((await persisted(SOLE_LEAD_SLUG)).studentVisibilityTier).toBe('student_ready');

    await recordRemoval();
    setDirectoryRemovalServingForTest(undefined);
    for (let pass = 0; pass < 2; pass += 1) {
      await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
      const sole = await persisted(SOLE_LEAD_SLUG);
      expect(sole.studentVisibilityTier).toBe('suppressed');
      expect(sole.studentVisibilityReasons).toContain(RESEARCHER_REMOVED_REASON);
      expect(sole.studentVisibilityOverrideTier).toBeUndefined();
      expect(sole.manuallyLockedFields ?? []).toEqual([]);
      const coLed = await persisted(CO_LED_SLUG);
      expect(coLed.studentVisibilityReasons).not.toContain(RESEARCHER_REMOVED_REASON);
      expect(coLed.studentVisibilityTier).not.toBe('suppressed');
    }
  }, 60000);

  it('restores the row on the next pass once the entry is withdrawn', async () => {
    await recordRemoval();
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    expect((await persisted(SOLE_LEAD_SLUG)).studentVisibilityTier).toBe('suppressed');

    await mongoose.connection
      .db!.collection('directory_removals')
      .updateMany({}, { $set: { withdrawnAt: new Date(), withdrawnReason: 'requester_withdrew' } });
    setDirectoryRemovalServingForTest(undefined);
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    const restored = await persisted(SOLE_LEAD_SLUG);
    expect(restored.studentVisibilityReasons).not.toContain(RESEARCHER_REMOVED_REASON);
    expect(restored.studentVisibilityTier).toBe('student_ready');
  }, 60000);

  it('keeps serving the last snapshot while an expired one reloads in the background', async () => {
    const expired = 5 * 60_000;
    expect((await freshDirectoryRemovalServing(0)).state).toBe('inert');
    await recordRemoval();
    expect((await freshDirectoryRemovalServing(expired)).state).toBe('inert');
    await vi.waitFor(async () =>
      expect((await freshDirectoryRemovalServing(expired)).state).toBe('active'),
    );
  }, 60000);

  it("never lets a name entry end a namesake researcher's edges or suppress their row", async () => {
    await mongoose.connection.db!.collection('directory_removals').insertOne({
      digest: directoryRemovalDigest(KEY, 'name', 'Robin Quill'),
      kind: 'name',
      recordedAt: new Date(),
    });
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });
    const sole = await persisted(SOLE_LEAD_SLUG);
    expect(sole.studentVisibilityReasons).not.toContain(RESEARCHER_REMOVED_REASON);
    expect(sole.studentVisibilityTier).toBe('student_ready');
    expect(
      await mongoose.connection
        .db!.collection('role_assignments')
        .countDocuments({ archived: false }),
    ).toBe(3);
  }, 60000);

  it('refuses to run while entries exist and no key is configured', async () => {
    await recordRemoval();
    delete process.env.DIRECTORY_REMOVAL_KEY;
    setDirectoryRemovalServingForTest(undefined);
    await expect(
      runStudentVisibilityGate({ collection: 'research', mode: 'apply' }),
    ).rejects.toThrow(DIRECTORY_REMOVAL_GATE_REFUSAL);
    expect((await persisted(SOLE_LEAD_SLUG)).studentVisibilityTier).toBe('student_ready');
  }, 60000);
});
