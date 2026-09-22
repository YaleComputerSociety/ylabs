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
import { addResearchEntitySearchAliases } from '../researchEntityDto';

const ORGANIZATION_BODY =
  'The Northgate Measurement Based Care Collaborative is dedicated to implementation for systems, clinicians and clients, and advances measurement based care as an evidence-based practice through continued research.';
const ORGANIZATION_CARD =
  'The Office of Health Equity Research is the organizing center of health equity research at the medical school.';
const OWN_CARD = 'Studies mental health services and measurement based care.';
const CHIPS = ['Health Equity'];

const ORGANIZATION_CARD_SLUG = 'fixture-faculty-research-organization-card';
const OWN_CARD_SLUG = 'fixture-faculty-research-own-card';

describe("another organization's prose never reaches a person's card (#2915)", () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  }, 30000);

  const storedRow = (input: { slug: string; lastName: string; shortDescription: string }) => {
    const sourceUrl = `https://medicine.example.edu/profile/${input.lastName.toLowerCase()}/`;
    return {
      _id: new mongoose.Types.ObjectId(),
      slug: input.slug,
      name: `Robin ${input.lastName} - Research`,
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
      departments: ['Psychiatry'],
      researchAreas: [...CHIPS],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
      shortDescription: input.shortDescription,
      fullDescription: ORGANIZATION_BODY,
      websiteUrl: sourceUrl,
      sourceUrls: [sourceUrl],
      fieldProvenance: {
        shortDescription: { sourceName: 'fixture-faculty', sourceUrl },
        fullDescription: { sourceName: 'fixture-faculty', sourceUrl },
      },
    };
  };

  const seedRow = async (row: Record<string, any>) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').insertOne(row);
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: String(row.name).replace(' - Research', ''),
      firstName: 'Robin',
      lastName: String(row.name).split(' ')[1],
      netid: `fixture${String(row.slug).slice(-8)}`,
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: row._id },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      verifiedAt: new Date(),
      source: { name: 'fixture-faculty', url: row.websiteUrl },
    });
  };

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'role_assignments', 'researchers', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    await seedRow(
      storedRow({
        slug: ORGANIZATION_CARD_SLUG,
        lastName: 'Quill',
        shortDescription: ORGANIZATION_CARD,
      }),
    );
    await seedRow(storedRow({ slug: OWN_CARD_SLUG, lastName: 'Teal', shortDescription: OWN_CARD }));
  });

  it('serves no organizational prose anywhere in the detail payload', async () => {
    const detail = await getResearchGroupDetail(ORGANIZATION_CARD_SLUG);
    const served = detail?.researchEntity as Record<string, any> | undefined;

    expect(served).toBeDefined();
    expect(served?.fullDescription).toBe('');
    expect(served?.shortDescription).not.toContain('Office of Health Equity Research');
    expect(JSON.stringify(detail)).not.toContain('Office of Health Equity Research');
    expect(JSON.stringify(detail)).not.toContain('Northgate');
  }, 30000);

  it('keeps the row readable: it still resolves, with its chips, lead and links', async () => {
    const detail = await getResearchGroupDetail(ORGANIZATION_CARD_SLUG);
    const served = detail?.researchEntity as Record<string, any> | undefined;

    expect(served?.researchAreas).toEqual(CHIPS);
    expect(served?.sourceUrls?.length).toBeGreaterThan(0);
    expect(detail?.members?.length).toBeGreaterThan(0);
  }, 30000);

  it('serves no organizational prose on the browse card either', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const hit = await db.collection('research_entities').findOne({ slug: ORGANIZATION_CARD_SLUG });
    const listed = addResearchEntitySearchAliases({
      hits: [hit as Record<string, any>],
      estimatedTotalHits: 1,
      page: 1,
      pageSize: 18,
    });

    const card = listed.researchEntities[0];
    expect(card.shortDescription || '').not.toContain('Office of Health Equity Research');
    expect(JSON.stringify(listed)).not.toContain('Office of Health Equity Research');
    expect(JSON.stringify(listed)).not.toContain('Northgate');
    expect(card.researchAreas).toEqual(CHIPS);
  }, 30000);

  it("keeps a card that is the person's own prose when the body is withheld", async () => {
    const detail = await getResearchGroupDetail(OWN_CARD_SLUG);
    const served = detail?.researchEntity as Record<string, any> | undefined;

    expect(served?.fullDescription).toBe('');
    expect(served?.shortDescription).toBe(OWN_CARD);
    expect(served?.researchAreas).toEqual(CHIPS);
  }, 30000);
});
