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

import { ResearchEntity } from '../../models/researchEntity';
import { getResearchGroupDetail } from '../researchGroupService';
import { runStudentVisibilityGate } from '../studentVisibilityGateService';
import { publicStudentVisibilityTiers } from '../../models/studentVisibility';

const ADDRESS_AUTHORITY_SLUG = 'ysm-quill-estuary-lab';
const SHARED_URL_CANONICAL_SLUG = 'ysm-ashford-marsh-lab';

const AUTHORITY_OWN_ADDRESS = 'https://medicine.yale.edu/lab/quill/';
const SHARED_CENTER_PAGE = 'https://medicine.yale.edu/center/estuary-collaborative/research/';

const AUTHORITY_SHORT =
  'Studies estuary nitrogen cycling across Long Island Sound salt marsh restoration sites.';
const AUTHORITY_FULL =
  'The lab studies estuary nitrogen cycling across Long Island Sound salt marsh restoration sites, pairing seasonal porewater chemistry with sediment core incubations and remote-sensed vegetation change to explain why restored marshes retain nitrogen at very different rates.';
const CANONICAL_SHORT =
  'Studies tidal marsh sediment accretion and the plant communities that drive it.';
const CANONICAL_FULL =
  'Research covers tidal marsh sediment accretion and the plant communities that drive it, combining marker horizon plots, elevation surveys across a salinity gradient, and greenhouse mesocosms to describe which restoration designs keep pace with sea level.';

type PersistedVisibility = {
  slug?: string;
  websiteUrl?: string;
  studentVisibilityTier?: string;
  studentVisibilityReasons?: string[];
};

const persisted = (slug: string) =>
  ResearchEntity.findOne({ slug }).lean<PersistedVisibility>() as Promise<PersistedVisibility>;

describe('an address-authority row is still a duplicate in a group formed by a url it does not own (#2970)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  const seedPi = async (entityId: mongoose.Types.ObjectId, lastName: string) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const personId = new mongoose.Types.ObjectId();
    await db.collection('researchers').insertOne({
      _id: personId,
      displayName: `Robin ${lastName}`,
      firstName: 'Robin',
      lastName,
      netid: `fixture${lastName.toLowerCase()}`,
      archived: false,
    });
    await db.collection('role_assignments').insertOne({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      archived: false,
      verifiedAt: new Date(),
      source: { name: 'ysm-faculty', url: `https://medicine.yale.edu/profile/${lastName}/` },
    });
  };

  const seedServedLab = async (input: {
    slug: string;
    name: string;
    lastName: string;
    websiteUrl: string;
    websiteUrlSourceName: string;
    sourceUrls: string[];
    shortDescription: string;
    fullDescription: string;
  }) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const entityId = new mongoose.Types.ObjectId();
    const descriptionSourceUrl = `https://medicine.yale.edu/profile/${input.lastName}/`;
    await db.collection('research_entities').insertOne({
      _id: entityId,
      slug: input.slug,
      name: input.name,
      displayName: input.name,
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
      departments: ['Environmental Health Sciences'],
      researchAreas: ['Coastal ecology'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description', 'concrete_next_step'],
      shortDescription: input.shortDescription,
      fullDescription: input.fullDescription,
      websiteUrl: input.websiteUrl,
      sourceUrls: input.sourceUrls,
      fieldProvenance: {
        websiteUrl: { sourceName: input.websiteUrlSourceName, sourceUrl: input.websiteUrl },
        shortDescription: { sourceName: 'ysm-faculty', sourceUrl: descriptionSourceUrl },
        fullDescription: { sourceName: 'ysm-faculty', sourceUrl: descriptionSourceUrl },
        displayName: { sourceName: 'ysm-faculty', sourceUrl: descriptionSourceUrl },
      },
    });
    await seedPi(entityId, input.lastName);
    return entityId;
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
    await seedServedLab({
      slug: ADDRESS_AUTHORITY_SLUG,
      name: 'Quill Estuary Lab',
      lastName: 'Quill',
      websiteUrl: AUTHORITY_OWN_ADDRESS,
      websiteUrlSourceName: 'ysm-atoz-index',
      sourceUrls: [AUTHORITY_OWN_ADDRESS, SHARED_CENTER_PAGE],
      shortDescription: AUTHORITY_SHORT,
      fullDescription: AUTHORITY_FULL,
    });
    await seedServedLab({
      slug: SHARED_URL_CANONICAL_SLUG,
      name: 'Ashford Marsh Lab',
      lastName: 'Ashford',
      websiteUrl: SHARED_CENTER_PAGE,
      websiteUrlSourceName: 'ysm-faculty-directory',
      sourceUrls: [SHARED_CENTER_PAGE],
      shortDescription: CANONICAL_SHORT,
      fullDescription: CANONICAL_FULL,
    });
  });

  it('holds the authority row on the group it lost instead of exempting it everywhere', async () => {
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const authorityRow = await persisted(ADDRESS_AUTHORITY_SLUG);
    expect(authorityRow.studentVisibilityReasons).toContain('exact_url_duplicate_risk');
    expect(authorityRow.studentVisibilityTier).not.toBe('student_ready');

    const canonical = await persisted(SHARED_URL_CANONICAL_SLUG);
    expect(canonical.studentVisibilityReasons).not.toContain('exact_url_duplicate_risk');
    expect(canonical.studentVisibilityTier).toBe('student_ready');
  }, 60000);

  it('serves the shared center page exactly one student card', async () => {
    await runStudentVisibilityGate({ collection: 'research', mode: 'apply' });

    const publicTiers = new Set<string>(publicStudentVisibilityTiers);
    const storedPublic = (
      await mongoose.connection
        .db!.collection('research_entities')
        .find({}, { projection: { slug: 1, studentVisibilityTier: 1 } })
        .toArray()
    ).filter((row) => publicTiers.has(String(row.studentVisibilityTier)));
    expect(storedPublic.map((row) => row.slug)).toEqual([SHARED_URL_CANONICAL_SLUG]);

    const served = [];
    for (const slug of [ADDRESS_AUTHORITY_SLUG, SHARED_URL_CANONICAL_SLUG]) {
      const detail = await getResearchGroupDetail(slug);
      if (detail) served.push(detail);
    }

    expect(served).toHaveLength(1);
    expect(served[0]?.researchEntity.slug).toBe(SHARED_URL_CANONICAL_SLUG);
    expect(served[0]?.researchEntity.websiteUrl).toBe(SHARED_CENTER_PAGE);
  }, 60000);
});
