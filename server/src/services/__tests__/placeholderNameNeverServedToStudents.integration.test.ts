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
import { getResearchGroupDetail } from '../researchGroupService';
import { runStudentVisibilityGate } from '../studentVisibilityGateService';

const PLACEHOLDER_SLUG = 'ysm-faculty-avery-quill';
const ALIAS_SLUG = 'ysm-faculty-morgan-teal';
const READY_SHORT =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const READY_FULL =
  'The lab studies neonatal care quality improvement across community hospital nurseries, combining bedside outcome audits, staffing and transfer pattern analysis, and implementation trials of standardized resuscitation protocols to reduce avoidable transfers to tertiary intensive care.';

type PersistedVisibility = {
  name?: string;
  displayName?: string;
  studentVisibilityTier?: string;
  studentVisibilityReasons?: string[];
};

const persisted = (slug: string) =>
  ResearchEntity.findOne({ slug }).lean<PersistedVisibility>() as Promise<PersistedVisibility>;

describe('a placeholder entity name never reaches a student (#2367)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  }, 30000);

  const seedPi = async (entityId: mongoose.Types.ObjectId, lastName: string) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: `Robin ${lastName}`,
      firstName: 'Robin',
      lastName,
      netid: `fixture${lastName.toLowerCase()}`,
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      verifiedAt: new Date(),
      source: { name: 'ysm-faculty', url: `https://medicine.yale.edu/profile/${lastName}/` },
    });
  };

  const seedServedEntity = async (input: {
    slug: string;
    name: string;
    displayName: string;
    lastName: string;
  }) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const entityId = new mongoose.Types.ObjectId();
    const sourceUrl = `https://medicine.yale.edu/profile/${input.lastName}/`;
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: input.slug,
      name: input.name,
      displayName: input.displayName,
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Pediatrics'],
      researchAreas: ['Neonatology', 'Health services research'],
      // The reported record was already published: it is served until the gate
      // re-runs, which is what the student-facing assertions below pin.
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
      shortDescription: READY_SHORT,
      fullDescription: READY_FULL,
      websiteUrl: sourceUrl,
      sourceUrls: [sourceUrl],
      fieldProvenance: {
        shortDescription: { sourceName: 'ysm-faculty', sourceUrl },
        fullDescription: { sourceName: 'ysm-faculty', sourceUrl },
        displayName: { sourceName: 'ysm-faculty', sourceUrl },
      },
    });
    await seedPi(entityId, input.lastName);
    return entityId;
  };

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'research_entities',
      'role_assignments',
      'researchers',
      'visibility_release_queue_items',
      'signals',
      'observations',
    ]) {
      await db.collection(name).deleteMany({});
    }
    await seedServedEntity({
      slug: PLACEHOLDER_SLUG,
      name: 'n/a',
      displayName: 'n/a',
      lastName: 'Quill',
    });
    await seedServedEntity({
      slug: ALIAS_SLUG,
      name: 'Teal Neonatal Outcomes Lab',
      displayName: 'n/a',
      lastName: 'Teal',
    });
  });

  it('serves a stored placeholder name until the gate re-runs, then holds it for operator review', async () => {
    const before = await getResearchGroupDetail(PLACEHOLDER_SLUG);
    expect(before).not.toBeNull();

    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const gated = await persisted(PLACEHOLDER_SLUG);
    expect(gated.studentVisibilityTier).toBe('operator_review');
    expect(gated.studentVisibilityReasons).toContain('unusable_name');
    expect(await getResearchGroupDetail(PLACEHOLDER_SLUG)).toBeNull();
  }, 30000);

  it('keeps a real-named record student_ready and titles it with the name, not the placeholder alias', async () => {
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const gated = await persisted(ALIAS_SLUG);
    expect(gated.studentVisibilityTier).toBe('student_ready');
    expect(gated.studentVisibilityReasons).not.toContain('unusable_name');

    const detail = await getResearchGroupDetail(ALIAS_SLUG);
    const served = detail?.researchEntity as Record<string, any> | undefined;
    expect(served?.name).toBe('Teal Neonatal Outcomes Lab');
    expect(served?.displayName || served?.name).toBe('Teal Neonatal Outcomes Lab');
  }, 30000);
});
