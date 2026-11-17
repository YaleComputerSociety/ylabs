import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { materializeEntity } from '../entityMaterializer';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';
import { RESEARCH_PAGE_TEXT_FIELD, RESEARCH_PAGE_TEXT_SOURCE } from '../utils/researchPageText';

const ROW_KEY = 'quillfeather-orrery-lab';
const MOVED =
  'The Quillfeather lab has moved to the University of Fixtureland, where the work continues.';
const MOVING = 'The Quillfeather lab will be moving to the University of Fixtureland this summer.';

describe('a stated lab move is derived evidence that follows the Yale side (#6324)', () => {
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
    for (const name of ['observations', 'researchers', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
    resetInvalidatedScrapeRunCache();
  });

  const seed = async (input: { text: string; runs: number; title?: string }) => {
    const lead = await Researcher.create({
      displayName: 'Ada Quillfeather',
      lastName: 'Quillfeather',
      ...(input.title ? { profile: { title: input.title } } : {}),
    });
    const row = await ResearchEntity.create({
      slug: ROW_KEY,
      name: 'Quillfeather Orrery Lab',
      kind: 'lab',
      entityType: 'LAB',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    await RoleAssignment.create({
      personId: lead._id,
      target: { kind: 'RESEARCH_ENTITY', id: row._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
    });
    for (let run = 0; run < input.runs; run += 1) {
      await Observation.create({
        entityType: 'researchEntity',
        entityKey: ROW_KEY,
        field: RESEARCH_PAGE_TEXT_FIELD,
        value: [{ url: 'https://quillfeather-orrery.example.edu/', text: input.text }],
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: RESEARCH_PAGE_TEXT_SOURCE,
        sourceUrl: 'https://quillfeather-orrery.example.edu/',
        scrapeRunId: new mongoose.Types.ObjectId(),
        confidence: 0.9,
        observedAt: new Date(Date.UTC(2026, 9, 1 + run)),
        superseded: run < input.runs - 1,
      });
    }
  };

  const storedRow = () =>
    ResearchEntity.findOne({ slug: ROW_KEY }).lean<{
      activeAtYaleCache?: boolean;
      yaleStatusReasonCache?: string;
    }>();

  it('marks the row departed when two runs state the move and no lead holds a Yale appointment', async () => {
    await seed({ text: MOVED, runs: 2 });
    await materializeEntity('researchEntity', { entityKey: ROW_KEY });
    expect(await storedRow()).toMatchObject({
      activeAtYaleCache: false,
      yaleStatusReasonCache: 'lead_departed',
    });
  });

  it('keeps the row current when only one run states the move', async () => {
    await seed({ text: MOVED, runs: 1 });
    await materializeEntity('researchEntity', { entityKey: ROW_KEY });
    expect((await storedRow())?.activeAtYaleCache).not.toBe(false);
  });

  it('keeps the row current while the lead holds a Yale appointment, however many runs restate it', async () => {
    await seed({ text: MOVED, runs: 4, title: 'Adjunct Professor of Astronomy' });
    await materializeEntity('researchEntity', { entityKey: ROW_KEY });
    expect((await storedRow())?.activeAtYaleCache).not.toBe(false);
  });

  it('never marks a row departed on an announcement', async () => {
    await seed({ text: MOVING, runs: 3 });
    await materializeEntity('researchEntity', { entityKey: ROW_KEY });
    expect((await storedRow())?.activeAtYaleCache).not.toBe(false);
  });
});
