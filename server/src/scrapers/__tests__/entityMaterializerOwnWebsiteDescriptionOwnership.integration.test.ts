import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { resetDescriptionOwnershipCitersCache } from '../descriptionOwnershipResolverScreen';
import { materializeEntity } from '../entityMaterializer';

const LAB_SITE = 'https://tidepool-lab.example.org/';
const LAB_PAGE = 'https://tidepool-lab.example.org/research/';
const LAB_SLUG = 'tidepool-lab-ownership-fixture';
const MEMBER_SLUGS = ['tidepool-member-one-fixture', 'tidepool-member-two-fixture'];
const LAB_BODY =
  'The lab studies how intertidal invertebrates tolerate heat stress, pairing field surveys of rocky shores with physiology experiments on thermal limits.';

const seedDescription = (entityKey: string, value: string) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey,
    field: 'fullDescription',
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'synthetic-description-source',
    sourceUrl: LAB_PAGE,
    confidence: 0.9,
    observedAt: new Date(),
    superseded: false,
  });

const plannedFullDescription = async (slug: string) =>
  (await materializeEntity('researchEntity', { entityKey: slug }, { dryRun: true })).plannedSet
    ?.fullDescription;

describe('a lab owns the page that is its own website in the description ownership screen', () => {
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
    for (const name of ['observations', 'research_entities'])
      await db.collection(name).deleteMany({});
    resetDescriptionOwnershipCitersCache();
    await ResearchEntity.create({
      slug: LAB_SLUG,
      name: 'Tidepool Physiology Lab',
      kind: 'lab',
      entityType: 'LAB',
      websiteUrl: LAB_SITE,
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    await ResearchEntity.create({
      slug: MEMBER_SLUGS[0],
      name: 'Quillon Varnadore',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      websiteUrl: LAB_SITE,
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    await ResearchEntity.create({
      slug: MEMBER_SLUGS[1],
      name: 'Marisol Etherbridge',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    await seedDescription(LAB_SLUG, LAB_BODY);
    for (const slug of MEMBER_SLUGS)
      await seedDescription(
        slug,
        `Synthetic member description for ${slug} about intertidal heat tolerance and thermal limits.`,
      );
  });

  it('keeps the lab description citing its own website when two member rows cite it too', async () => {
    expect(await plannedFullDescription(LAB_SLUG)).toBe(LAB_BODY);
  });

  it('still screens a member row citing the lab page, even when it stores the lab site as its website', async () => {
    expect(await plannedFullDescription(MEMBER_SLUGS[0])).toBeUndefined();
  });

  it('still screens the lab when the cited page is not under its own website', async () => {
    await ResearchEntity.updateOne(
      { slug: LAB_SLUG },
      { $set: { websiteUrl: 'https://tidepool-elsewhere.example.org/' } },
    );
    expect(await plannedFullDescription(LAB_SLUG)).toBeUndefined();
  });
});
