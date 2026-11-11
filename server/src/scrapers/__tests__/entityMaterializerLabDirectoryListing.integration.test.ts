import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import {
  resetKnownPersonSurnameRosterCache,
  resetLabRowRosterCache,
} from '../../utils/researchHomeNameIdentityRoster';
import { materializeEntity } from '../entityMaterializer';
import { resetSiteSharedPageNameCache } from '../siteSharedPageName';

const ROSTER = 'https://earth.example.edu/faculty';
const LISTING = 'https://lab-sciences.example.edu/labs';
const SLUG = 'dept-fixture-sciences-ada-fixture';
const ROSTER_NAME = 'Ada Fixture Faculty Research';

type PersistedEntity = { name?: string; displayName?: string; websiteUrl?: string };

const persisted = () =>
  ResearchEntity.findOne({ slug: SLUG }).lean<PersistedEntity>() as Promise<PersistedEntity>;

const observe = (sourceName: string, sourceUrl: string, field: string, value: unknown) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey: SLUG,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl,
    field,
    value,
    confidence: sourceName === 'lab-site-research-read' ? 0.95 : 0.7,
    observedAt: new Date('2026-10-20T00:00:00Z'),
    superseded: false,
  });

const seedRowNamedAfterAListingPage = async () => {
  await ResearchEntity.create({
    slug: SLUG,
    name: 'Laboratories & Equipment',
    displayName: 'Laboratories & Equipment',
    kind: 'individual',
    entityType: 'FACULTY_RESEARCH_AREA',
    websiteUrl: LISTING,
    sourceUrls: [ROSTER, LISTING],
    archived: false,
  });
  await observe('dept-faculty-roster', ROSTER, 'name', ROSTER_NAME);
  await observe('dept-faculty-roster', ROSTER, 'entityType', 'FACULTY_RESEARCH_AREA');
  await observe('dept-faculty-roster', ROSTER, 'websiteUrl', LISTING);
  await observe('dept-faculty-roster', ROSTER, 'sourceUrls', [ROSTER, LISTING]);
  await observe('lab-site-research-read', LISTING, 'name', 'Laboratories & Equipment');
  await observe('lab-site-research-read', LISTING, 'displayName', 'Laboratories & Equipment');
};

describe('materializeEntity withdraws a lab-directory listing page and its heading (#4916)', () => {
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
    for (const name of ['observations', 'research_entities']) {
      await db.collection(name).deleteMany({});
    }
    resetKnownPersonSurnameRosterCache();
    resetLabRowRosterCache();
    resetSiteSharedPageNameCache();
  });

  it('serves the roster name and no website, and re-derives the same on a second pass', async () => {
    await seedRowNamedAfterAListingPage();

    await materializeEntity('researchEntity', { entityKey: SLUG });
    const first = await persisted();
    await materializeEntity('researchEntity', { entityKey: SLUG });
    const second = await ResearchEntity.findOne({ slug: SLUG }).lean<any>();

    expect(first.name).toBe(ROSTER_NAME);
    expect(first.displayName).toBeFalsy();
    expect(first.websiteUrl).toBeFalsy();
    expect(second.name).toBe(ROSTER_NAME);
    expect(second.websiteUrl).toBeFalsy();
    expect(second.manuallyLockedFields ?? []).toEqual([]);
    expect(await Observation.countDocuments({ entityKey: SLUG })).toBe(6);
  });
});
