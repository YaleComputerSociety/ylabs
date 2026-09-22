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

const STAFF_LED_SLUG = 'ysm-faculty-rowan-birch';
const PLURAL_STAFF_LED_SLUG = 'ysm-faculty-marlow-fen';
const RESEARCH_LADDER_LED_SLUG = 'ysm-faculty-ellis-thorn';
const PROFESSOR_LED_SLUG = 'ysm-faculty-noor-hale';

const READY_SHORT =
  'Studies estuary nitrogen cycling across Long Island Sound salt marsh restoration sites.';
const READY_FULL =
  'The group studies estuary nitrogen cycling across Long Island Sound salt marsh restoration sites, pairing seasonal porewater chemistry with sediment core incubations and remote-sensed vegetation change to explain why restored marshes retain nitrogen at very different rates.';

type PersistedVisibility = {
  studentVisibilityTier?: string;
  studentVisibilityReasons?: string[];
};

const persisted = (slug: string) =>
  ResearchEntity.findOne({ slug }).lean<PersistedVisibility>() as Promise<PersistedVisibility>;

describe('a non-research staff lead never carries a served research home (#1897)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  }, 30000);

  const seedLeadPerson = async (input: {
    entityId: mongoose.Types.ObjectId;
    lastName: string;
    title: string;
  }) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: `Robin ${input.lastName}`,
      firstName: 'Robin',
      lastName: input.lastName,
      netid: `fixture${input.lastName.toLowerCase()}`,
      archived: false,
      profile: { title: input.title },
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: input.entityId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      verifiedAt: new Date(),
      source: {
        name: 'ysm-faculty',
        url: `https://medicine.yale.edu/profile/${input.lastName.toLowerCase()}/`,
      },
    });
  };

  const seedServedEntity = async (input: { slug: string; name: string; leadTitle: string }) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const entityId = new mongoose.Types.ObjectId();
    const lastName = input.slug.split('-').slice(-1)[0];
    const sourceUrl = `https://medicine.yale.edu/lab/${lastName}/`;
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: input.slug,
      name: input.name,
      displayName: input.name,
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Environmental Health Sciences'],
      researchAreas: ['Biogeochemistry', 'Coastal ecology'],
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
    await seedLeadPerson({ entityId, lastName, title: input.leadTitle });
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
      slug: STAFF_LED_SLUG,
      name: 'Birch Estuary Nitrogen Group',
      leadTitle: 'Program Manager',
    });
    await seedServedEntity({
      slug: PLURAL_STAFF_LED_SLUG,
      name: 'Fen Salt Marsh Restoration Group',
      leadTitle: 'Program Managers',
    });
    await seedServedEntity({
      slug: RESEARCH_LADDER_LED_SLUG,
      name: 'Thorn Sediment Biogeochemistry Group',
      leadTitle: 'Associate Research Scientist',
    });
    await seedServedEntity({
      slug: PROFESSOR_LED_SLUG,
      name: 'Hale Coastal Nitrogen Lab',
      leadTitle: 'Professor of Epidemiology',
    });
  }, 30000);

  it('stops serving a row whose only lead holds a staff appointment, and routes it to lead attachment', async () => {
    expect(await getResearchGroupDetail(STAFF_LED_SLUG)).not.toBeNull();

    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const gated = await persisted(STAFF_LED_SLUG);
    expect(gated.studentVisibilityTier).not.toBe('student_ready');
    expect(gated.studentVisibilityReasons).toContain('missing_lead');
    expect(await getResearchGroupDetail(STAFF_LED_SLUG)).toBeNull();
  }, 60000);

  it('reads a pluralised staff title the same way as its singular', async () => {
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const gated = await persisted(PLURAL_STAFF_LED_SLUG);
    expect(gated.studentVisibilityTier).not.toBe('student_ready');
    expect(gated.studentVisibilityReasons).toContain('missing_lead');
    expect(await getResearchGroupDetail(PLURAL_STAFF_LED_SLUG)).toBeNull();
  }, 60000);

  it('keeps serving a research-ladder lead, whose independence the title does not reveal', async () => {
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const gated = await persisted(RESEARCH_LADDER_LED_SLUG);
    expect(gated.studentVisibilityReasons).not.toContain('missing_lead');
    expect(gated.studentVisibilityTier).toBe('student_ready');
    expect(await getResearchGroupDetail(RESEARCH_LADDER_LED_SLUG)).not.toBeNull();
  }, 60000);

  it('leaves a professor-led row served exactly as before', async () => {
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const gated = await persisted(PROFESSOR_LED_SLUG);
    expect(gated.studentVisibilityReasons).not.toContain('missing_lead');
    expect(gated.studentVisibilityTier).toBe('student_ready');
    expect(await getResearchGroupDetail(PROFESSOR_LED_SLUG)).not.toBeNull();
  }, 60000);
});
