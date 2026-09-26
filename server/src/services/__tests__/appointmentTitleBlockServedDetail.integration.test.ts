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

const TITLE_BLOCK =
  'Professor of Internal Medicine (Medical Oncology) Director, Clinical Trials Office; Chief Clinical Research Officer, Yale Cancer Centre; Associate Director, Clinical Sciences, Yale Cancer Centre';
const RESEARCH_BODY =
  'This research programme studies how tumour cells escape endocrine therapy in advanced breast cancer, and develops circulating-tumour-DNA assays that report resistance before a scan can.';
const CARD = 'Studies endocrine-therapy resistance in advanced breast cancer.';

const SLUG = 'fixture-glued-appointment-title-block';

describe('a glued appointment-title block never reaches the served detail body (#1815)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'role_assignments', 'researchers', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    const sourceUrl = 'https://medicine.example.edu/profile/robin-quill/';
    const entityId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: SLUG,
      name: 'Robin Quill - Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
      departments: ['Internal Medicine'],
      researchAreas: ['Breast Cancer'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
      shortDescription: CARD,
      fullDescription: `${TITLE_BLOCK} ${RESEARCH_BODY}`,
      websiteUrl: sourceUrl,
      sourceUrls: [sourceUrl],
      fieldProvenance: {
        shortDescription: { sourceName: 'fixture-faculty', sourceUrl },
        fullDescription: { sourceName: 'fixture-faculty', sourceUrl },
      },
    });
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: 'Robin Quill',
      firstName: 'Robin',
      lastName: 'Quill',
      netid: 'fixtureglued1815',
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
  });

  it('serves the research sentence and none of the title list', async () => {
    const detail = await getResearchGroupDetail(SLUG);
    const served = detail?.researchEntity as Record<string, any> | undefined;

    expect(served).toBeDefined();
    expect(served?.fullDescription).toBe(RESEARCH_BODY);
    expect(served?.fullDescription).not.toContain('Clinical Trials Office');
    expect(JSON.stringify(detail)).not.toContain('Chief Clinical Research Officer');
  }, 30000);

  it('keeps the row readable: card, chips and lead survive the strip', async () => {
    const detail = await getResearchGroupDetail(SLUG);
    const served = detail?.researchEntity as Record<string, any> | undefined;

    expect(served?.shortDescription).toBe(CARD);
    expect(served?.researchAreas).toEqual(['Breast Cancer']);
    expect(detail?.members?.length).toBeGreaterThan(0);
  }, 30000);
});
