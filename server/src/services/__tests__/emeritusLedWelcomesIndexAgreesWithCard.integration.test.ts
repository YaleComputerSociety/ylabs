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
import { buildResearchEntitySearchIndexDocumentsWithMemberNames } from '../researchEntitySearchIndexService';

const INVITATION_ONLY = 'fixture-emeritus-invitation-lab';
const OPEN_LIST_ONLY = 'fixture-emeritus-open-list-lab';
const FUNDED = 'fixture-emeritus-funded-lab';
const ACTIVE_LEAD = 'fixture-active-lead-lab';
const RUNNING_AWARD = {
  id: 'R01XX000002',
  agency: 'NIH',
  title: 'Fixture membrane signalling award',
  startDate: new Date('2024-07-01T00:00:00Z'),
  endDate: new Date(Date.now() + 400 * 86_400_000),
  role: 'pi',
};

const entityIdBySlug = new Map<string, mongoose.Types.ObjectId>();

const siteFor = (slug: string) => `https://${slug}.example.edu/`;

const invitationFor = (slug: string) => ({
  level: 'welcomes_undergrads',
  quote: 'Undergraduates interested in membrane signalling are welcome to get in touch.',
  sourceUrl: `${siteFor(slug)}join`,
});

const openListEntryFor = (slug: string) => ({
  source: 'physics-open-research-opportunities',
  kind: 'open',
  sourceUrl: `${siteFor(slug)}openings`,
});

const seedRow = async (
  slug: string,
  leadTitle: string,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const entityId = new mongoose.Types.ObjectId();
  entityIdBySlug.set(slug, entityId);
  const row = {
    _id: entityId,
    slug,
    name: `Fixture ${slug.split('-')[2]} Membrane Signalling Lab`,
    kind: 'lab',
    entityType: 'LAB',
    archived: false,
    departments: ['Physics'],
    researchAreas: ['Membrane Signalling'],
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: ['source_backed_description'],
    shortDescription: 'The lab studies how example membranes pass signals between cells.',
    fullDescription:
      'The lab studies how example membranes pass signals between cells, combining imaging and computational modelling of membrane proteins.',
    websiteUrl: siteFor(slug),
    sourceUrls: [siteFor(slug)],
    ...fields,
  };
  await db.collection('research_entities').insertOne(row);
  const personId = new mongoose.Types.ObjectId();
  await db.collection('researchers').insertOne({
    _id: personId,
    displayName: `Fixture Lead ${slug.split('-')[2]}`,
    identifiers: { netid: `fx${slug.split('-')[2]}` },
    profile: { title: leadTitle },
    archived: false,
  });
  await db.collection('role_assignments').insertOne({
    personId,
    target: { kind: 'RESEARCH_ENTITY', id: entityId },
    role: 'PI',
    state: 'CURRENT',
    archived: false,
    verifiedAt: new Date(),
    source: { name: 'fixture-faculty', url: siteFor(slug) },
  });
  return row;
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
  const result = await searchResearchGroupsViaMeili('membrane signalling', {}, 1, 24);
  return result.researchEntities.find((entity: any) => entity.slug === slug) as
    Record<string, any> | undefined;
};

describe('the welcomes filter in the index agrees with the emeritus way-in the card serves (#5620)', () => {
  let replSet: MongoMemoryReplSet;
  const rowsBySlug = new Map<string, Record<string, unknown>>();

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
    for (const name of ['research_entities', 'role_assignments', 'researchers', 'signals']) {
      await db.collection(name).deleteMany({});
    }
    entityIdBySlug.clear();
    rowsBySlug.clear();
    const emeritus = 'Professor Emeritus of Physics';
    rowsBySlug.set(
      INVITATION_ONLY,
      await seedRow(INVITATION_ONLY, emeritus, {
        undergradInvitation: invitationFor(INVITATION_ONLY),
      }),
    );
    rowsBySlug.set(
      OPEN_LIST_ONLY,
      await seedRow(OPEN_LIST_ONLY, emeritus, {
        undergradListEvidence: [openListEntryFor(OPEN_LIST_ONLY)],
      }),
    );
    rowsBySlug.set(
      FUNDED,
      await seedRow(FUNDED, emeritus, {
        undergradInvitation: invitationFor(FUNDED),
        recentGrants: [RUNNING_AWARD],
        recentGrantCount: 1,
      }),
    );
    rowsBySlug.set(
      ACTIVE_LEAD,
      await seedRow(ACTIVE_LEAD, 'Professor of Physics', {
        undergradInvitation: invitationFor(ACTIVE_LEAD),
      }),
    );
  });

  const indexDocumentFor = async (slug: string) => {
    const [document] = await buildResearchEntitySearchIndexDocumentsWithMemberNames([
      rowsBySlug.get(slug),
    ]);
    return document;
  };

  it.each([INVITATION_ONLY, OPEN_LIST_ONLY])(
    'keeps a quiet emeritus-led row with a way in out of the welcomes filter: %s',
    async (slug) => {
      const document = await indexDocumentFor(slug);

      expect(document.welcomesUndergrads).toBe(false);
      expect(document.worksWithUndergrads).toBeUndefined();
      expect(document.undergradInvitationRank).toBe(0);
    },
    60000,
  );

  it.each([FUNDED, ACTIVE_LEAD])(
    'keeps a row whose way in is served under the welcomes filter: %s',
    async (slug) => {
      const document = await indexDocumentFor(slug);

      expect(document.welcomesUndergrads).toBe(true);
      expect(document.worksWithUndergrads).toBe(true);
      expect(document.undergradInvitationRank).toBe(1);
    },
    60000,
  );

  it.each([INVITATION_ONLY, OPEN_LIST_ONLY, FUNDED, ACTIVE_LEAD])(
    'indexes the welcomes flag the browse card serves: %s',
    async (slug) => {
      const document = await indexDocumentFor(slug);
      const card = await browseCardFor(slug);

      expect(card).toBeDefined();
      expect(card?.welcomesUndergrads === true).toBe(document.welcomesUndergrads);
    },
    60000,
  );
});
