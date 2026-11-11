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

const SITE_NAME = 'Orrery Institute for Regional Studies';
const SITE = 'https://orrery.example.edu';

type PersistedEntity = { name?: string; displayName?: string };

const persisted = (slug: string) =>
  ResearchEntity.findOne({ slug }).lean<PersistedEntity>() as Promise<PersistedEntity>;

const observe = (
  slug: string,
  sourceName: string,
  sourceUrl: string,
  field: string,
  value: string,
  confidence: number,
) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey: slug,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    sourceUrl,
    field,
    value,
    confidence,
    observedAt: new Date('2026-10-20T00:00:00Z'),
    superseded: false,
  });

const seedCouncil = async (slug: string, path: string, ownName: string, archived = false) => {
  const websiteUrl = `${SITE}/${path}`;
  await ResearchEntity.create({
    slug,
    name: SITE_NAME,
    displayName: SITE_NAME,
    kind: 'center',
    entityType: 'CENTER',
    websiteUrl,
    sourceUrls: [websiteUrl],
    archived,
  });
  await observe(slug, 'centers-institutes-index', `${websiteUrl}/people`, 'name', ownName, 0.8);
  await observe(
    slug,
    'centers-institutes-index',
    `${websiteUrl}/people`,
    'entityType',
    'CENTER',
    0.8,
  );
  await observe(slug, 'centers-institutes-index', websiteUrl, 'websiteUrl', websiteUrl, 0.8);
  await observe(slug, 'lab-site-research-read', websiteUrl, 'name', SITE_NAME, 0.95);
  await observe(slug, 'lab-site-research-read', websiteUrl, 'displayName', SITE_NAME, 0.95);
};

const seedPreviouslyServedCouncil = async (slug: string, path: string, ownName: string) => {
  await seedCouncil(slug, path, ownName);
  await materializeEntity('researchEntity', { entityKey: slug });
  resetSiteSharedPageNameCache();
};

describe('materializeEntity withdraws a site name stated for sibling sub-unit pages (#5618)', () => {
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

  it('serves each council under the name its own pages state', async () => {
    await seedPreviouslyServedCouncil('orrery-north', 'north', 'Council on Northern Studies');
    await seedPreviouslyServedCouncil('orrery-south', 'south', 'Council on Southern Studies');

    await materializeEntity('researchEntity', { entityKey: 'orrery-north' });
    await materializeEntity('researchEntity', { entityKey: 'orrery-south' });

    expect(await persisted('orrery-north')).toMatchObject({ name: 'Council on Northern Studies' });
    expect((await persisted('orrery-north')).displayName).toBeUndefined();
    expect(await persisted('orrery-south')).toMatchObject({ name: 'Council on Southern Studies' });
  });

  it('re-derives the same names on a second pass with no lock', async () => {
    await seedPreviouslyServedCouncil('orrery-north', 'north', 'Council on Northern Studies');
    await seedPreviouslyServedCouncil('orrery-south', 'south', 'Council on Southern Studies');

    await materializeEntity('researchEntity', { entityKey: 'orrery-north' });
    const second = await materializeEntity('researchEntity', { entityKey: 'orrery-north' });

    const row = await ResearchEntity.findOne({ slug: 'orrery-north' }).lean<any>();
    expect(row.name).toBe('Council on Northern Studies');
    expect(row.displayName).toBeUndefined();
    expect(row.manuallyLockedFields ?? []).toEqual([]);
    expect(second.resolved.name?.value ?? row.name).toBe('Council on Northern Studies');
  });

  it('keeps a page-stated name when the only sibling stating it is archived', async () => {
    await seedPreviouslyServedCouncil('orrery-north', 'north', 'Council on Northern Studies');
    await seedCouncil('orrery-south', 'south', 'Council on Southern Studies', true);

    await materializeEntity('researchEntity', { entityKey: 'orrery-north' });

    expect(await persisted('orrery-north')).toMatchObject({ name: SITE_NAME });
  });
});
