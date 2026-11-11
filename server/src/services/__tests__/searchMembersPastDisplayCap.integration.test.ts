import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/meiliClient', () => ({
  getMeiliSearchIndex: vi.fn(async () => ({
    search: vi.fn(),
    getEmbedders: vi.fn(async () => ({})),
  })),
}));

vi.mock('../meiliSyncService', () => ({
  syncEntities: vi.fn(async () => {}),
  syncEntity: vi.fn(async () => {}),
  deleteFromIndex: vi.fn(async () => {}),
}));

import { getResearchGroupDetail, MAX_PUBLIC_DETAIL_MEMBERS } from '../researchGroupService';
import { fetchResearchEntitySearchMemberNames } from '../researchEntitySearchIndexService';

const SLUG = 'fixture-large-center';
const SOURCE_URL = 'https://center.example.edu/';
const AFFILIATED_COUNT = MAX_PUBLIC_DETAIL_MEMBERS + 5;
const affiliatedName = (index: number) => `Fixture Affiliate${String(index).padStart(3, '0')}`;
const LEAD_NAME = 'Fixture Director';
const HISTORICAL_NAME = 'Fixture Formerly';

const memberNames = (detail: Awaited<ReturnType<typeof getResearchGroupDetail>>): string[] =>
  (detail?.members ?? []).map((member) => String(member.user?.displayName ?? ''));

describe('a center with more members than the detail page displays (#5584)', () => {
  let replSet: MongoMemoryReplSet;
  let entity: Record<string, any>;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    const db = mongoose.connection.db!;
    const entityId = new mongoose.Types.ObjectId();
    entity = {
      _id: entityId,
      slug: SLUG,
      name: 'Fixture Center for Membrane Transport',
      kind: 'center',
      entityType: 'CENTER',
      archived: false,
      departments: ['Pediatrics'],
      researchAreas: ['Membrane Transport'],
      studentVisibilityTier: 'student_ready',
      studentVisibilityReasons: ['source_backed_description'],
      shortDescription: 'This center studies how cell membranes move ions and small molecules.',
      fullDescription:
        'This center studies how cell membranes move ions and small molecules, combining structural biology, electrophysiology, and computational modeling of transporter proteins.',
      websiteUrl: SOURCE_URL,
      sourceUrls: [SOURCE_URL],
      fieldProvenance: {
        shortDescription: { sourceName: 'fixture-center', sourceUrl: SOURCE_URL },
        fullDescription: { sourceName: 'fixture-center', sourceUrl: SOURCE_URL },
        researchAreas: { sourceName: 'fixture-center', sourceUrl: SOURCE_URL },
      },
    };
    await db.collection('research_entities').insertOne(entity);
    const seed = async (displayName: string, role: string, state = 'CURRENT') => {
      const personId = new mongoose.Types.ObjectId();
      const [firstName, lastName] = displayName.split(' ');
      await db.collection('researchers').insertOne({
        _id: personId,
        displayName,
        firstName,
        lastName,
        archived: false,
      });
      await db.collection('role_assignments').insertOne({
        personId,
        target: { kind: 'RESEARCH_ENTITY', id: entityId },
        role,
        state,
        archived: false,
        verifiedAt: new Date(),
      });
    };
    await seed(LEAD_NAME, 'DIRECTOR');
    for (let index = 0; index < AFFILIATED_COUNT; index += 1) {
      await seed(affiliatedName(index), 'AFFILIATED');
    }
    await seed(HISTORICAL_NAME, 'AFFILIATED', 'HISTORICAL');
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  const pastCapNames = async (): Promise<string[]> => {
    const shown = new Set(memberNames(await getResearchGroupDetail(SLUG)));
    return Array.from({ length: AFFILIATED_COUNT }, (_, index) => affiliatedName(index)).filter(
      (name) => !shown.has(name),
    );
  };

  it('keeps the detail display cap', async () => {
    expect(memberNames(await getResearchGroupDetail(SLUG))).toHaveLength(MAX_PUBLIC_DETAIL_MEMBERS);
    expect(await pastCapNames()).not.toHaveLength(0);
  });

  it('indexes every current member for name search, including those past the cap', async () => {
    const fields = (await fetchResearchEntitySearchMemberNames([entity])).get(String(entity._id));
    expect(fields?.professorNames).toEqual(
      expect.arrayContaining([LEAD_NAME, ...(await pastCapNames())]),
    );
    expect(fields?.professorNames).toHaveLength(AFFILIATED_COUNT + 1);
    expect(fields?.professorNames).not.toContain(HISTORICAL_NAME);
  });
});
