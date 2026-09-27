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
import { fieldValueRefusalKey } from '../../utils/researchEntityFieldValueRefusals';
import { materializeEntity } from '../entityMaterializer';

const SURVIVOR_SLUG = 'yse-faculty-example-member';
const LOSER_SLUG = 'dept-example-member';
const LOSER_LAB_URL = 'https://examplememberlab.example.org/';
const SURVIVOR_PROFILE_URL = 'https://environment.yale.edu/directory/faculty/example-member';

describe("a merged survivor's own lab-identity lane owns its website (#3585)", () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
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

  const seedObservation = async (
    entityKey: string,
    field: string,
    value: unknown,
    sourceName: string,
  ) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: `https://example.yale.edu/${entityKey}/`,
      confidence: 0.8,
      observedAt: new Date('2026-09-20T00:00:00Z'),
      superseded: false,
    });
  };

  const seedMergedSurvivor = async (
    survivorFields: Record<string, unknown> = {},
    survivorTypeSource = 'yse-faculty-directory',
    { survivorCites = true }: { survivorCites?: boolean } = {},
  ) => {
    const survivor = await ResearchEntity.create({
      slug: SURVIVOR_SLUG,
      name: 'Example Member Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
      websiteUrl: LOSER_LAB_URL,
      sourceUrls: [SURVIVOR_PROFILE_URL],
      ...survivorFields,
    });
    await ResearchEntity.create({
      slug: LOSER_SLUG,
      name: 'Example Member Lab',
      kind: 'lab',
      archived: true,
      canonicalGroupId: survivor._id,
    });
    await seedObservation(SURVIVOR_SLUG, 'name', 'Example Member Research', survivorTypeSource);
    await seedObservation(SURVIVOR_SLUG, 'entityType', 'FACULTY_RESEARCH_AREA', survivorTypeSource);
    if (survivorCites) {
      await seedObservation(
        SURVIVOR_SLUG,
        'sourceUrls',
        [SURVIVOR_PROFILE_URL],
        survivorTypeSource,
      );
    }
    await seedObservation(LOSER_SLUG, 'entityType', 'LAB', 'dept-faculty-roster');
    await seedObservation(LOSER_SLUG, 'websiteUrl', LOSER_LAB_URL, 'dept-faculty-roster');
    await seedObservation(LOSER_SLUG, 'sourceUrls', [LOSER_LAB_URL], 'dept-faculty-roster');
    return survivor;
  };

  const storedWebsiteUrl = async (id: mongoose.Types.ObjectId) =>
    (await ResearchEntity.findById(id).lean<{ websiteUrl?: string }>())?.websiteUrl ?? '';

  it('clears a stored website only the loser lane stated', async () => {
    const survivor = await seedMergedSurvivor();

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });

    expect(await storedWebsiteUrl(survivor._id)).toBe('');
  });

  it("does not re-promote the loser's cited lab link into the cleared slot", async () => {
    const survivor = await seedMergedSurvivor({ sourceUrls: [] }, 'yse-faculty-directory', {
      survivorCites: false,
    });

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });

    const stored = await ResearchEntity.findById(survivor._id).lean<{
      websiteUrl?: string;
      sourceUrls?: string[];
    }>();
    expect(stored?.sourceUrls).toContain(LOSER_LAB_URL);
    expect(stored?.websiteUrl ?? '').toBe('');
  });

  it('projects the same website from either entry point, and a second run changes nothing', async () => {
    const survivor = await seedMergedSurvivor();

    await materializeEntity('researchEntity', { entityKey: LOSER_SLUG });
    const viaLoser = await storedWebsiteUrl(survivor._id);
    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });
    const viaSurvivor = await storedWebsiteUrl(survivor._id);
    const rerun = await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });

    expect(viaLoser).toBe('');
    expect(viaSurvivor).toBe('');
    expect(rerun.plannedSet?.websiteUrl).toBeUndefined();
  });

  it("keeps the survivor's own lab website when its own lane states one", async () => {
    const ownLabUrl = 'https://ownlab.example.org/';
    const survivor = await seedMergedSurvivor({ websiteUrl: ownLabUrl });
    await seedObservation(SURVIVOR_SLUG, 'websiteUrl', ownLabUrl, 'yse-faculty-directory');

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });

    expect(await storedWebsiteUrl(survivor._id)).toBe(ownLabUrl);
  });

  it('keeps a loser website the survivor itself also cites', async () => {
    const survivor = await seedMergedSurvivor();
    await seedObservation(
      SURVIVOR_SLUG,
      'sourceUrls',
      [SURVIVOR_PROFILE_URL, LOSER_LAB_URL],
      'yse-faculty-directory',
    );

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });

    expect(await storedWebsiteUrl(survivor._id)).toBe(LOSER_LAB_URL);
  });

  it('still absorbs a loser website when no lab-identity lane typed the survivor', async () => {
    const survivor = await seedMergedSurvivor({}, 'bbs-research-track');

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });

    expect(await storedWebsiteUrl(survivor._id)).toBe(LOSER_LAB_URL);
  });

  it("does not claim the website when the survivor's lane type is refused", async () => {
    const survivor = await seedMergedSurvivor({
      entityType: 'LAB',
      kind: 'lab',
      fieldValueRefusals: {
        entityType: [
          {
            valueKey: fieldValueRefusalKey('entityType', 'FACULTY_RESEARCH_AREA'),
            rule: 'superseded_by_better_source',
            refusedBy: 'research-entity:refuse-field-value',
            refusedAt: new Date('2026-09-24T00:00:00Z'),
          },
        ],
      },
    });

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });

    expect(await storedWebsiteUrl(survivor._id)).toBe(LOSER_LAB_URL);
  });

  it('does not claim the website when an operator locked the type', async () => {
    const survivor = await seedMergedSurvivor({ manuallyLockedFields: ['entityType'] });

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });

    expect(await storedWebsiteUrl(survivor._id)).toBe(LOSER_LAB_URL);
  });

  it('leaves a locked website alone', async () => {
    const survivor = await seedMergedSurvivor({ manuallyLockedFields: ['websiteUrl'] });

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_SLUG });

    expect(await storedWebsiteUrl(survivor._id)).toBe(LOSER_LAB_URL);
  });
});
