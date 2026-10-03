import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: vi.fn(async () => ({
    search: mocks.search,
    getEmbedders: vi.fn(async () => ({})),
  })),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: mocks.syncEntities,
  syncEntity: mocks.syncEntity,
  deleteFromIndex: mocks.deleteFromIndex,
}));

import {
  getResearchGroupDetail,
  listResearchEntityRelationshipPayload,
  searchResearchGroupsViaMeili,
} from '../researchGroupService';
import { decideServedResearchEntityCreativePractice } from '../researchEntityDto';

const PRACTICE_SLUG = 'fixture-practice-violin';
const RESEARCH_SLUG = 'fixture-research-music-theory';
const SCHOOL_ONLY_PRACTICE_SLUG = 'fixture-practice-directing';

const PRACTICE_BODY =
  'Fixture Violinist has performed with orchestras across North America and Europe and appears regularly in recital at chamber music festivals. Her recordings of contemporary sonatas were released on two labels, and she has premiered works written for her by several living composers.';
const RESEARCH_BODY =
  'Fixture Theorist studies how listeners perceive meter in contemporary orchestral music, combining corpus analysis of scores with experiments on rhythm cognition, and has published widely on the history of music theory.';

const SCHOOL_ONLY_PRACTICE_BODY =
  'Fixture Director has directed productions on Broadway and at regional theaters across the country, and the original plays have toured internationally. Recent stage work includes new productions of classic repertory at festivals in Edinburgh and Avignon.';

const entityIdBySlug = new Map<string, mongoose.Types.ObjectId>();

const seedRow = async (
  slug: string,
  name: string,
  body: string,
  placement: { departments: string[]; school: string } = {
    departments: ['Music'],
    school: 'School of Music',
  },
) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const entityId = new mongoose.Types.ObjectId();
  entityIdBySlug.set(slug, entityId);
  const profileUrl = `https://music.example.edu/people/${slug}`;
  await db.collection('research_entities').insertOne({
    _id: entityId,
    slug,
    name,
    kind: 'individual',
    entityType: 'FACULTY_RESEARCH_AREA',
    archived: false,
    ...placement,
    researchAreas: ['Music'],
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    fullDescription: body,
    sourceUrls: [profileUrl],
  });
};

const browseCardFor = async (slug: string) => {
  const entityId = entityIdBySlug.get(slug);
  if (!entityId) throw new Error(`no seeded entity for ${slug}`);
  mocks.search.mockReset();
  mocks.search.mockResolvedValue({
    hits: [{ id: entityId.toString() }],
    estimatedTotalHits: 1,
    totalHits: 1,
  });
  const result = await searchResearchGroupsViaMeili('music', {}, 1, 24);
  return result.researchEntities.find((entity: any) => entity.slug === slug) as
    Record<string, any> | undefined;
};

describe('a creative practice row is labelled from its own body on every surface (#4519)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entities').deleteMany({});
    await db.collection('research_entity_relationships').deleteMany({});
    entityIdBySlug.clear();
    await seedRow(PRACTICE_SLUG, 'Fixture Violinist Faculty Research', PRACTICE_BODY);
    await seedRow(RESEARCH_SLUG, 'Fixture Theorist Faculty Research', RESEARCH_BODY);
  });

  it('serves the label on the detail page and the browse card of a performance biography', async () => {
    const detail = await getResearchGroupDetail(PRACTICE_SLUG);
    const card = await browseCardFor(PRACTICE_SLUG);

    expect(detail?.researchEntity.creativePractice).toBe(true);
    expect(card?.creativePractice).toBe(true);
  }, 60000);

  it('keeps arts research that states a research question as research', async () => {
    const detail = await getResearchGroupDetail(RESEARCH_SLUG);
    const card = await browseCardFor(RESEARCH_SLUG);

    expect(detail?.researchEntity).toBeDefined();
    expect(detail?.researchEntity.creativePractice).toBeUndefined();
    expect(card?.creativePractice).toBeUndefined();
  }, 60000);

  it('labels a related card placed in the arts only by its school, as its detail page does', async () => {
    await seedRow(
      SCHOOL_ONLY_PRACTICE_SLUG,
      'Fixture Director Faculty Research',
      SCHOOL_ONLY_PRACTICE_BODY,
      { departments: [], school: 'David Geffen School of Drama' },
    );
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    await db.collection('research_entity_relationships').insertOne({
      sourceResearchEntityId: entityIdBySlug.get(RESEARCH_SLUG),
      targetResearchEntityId: entityIdBySlug.get(SCHOOL_ONLY_PRACTICE_SLUG),
      relationshipType: 'MEMBER_RESEARCH_AREA',
      archived: false,
    });

    const detail = await getResearchGroupDetail(SCHOOL_ONLY_PRACTICE_SLUG);
    const payload = await listResearchEntityRelationshipPayload(
      entityIdBySlug.get(RESEARCH_SLUG)?.toString(),
    );
    const relatedCard = payload.relatedResearchEntities.find(
      (entity) => entity.slug === SCHOOL_ONLY_PRACTICE_SLUG,
    );

    expect(detail?.researchEntity.creativePractice).toBe(true);
    expect(relatedCard).toBeDefined();
    expect(relatedCard?.creativePractice).toBe(true);
  }, 60000);

  it('derives the same answer the eval attributes the served flag to', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const stored = await db.collection('research_entities').findOne({ slug: PRACTICE_SLUG });

    expect(decideServedResearchEntityCreativePractice(stored as any).creativePractice).toBe(true);
    expect(
      (await db.collection('research_entities').findOne({ slug: PRACTICE_SLUG }))?.creativePractice,
    ).toBeUndefined();
  }, 60000);
});
