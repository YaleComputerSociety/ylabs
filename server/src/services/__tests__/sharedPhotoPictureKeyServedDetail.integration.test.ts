import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

const SLUG = 'fixture-shared-photo-picture-key';
const LEAD_PHOTO =
  'https://fixture.yale.edu/sites/default/files/styles/portrait/public/pictures/picture-4242-1600000000.jpg';
const SAME_PICTURE_OTHER_UPLOAD =
  'https://fixture.yale.edu/sites/default/files/pictures/picture-4242-1700000000.jpg';
const UNRELATED_PICTURE =
  'https://fixture.yale.edu/sites/default/files/pictures/picture-9191-1700000000.jpg';

async function seed(otherResearcherPhoto: string) {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  for (const name of ['research_entities', 'role_assignments', 'researchers', 'signals']) {
    await db.collection(name).deleteMany({});
  }
  const sourceUrl = 'https://fixture.yale.edu/research/avery-synthetic';
  const entityId = new mongoose.Types.ObjectId();
  await db.collection('research_entities').insertOne({
    _id: entityId,
    slug: SLUG,
    name: 'Avery Synthetic - Research',
    kind: 'individual',
    entityType: 'FACULTY_RESEARCH_AREA',
    archived: false,
    departments: ['Fixture Studies'],
    researchAreas: ['Fixture Topics'],
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    shortDescription: 'Studies synthetic fixtures.',
    fullDescription: 'This research programme studies synthetic fixtures for tests.',
    websiteUrl: sourceUrl,
    sourceUrls: [sourceUrl],
  });
  const leadId = new mongoose.Types.ObjectId();
  await db.collection('researchers').insertMany([
    {
      _id: leadId,
      displayName: 'Avery Synthetic',
      firstName: 'Avery',
      lastName: 'Synthetic',
      netid: 'fixturephoto5640a',
      archived: false,
      profile: { imageUrl: LEAD_PHOTO },
    },
    {
      _id: new mongoose.Types.ObjectId(),
      displayName: 'Blair Fixture',
      firstName: 'Blair',
      lastName: 'Fixture',
      netid: 'fixturephoto5640b',
      archived: false,
      profile: { imageUrl: otherResearcherPhoto },
    },
  ]);
  await db.collection('role_assignments').insertOne({
    personId: leadId,
    target: { kind: 'RESEARCH_ENTITY', id: entityId },
    role: 'PI',
    state: 'CURRENT',
    archived: false,
    verifiedAt: new Date(),
    source: { name: 'fixture-faculty', url: sourceUrl },
  });
}

async function servedLeadPhoto(): Promise<string | undefined> {
  const detail = await getResearchGroupDetail(SLUG);
  const lead = (detail?.members ?? []).find((member: any) => member.user?.lname === 'Synthetic');
  expect(lead).toBeDefined();
  return (lead as any)?.user?.imageUrl;
}

describe('a photo another person holds under a different upload of the same picture is withheld (#5640)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  it('withholds the lead photo when a differently named researcher holds the same picture id', async () => {
    await seed(SAME_PICTURE_OTHER_UPLOAD);
    expect(await servedLeadPhoto()).toBe('');
  }, 30000);

  it('serves the lead photo when the other researcher holds a different picture', async () => {
    await seed(UNRELATED_PICTURE);
    expect(await servedLeadPhoto()).toBe(LEAD_PHOTO);
  }, 30000);
});
