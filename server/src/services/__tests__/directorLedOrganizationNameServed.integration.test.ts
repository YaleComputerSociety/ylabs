import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

vi.mock('../../utils/meiliClient', () => {
  const searchIndex = vi.fn(async () => ({
    search: mocks.search,
    getEmbedders: vi.fn(async () => ({})),
  }));
  return { getMeiliIndex: searchIndex, getMeiliSearchIndex: searchIndex };
});

vi.mock('../meiliSyncService', () => ({
  syncEntities: mocks.syncEntities,
  syncEntity: mocks.syncEntity,
  deleteFromIndex: mocks.deleteFromIndex,
}));

import { getResearchGroupDetail, searchResearchGroupsViaMeili } from '../researchGroupService';

const ORGANIZATION_NAME = 'Fixture Mood Research Program';
const DIRECTOR_LED_SLUG = 'sloan-lab-as12';
const PI_LED_SLUG = 'quill-lab-bq34';

const SHORT = 'Studies the causes and treatment of mood disorders across the lifespan.';
const FULL =
  'A multidisciplinary program studying the causes and treatment of mood disorders across the lifespan, with neuroimaging and genetics.';

const entityIdBySlug = new Map<string, mongoose.Types.ObjectId>();

const seedOrganizationOnPersonKey = async (input: {
  slug: string;
  role: string;
  firstName: string;
  lastName: string;
}) => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const entityId = new mongoose.Types.ObjectId();
  entityIdBySlug.set(input.slug, entityId);
  await db.collection('research_entities').insertOne({
    _id: entityId,
    slug: input.slug,
    name: ORGANIZATION_NAME,
    kind: 'initiative',
    entityType: 'INITIATIVE',
    archived: false,
    departments: ['Psychiatry'],
    researchAreas: ['Mood disorders'],
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
    shortDescription: SHORT,
    fullDescription: FULL,
    websiteUrl: 'https://medicine.yale.edu/psychiatry/research/fixture-mood/',
    sourceUrls: [
      `https://medicine.yale.edu/profile/fixture-${input.lastName.toLowerCase()}/`,
      'https://medicine.yale.edu/psychiatry/research/fixture-mood/',
    ],
  });
  const personId = new mongoose.Types.ObjectId();
  await db.collection('researchers').insertOne({
    _id: personId,
    displayName: `${input.firstName} ${input.lastName}`,
    firstName: input.firstName,
    lastName: input.lastName,
    netid: `fixture${input.lastName.toLowerCase()}`,
    archived: false,
  });
  await db.collection('role_assignments').insertOne({
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: entityId },
    role: input.role,
    state: 'CURRENT',
    archived: false,
    verifiedAt: new Date(),
    source: {
      name: 'ysm-faculty',
      url: `https://medicine.yale.edu/profile/fixture-${input.lastName.toLowerCase()}/`,
    },
  });
};

const searchCardFor = async (slug: string) => {
  const entityId = entityIdBySlug.get(slug);
  if (!entityId) throw new Error(`no seeded entity for ${slug}`);
  mocks.search.mockReset();
  mocks.search.mockResolvedValue({
    hits: [{ id: entityId.toString() }],
    estimatedTotalHits: 1,
    totalHits: 1,
  });
  const result = await searchResearchGroupsViaMeili('mood', {}, 1, 24);
  return result.researchEntities.find((entity: any) => entity.slug === slug) as
    Record<string, any> | undefined;
};

describe('an organization name on a person-keyed row its director leads is served (#5085)', () => {
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
    for (const name of ['research_entities', 'role_assignments', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
    entityIdBySlug.clear();
    await seedOrganizationOnPersonKey({
      slug: DIRECTOR_LED_SLUG,
      role: 'DIRECTOR',
      firstName: 'Avery',
      lastName: 'Sloan',
    });
    await seedOrganizationOnPersonKey({
      slug: PI_LED_SLUG,
      role: 'PI',
      firstName: 'Blair',
      lastName: 'Quill',
    });
  });

  it('titles the detail page and the search card with the organization name', async () => {
    const detail = await getResearchGroupDetail(DIRECTOR_LED_SLUG);
    const card = await searchCardFor(DIRECTOR_LED_SLUG);

    expect(detail?.researchEntity.name).toBe(ORGANIZATION_NAME);
    expect(card?.name).toBe(ORGANIZATION_NAME);
  }, 60000);

  it('still replaces the organization name on a row its lead is only a PI of', async () => {
    const detail = await getResearchGroupDetail(PI_LED_SLUG);
    const card = await searchCardFor(PI_LED_SLUG);

    expect(detail?.researchEntity.name).not.toBe(ORGANIZATION_NAME);
    expect(card?.name).not.toBe(ORGANIZATION_NAME);
  }, 60000);
});
