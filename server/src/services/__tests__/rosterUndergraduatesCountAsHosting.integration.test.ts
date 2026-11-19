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

const SLUG = 'example-official-roster-lab';
const WEBSITE = 'https://examplelab.example.org/';

const seed = async (rosterEnrichment: Record<string, unknown>) => {
  await mongoose.connection.db!.collection('research_entities').insertOne({
    _id: new mongoose.Types.ObjectId(),
    slug: SLUG,
    name: 'Example Official Roster Lab',
    kind: 'lab',
    entityType: 'LAB',
    schemaVersion: 1,
    archived: false,
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    fullDescription:
      'The lab studies how example tissues repair after injury, combining imaging, genetics and computational modelling of cell behaviour.',
    websiteUrl: WEBSITE,
    sourceUrls: [WEBSITE],
    rosterEnrichment,
  });
};

describe('the detail page counts an official roster that lists undergraduates (#5232)', () => {
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
    await mongoose.connection.db!.collection('research_entities').deleteMany({});
  });

  it('serves the hosted flag from a roster the detail response withholds', async () => {
    await seed({
      state: 'current',
      observedAt: new Date('2020-01-01T00:00:00Z'),
      freshnessExpiresAt: new Date('2020-02-01T00:00:00Z'),
      sourceUrl: `${WEBSITE}people`,
      undergraduates: [{ name: 'Synthetic Alumna', status: 'past', endYear: 2019 }],
    });

    const detail = await getResearchGroupDetail(SLUG);

    expect(detail?.researchEntity.hasUndergradHostingEvidence).toBe(true);
    expect(detail?.researchEntity).not.toHaveProperty('rosterEnrichment');
  });

  it('serves no hosted flag when the roster withholds every undergraduate', async () => {
    await seed({
      state: 'withheld',
      observedAt: new Date('2020-01-01T00:00:00Z'),
      undergraduateWithheldCount: 3,
    });

    const detail = await getResearchGroupDetail(SLUG);

    expect(detail?.researchEntity).toBeDefined();
    expect(detail?.researchEntity.hasUndergradHostingEvidence).toBeUndefined();
  });
});
