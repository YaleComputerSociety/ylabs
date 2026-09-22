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

const READY_SHORT =
  'Studies neonatal care quality improvement across community hospital nurseries in Connecticut.';
const READY_FULL =
  'The lab studies neonatal care quality improvement across community hospital nurseries, combining bedside outcome audits, staffing and transfer pattern analysis, and implementation trials of standardized resuscitation protocols to reduce avoidable transfers to tertiary intensive care.';

interface SeedInput {
  slug: string;
  storedName: string;
}

const leadNameOn = async (slug: string): Promise<string | undefined> => {
  const detail = await getResearchGroupDetail(slug);
  const lead = detail?.members.find((member) => member.role === 'pi');
  return lead?.user?.displayName;
};

describe('scraped furniture in a stored person name never reaches a student', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  const seedServedEntity = async (input: SeedInput) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const entityId = new mongoose.Types.ObjectId();
    const personId = new mongoose.Types.ObjectId();
    const sourceUrl = `https://medicine.yale.edu/profile/${input.slug}/`;
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: input.storedName,
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      verifiedAt: new Date(),
      source: { name: 'ysm-faculty', url: sourceUrl },
    });
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: input.slug,
      name: 'Neonatal Outcomes Lab',
      displayName: 'Neonatal Outcomes Lab',
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Pediatrics'],
      researchAreas: ['Neonatology'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
      shortDescription: READY_SHORT,
      fullDescription: READY_FULL,
      websiteUrl: sourceUrl,
      sourceUrls: [sourceUrl],
      fieldProvenance: {
        shortDescription: { sourceName: 'ysm-faculty', sourceUrl },
        fullDescription: { sourceName: 'ysm-faculty', sourceUrl },
      },
    });
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
  });

  it('serves the name under an image-caption wrapper', async () => {
    await seedServedEntity({ slug: 'caption-lab', storedName: 'Photo of Robin Quill.' });
    expect(await leadNameOn('caption-lab')).toBe('Robin Quill');
  }, 30000);

  it('serves the name under a post-nominal credential list', async () => {
    await seedServedEntity({ slug: 'credential-lab', storedName: 'Robin Quill, PhD, MPH, FACE' });
    expect(await leadNameOn('credential-lab')).toBe('Robin Quill');
  }, 30000);

  it('serves a shouty stored name in ordinary casing', async () => {
    await seedServedEntity({ slug: 'shouty-lab', storedName: 'ROBIN QUILL' });
    expect(await leadNameOn('shouty-lab')).toBe('Robin Quill');
  }, 30000);

  it('serves the name without a former-name annotation', async () => {
    await seedServedEntity({ slug: 'former-name-lab', storedName: 'Robin Teal f.k.a. Quill' });
    expect(await leadNameOn('former-name-lab')).toBe('Robin Teal');
  }, 30000);

  it('keeps serving a slug-shaped stored name rather than leaving the lead nameless', async () => {
    await seedServedEntity({ slug: 'slug-lab', storedName: 'quill_robin' });
    expect(await leadNameOn('slug-lab')).toBe('quill_robin');
  }, 30000);

  it('leaves a legitimate name untouched', async () => {
    await seedServedEntity({ slug: 'clean-lab', storedName: "Robin D'Onofrio Jr." });
    expect(await leadNameOn('clean-lab')).toBe("Robin D'Onofrio Jr.");
  }, 30000);
});
