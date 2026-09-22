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

import { getResearchGroupDetail } from '../researchGroupService';

const SOURCED_SLUG = 'fixture-sourced-incoherent-chips';
const UNSOURCED_SLUG = 'fixture-unsourced-incoherent-chips';
const READY_SHORT =
  'Studies capillary barrier failure and endothelial permeability in critically ill newborns.';
const READY_FULL =
  'The lab investigates capillary barrier failure during critical illness, combining endothelial cell biology, permeability assays, and bedside microvascular imaging in newborn intensive care.';
const INCOHERENT_CHIPS = ['Sociolinguistic Fieldwork', 'Archival Ethnography'];

describe('a sourced research-area chip reaches the detail route (#2898)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  }, 30000);

  const seedEntity = async (input: { slug: string; lastName: string; sourced: boolean }) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const entityId = new mongoose.Types.ObjectId();
    const sourceUrl = `https://medicine.example.edu/profile/${input.lastName}/`;
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: input.slug,
      name: `${input.lastName} Capillary Barrier Lab`,
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Pediatrics'],
      researchAreas: [...INCOHERENT_CHIPS],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
      shortDescription: READY_SHORT,
      fullDescription: READY_FULL,
      websiteUrl: sourceUrl,
      sourceUrls: [sourceUrl],
      fieldProvenance: {
        shortDescription: { sourceName: 'fixture-faculty', sourceUrl },
        fullDescription: { sourceName: 'fixture-faculty', sourceUrl },
        ...(input.sourced ? { researchAreas: { sourceName: 'fixture-faculty', sourceUrl } } : {}),
      },
    });
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: `Robin ${input.lastName}`,
      firstName: 'Robin',
      lastName: input.lastName,
      netid: `fixture${input.lastName.toLowerCase()}`,
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      verifiedAt: new Date(),
      source: { name: 'fixture-faculty', url: sourceUrl },
    });
  };

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'role_assignments', 'researchers', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    await seedEntity({ slug: SOURCED_SLUG, lastName: 'Quill', sourced: true });
    await seedEntity({ slug: UNSOURCED_SLUG, lastName: 'Teal', sourced: false });
  });

  it('serves every chip the corpus records a source for, alien vocabulary included', async () => {
    const detail = await getResearchGroupDetail(SOURCED_SLUG);
    const served = detail?.researchEntity as Record<string, any> | undefined;

    expect(served?.researchAreas).toEqual(INCOHERENT_CHIPS);
  }, 30000);

  it('still drops an unsourced chip the entity has no vocabulary in common with', async () => {
    const detail = await getResearchGroupDetail(UNSOURCED_SLUG);
    const served = detail?.researchEntity as Record<string, any> | undefined;

    expect(served?.researchAreas).toEqual([]);
  }, 30000);

  it('never serves provenance to a student', async () => {
    const detail = await getResearchGroupDetail(SOURCED_SLUG);
    const served = detail?.researchEntity as Record<string, any> | undefined;

    expect(served).toBeDefined();
    expect(Object.keys(served || {})).not.toContain('fieldProvenance');
    expect(JSON.stringify(detail)).not.toContain('fieldProvenance');
  }, 30000);
});
