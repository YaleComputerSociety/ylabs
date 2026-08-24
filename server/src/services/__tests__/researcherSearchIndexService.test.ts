import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import {
  buildResearcherSearchIndexDocument,
  buildResearcherSearchIndexDocumentsWithHomes,
  fetchResearcherPublicHomeAggregates,
} from '../researcherSearchIndexService';

const validPublicDescriptions = {
  shortDescription:
    'Studies molecular dynamics, protein folding, and cellular signaling in biological systems.',
  fullDescription:
    'This research studies molecular dynamics, protein folding, and cellular signaling across complex biological systems.',
};

const officialLink = {
  kind: 'YALE_OFFICIAL' as const,
  purpose: 'PRIMARY_IDENTITY' as const,
  url: 'https://medicine.yale.edu/profile/ada',
  verifiedAt: new Date('2025-01-01T00:00:00Z'),
  healthStatus: 'HEALTHY' as const,
};

describe('buildResearcherSearchIndexDocument', () => {
  it('indexes a researcher with a public home', () => {
    const doc = buildResearcherSearchIndexDocument(
      {
        _id: 'abc',
        displayName: 'Dr Ada Researcher',
        status: 'ACTIVE',
        archived: false,
        profile: { title: 'Professor', primaryDepartment: 'Cell Biology' },
        profileLinks: [],
      },
      { homeNames: ['Ada Lab'], researchAreas: ['genomics'], school: 'School of Medicine', homeCount: 1 },
    );
    expect(doc).not.toBeNull();
    expect(doc?.id).toBe('abc');
    expect(doc?.homeCount).toBe(1);
    expect(doc?.homeNames).toEqual(['Ada Lab']);
    expect(doc?.school).toBe('School of Medicine');
    expect(doc?.archived).toBe(false);
  });

  it('indexes a researcher with no homes but a verified identity link', () => {
    const doc = buildResearcherSearchIndexDocument({
      _id: 'abc',
      displayName: 'Dr No Lab',
      status: 'ACTIVE',
      archived: false,
      profileLinks: [officialLink],
    });
    expect(doc).not.toBeNull();
    expect(doc?.homeCount).toBe(0);
  });

  it('skips a researcher with no homes and no identity link', () => {
    expect(
      buildResearcherSearchIndexDocument({
        _id: 'abc',
        displayName: 'Dr Ghost',
        status: 'ACTIVE',
        archived: false,
        profileLinks: [],
      }),
    ).toBeNull();
  });

  it('skips archived and DEPARTED researchers', () => {
    expect(
      buildResearcherSearchIndexDocument(
        { _id: 'a', displayName: 'X', status: 'ACTIVE', archived: true, profileLinks: [officialLink] },
      ),
    ).toBeNull();
    expect(
      buildResearcherSearchIndexDocument(
        { _id: 'a', displayName: 'X', status: 'DEPARTED', archived: false, profileLinks: [officialLink] },
      ),
    ).toBeNull();
  });
});

describe('fetchResearcherPublicHomeAggregates', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'researchers', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedEntity = async (
    slug: string,
    overrides: Record<string, unknown> = {},
  ): Promise<mongoose.Types.ObjectId> => {
    const entity = await ResearchEntity.create({
      slug,
      name: slug.replace(/-/g, ' '),
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      sourceUrls: ['https://example.yale.edu/lab'],
      archived: false,
      ...validPublicDescriptions,
      ...overrides,
    });
    return entity._id as mongoose.Types.ObjectId;
  };

  it('aggregates only public homes and excludes hidden ones', async () => {
    const person = await Researcher.create({
      displayName: 'Dr Ada Researcher',
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });
    const personId = person._id as mongoose.Types.ObjectId;
    const readyId = await seedEntity('ada-lab', { school: 'School of Medicine' });
    const hiddenId = await seedEntity('ada-hidden', { studentVisibilityTier: 'suppressed' });
    for (const entityId of [readyId, hiddenId]) {
      await RoleAssignment.create({
        personId,
        target: { kind: 'RESEARCH_ENTITY', id: entityId },
        role: 'PI',
        state: 'CURRENT',
        confidence: 0.9,
      });
    }

    const aggregates = await fetchResearcherPublicHomeAggregates([personId]);
    const entry = aggregates.get(personId.toHexString());
    expect(entry?.homeCount).toBe(1);
    expect(entry?.homeNames).toEqual(['ada lab']);
    expect(entry?.school).toBe('School of Medicine');

    const docs = await buildResearcherSearchIndexDocumentsWithHomes([person.toObject()]);
    expect(docs).toHaveLength(1);
    expect(docs[0].homeCount).toBe(1);
  });
});
