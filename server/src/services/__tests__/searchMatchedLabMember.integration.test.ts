import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
}));

vi.mock('../../utils/meiliClient', () => ({
  getMeiliSearchIndex: vi.fn(async () => ({
    search: mocks.search,
    getEmbedders: vi.fn(async () => ({})),
  })),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

import { searchResearchGroupsViaMeili } from '../researchGroupService';

const SLUG = 'fixture-matched-member-lab';
const SOURCE_URL = 'https://medicine.example.edu/lab/fixture/';
const ROSTER_URL = 'https://medicine.example.edu/lab/fixture/people/';
const LEAD = { displayName: 'Robin Quill', firstName: 'Robin', lastName: 'Quill' };
const ROSTER_FACULTY = {
  displayName: 'Casey Fernhollow',
  firstName: 'Casey',
  lastName: 'Fernhollow',
};
const UNLISTED_FACULTY = {
  displayName: 'Jordan Marrowind',
  firstName: 'Jordan',
  lastName: 'Marrowind',
};

describe('a person-name search names the lab member the lab page lists', () => {
  let replSet: MongoMemoryReplSet;
  let entityId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  const seedPerson = async (
    person: { displayName: string; firstName: string; lastName: string },
    role: string,
    assignment: Record<string, unknown>,
  ) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      ...person,
      netid: `fixture${person.lastName.toLowerCase().slice(0, 4)}`,
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role,
      state: 'CURRENT',
      archived: false,
      verifiedAt: new Date(),
      ...assignment,
    });
  };

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'role_assignments', 'researchers', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    entityId = new mongoose.Types.ObjectId();
    const observedAt = new Date();
    const membershipKey = 'fixture-roster-membership';
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: SLUG,
      name: 'Quill Capillary Barrier Lab',
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Pediatrics'],
      researchAreas: ['Vascular Biology', 'Critical Care'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
      shortDescription:
        'This research examines capillary barrier failure in critically ill newborns.',
      fullDescription:
        'This research examines capillary barrier failure during critical illness, combining endothelial cell biology, permeability assays, and bedside microvascular imaging in newborn intensive care.',
      websiteUrl: SOURCE_URL,
      sourceUrls: [SOURCE_URL],
      browseRankScore: 90,
      fieldProvenance: {
        shortDescription: { sourceName: 'fixture-faculty', sourceUrl: SOURCE_URL },
        fullDescription: { sourceName: 'fixture-faculty', sourceUrl: SOURCE_URL },
        researchAreas: { sourceName: 'fixture-faculty', sourceUrl: SOURCE_URL },
      },
      rosterEnrichment: {
        state: 'current',
        observedAt,
        sourceUrl: ROSTER_URL,
        memberKeys: [membershipKey],
      },
    });
    await seedPerson(LEAD, 'PI', { source: { name: 'fixture-faculty', url: SOURCE_URL } });
    await seedPerson(ROSTER_FACULTY, 'CORE_FACULTY', {
      source: { name: 'official-research-home-roster', url: ROSTER_URL },
      rosterProvenance: {
        sourceName: 'official-research-home-roster',
        sourceUrl: ROSTER_URL,
        evidenceStatus: 'verified',
        membershipKey,
        observedAt,
        freshnessExpiresAt: new Date(observedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    await seedPerson(UNLISTED_FACULTY, 'CORE_FACULTY', {
      source: { name: 'fixture-faculty', url: SOURCE_URL },
    });
    mocks.search.mockReset();
    mocks.search.mockResolvedValue({
      hits: [{ id: entityId.toString() }],
      estimatedTotalHits: 1,
      totalHits: 1,
    });
  });

  const cardFor = async (query: string) => {
    const result = await searchResearchGroupsViaMeili(query, {}, 1, 24);
    return result.researchEntities.find((entity: any) => entity.slug === SLUG) as
      Record<string, any> | undefined;
  };

  it('names a member the team section lists, alongside the lead', async () => {
    const card = await cardFor(ROSTER_FACULTY.displayName);
    expect(card?.matchedMemberName).toBe(ROSTER_FACULTY.displayName);
    expect(card?.leadName).toBe(LEAD.displayName);
  }, 60000);

  it('names nobody for a member the lab page does not list', async () => {
    const card = await cardFor(UNLISTED_FACULTY.displayName);
    expect(card).toBeDefined();
    expect(card?.matchedMemberName).toBeUndefined();
  }, 60000);

  it('names the lead on a plain browse card without matching a member', async () => {
    const card = await cardFor('');
    expect(card?.leadName).toBe(LEAD.displayName);
    expect(card?.matchedMemberName).toBeUndefined();
  }, 60000);
});
