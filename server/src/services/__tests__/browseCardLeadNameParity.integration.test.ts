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

import { getResearchGroupDetail, searchResearchGroupsViaMeili } from '../researchGroupService';

const GRAFT_SLUG = 'fixture-third-party-possessive-graft';
const OWN_LEAD_SLUG = 'fixture-own-lead-possessive';
const LEAD_DISPLAY_NAME = 'Robin Quill';

const GRAFT_SHORT =
  "Marguerite Delacroix's research examines capillary barrier failure in critically ill newborns.";
const GRAFT_FULL =
  "Marguerite Delacroix's research examines capillary barrier failure during critical illness, combining endothelial cell biology, permeability assays, and bedside microvascular imaging in newborn intensive care.";
const REPAIRED_SHORT =
  'This research examines capillary barrier failure in critically ill newborns.';
const REPAIRED_FULL =
  'This research examines capillary barrier failure during critical illness, combining endothelial cell biology, permeability assays, and bedside microvascular imaging in newborn intensive care.';

const OWN_LEAD_SHORT =
  "Dr. Quill's research examines capillary barrier failure in critically ill newborns.";
const OWN_LEAD_FULL =
  "Dr. Quill's research examines capillary barrier failure during critical illness, combining endothelial cell biology, permeability assays, and bedside microvascular imaging in newborn intensive care.";

interface SeedInput {
  slug: string;
  shortDescription: string;
  fullDescription: string;
}

/**
 * Browse and the detail page must serve one string per row. They diverged because only
 * the detail path supplied the roster-derived lead names, so the mismatched-person-name
 * strip was a structural no-op on every card surface (#2240). The unit suites hand the
 * names in directly, so this exercises the part they cannot: a real roster read from
 * Mongo through the Meilisearch browse path, its Mongo fallback, and the detail route.
 */
describe('a browse card serves the same repaired copy as its own detail page (#2240)', () => {
  let replSet: MongoMemoryReplSet;
  const entityIdBySlug = new Map<string, mongoose.Types.ObjectId>();

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  const seedEntity = async (input: SeedInput) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const entityId = new mongoose.Types.ObjectId();
    entityIdBySlug.set(input.slug, entityId);
    const sourceUrl = `https://medicine.example.edu/profile/${input.slug}/`;
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: input.slug,
      name: 'Quill Capillary Barrier Lab',
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Pediatrics'],
      researchAreas: ['Vascular Biology', 'Critical Care'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
      shortDescription: input.shortDescription,
      fullDescription: input.fullDescription,
      websiteUrl: sourceUrl,
      sourceUrls: [sourceUrl],
      browseRankScore: 90,
      fieldProvenance: {
        shortDescription: { sourceName: 'fixture-faculty', sourceUrl },
        fullDescription: { sourceName: 'fixture-faculty', sourceUrl },
        researchAreas: { sourceName: 'fixture-faculty', sourceUrl },
      },
    });

    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: LEAD_DISPLAY_NAME,
      firstName: 'Robin',
      lastName: 'Quill',
      netid: `fixture${input.slug.slice(-6)}`,
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

  const browseCardFor = async (slug: string, options: { meiliDown?: boolean } = {}) => {
    const entityId = entityIdBySlug.get(slug);
    if (!entityId) throw new Error(`no seeded entity for ${slug}`);
    mocks.search.mockReset();
    if (options.meiliDown) {
      mocks.search.mockRejectedValue(new Error('meilisearch unavailable'));
    } else {
      mocks.search.mockResolvedValue({
        hits: [{ id: entityId.toString() }],
        estimatedTotalHits: 1,
        totalHits: 1,
      });
    }
    const result = await searchResearchGroupsViaMeili('capillary barrier', {}, 1, 24);
    return result.researchEntities.find((entity: any) => entity.slug === slug) as
      | Record<string, any>
      | undefined;
  };

  const detailCopyFor = async (slug: string) => {
    const detail = await getResearchGroupDetail(slug);
    return detail?.researchEntity as Record<string, any> | undefined;
  };

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'role_assignments', 'researchers', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    entityIdBySlug.clear();
    await seedEntity({
      slug: GRAFT_SLUG,
      shortDescription: GRAFT_SHORT,
      fullDescription: GRAFT_FULL,
    });
    await seedEntity({
      slug: OWN_LEAD_SLUG,
      shortDescription: OWN_LEAD_SHORT,
      fullDescription: OWN_LEAD_FULL,
    });
  });

  it('strips a third-party possessive on the browse card, matching the detail page', async () => {
    const card = await browseCardFor(GRAFT_SLUG);
    const detail = await detailCopyFor(GRAFT_SLUG);

    expect(card?.shortDescription).toBe(REPAIRED_SHORT);
    expect(card?.cardDescription?.text).toBe(REPAIRED_SHORT);
    expect(JSON.stringify(card)).not.toContain('Marguerite Delacroix');

    expect(detail?.shortDescription).toBe(card?.shortDescription);
    expect(detail?.fullDescription).toBe(REPAIRED_FULL);
  }, 60000);

  it('strips the same possessive on the degraded Mongo browse fallback', async () => {
    const card = await browseCardFor(GRAFT_SLUG, { meiliDown: true });

    expect(card?.shortDescription).toBe(REPAIRED_SHORT);
    expect(card?.cardDescription?.text).toBe(REPAIRED_SHORT);
    expect(JSON.stringify(card)).not.toContain('Marguerite Delacroix');
  }, 60000);

  it("keeps a possessive naming the row's own lead on both surfaces", async () => {
    const card = await browseCardFor(OWN_LEAD_SLUG);
    const detail = await detailCopyFor(OWN_LEAD_SLUG);

    expect(card?.shortDescription).toBe(OWN_LEAD_SHORT);
    expect(card?.cardDescription?.text).toBe(OWN_LEAD_SHORT);
    expect(detail?.shortDescription).toBe(card?.shortDescription);
    expect(detail?.fullDescription).toBe(OWN_LEAD_FULL);
  }, 60000);
});
