import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntity: vi.fn().mockResolvedValue(undefined),
  deleteFromIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: meiliMocks.syncEntity,
    deleteFromIndex: meiliMocks.deleteFromIndex,
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeEntity } from '../entityMaterializer';
import { fieldValueRefusalKey } from '../../utils/researchEntityFieldValueRefusals';

const SLUG = 'dept-synthetic-member';
const PERSON_ROW_NAME = 'Synthetic Member Faculty Research';
const HOME_NAME = 'Synthetic Center for Coastal Studies';
const PROFILE_URL = 'https://synthetic.yale.edu/profile/synthetic-member/';
const LANE = 'official-profile-pi-backfill';

describe("the profile lane's home type counts only beside its own name (#3886)", () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seed = async (field: string, value: unknown, sourceName: string, confidence: number) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: PROFILE_URL,
      confidence,
      observedAt: new Date('2026-07-25T00:00:00Z'),
      superseded: false,
    });

  const seedPersonRowWithHomeType = async () => {
    await ResearchEntity.create({
      slug: SLUG,
      name: PERSON_ROW_NAME,
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
      sourceUrls: [PROFILE_URL],
    });
    await seed('name', PERSON_ROW_NAME, 'dept-faculty-roster', 0.8);
    await seed('entityType', 'FACULTY_RESEARCH_AREA', 'dept-faculty-roster', 0.8);
    await seed('kind', 'individual', 'dept-faculty-roster', 0.8);
    await seed('entityType', 'CENTER', LANE, 0.96);
    await seed('kind', 'center', LANE, 0.96);
  };

  const stored = async () =>
    ResearchEntity.findOne({ slug: SLUG }).lean<{
      entityType?: string;
      kind?: string;
      name?: string;
    }>();

  it("refuses the lane's type and kind when its name for the row is not live", async () => {
    await seedPersonRowWithHomeType();

    await materializeEntity('researchEntity', { entityKey: SLUG });

    const row = await stored();
    expect(row?.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(row?.kind).not.toBe('center');
    expect(row?.name).toBe(PERSON_ROW_NAME);
  });

  it("still admits the lane's type when its name for the row is live", async () => {
    await seedPersonRowWithHomeType();
    await seed('name', HOME_NAME, LANE, 0.96);

    await materializeEntity('researchEntity', { entityKey: SLUG });

    expect((await stored())?.entityType).toBe('CENTER');
  });

  it("refuses the lane's type and kind when its name for the row is refused", async () => {
    await seedPersonRowWithHomeType();
    await seed('name', HOME_NAME, LANE, 0.96);
    await ResearchEntity.updateOne(
      { slug: SLUG },
      {
        $set: {
          fieldValueRefusals: {
            name: [
              {
                valueKey: fieldValueRefusalKey('name', HOME_NAME),
                rule: 'not_this_rows_research',
                refusedBy: 'research-entity:refuse-field-value',
                refusedAt: new Date('2026-09-24T00:00:00Z'),
                note: 'synthetic',
              },
            ],
          },
        },
      },
    );

    await materializeEntity('researchEntity', { entityKey: SLUG });

    const row = await stored();
    expect(row?.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(row?.kind).not.toBe('center');
    expect(row?.name).toBe(PERSON_ROW_NAME);
  });
});
