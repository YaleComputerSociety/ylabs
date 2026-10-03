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
    syncEntities: vi.fn().mockResolvedValue(undefined),
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
import { ResearchEntity } from '../../models/researchEntity';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';
import { materializeEntity } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import {
  facultyToResearchEntityObservations,
  type YsmFacultyProfile,
} from '../sources/ysmFacultyDirectoryScraper';

const LANE = 'ysm-faculty-directory';
const RIVAL_LANE = 'dept-faculty-roster';
const ENTITY_KEY = 'ysm-faculty-jordan-rivers';
const PROFILE_URL = 'https://medicine.yale.edu/profile/jordan-rivers/';
const LAB_URL = 'https://riverslab.example.org/';

const PROFILE: YsmFacultyProfile = {
  name: 'Jordan Rivers',
  profileUrl: PROFILE_URL,
  slug: 'jordan-rivers',
  departments: ['Internal Medicine'],
  researchAreas: ['Heart Failure'],
  description:
    'Professor Rivers studies cardiac remodeling and the molecular drivers of heart failure in adults.',
  labUrl: LAB_URL,
  labName: 'Rivers Lab',
};

async function readProfile(options: { refused: boolean; observedAt: Date; labUrl?: string }) {
  const observations = facultyToResearchEntityObservations(
    { ...PROFILE, labUrl: options.labUrl ?? LAB_URL },
    'ysm:jordan-rivers',
    NO_SURNAME_ROSTER,
    () => options.refused,
  ).map((observation) => ({ ...observation, observedAt: options.observedAt }));
  await appendObservations(observations, {
    scrapeRunId: new mongoose.Types.ObjectId().toString(),
    sourceId: new mongoose.Types.ObjectId().toString(),
    sourceName: LANE,
    sourceWeight: 0.8,
    dryRun: false,
  });
  return observations;
}

async function rivalAssertsLab() {
  await Observation.create({
    entityType: 'researchEntity',
    entityKey: ENTITY_KEY,
    field: 'websiteUrl',
    value: LAB_URL,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: RIVAL_LANE,
    sourceUrl: 'https://medicine.yale.edu/internal-medicine/faculty/',
    confidence: 0.7,
    observedAt: new Date('2026-08-01T00:00:00Z'),
    superseded: false,
  });
}

const resolve = () => materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

const storedWebsiteUrl = async () =>
  (await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{ websiteUrl?: unknown }>())?.websiteUrl;

describe('a ysm read that refuses its lab link withdraws the lane own earlier websiteUrl (#3926)', () => {
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
    for (const name of ['observations', 'research_entities', 'role_assignments', 'signals']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('drops the refused link on the next resolve and plans nothing on a second resolve', async () => {
    await readProfile({ refused: false, observedAt: new Date('2026-08-20T00:00:00Z') });
    await resolve();
    expect(await storedWebsiteUrl()).toBe(LAB_URL);

    await readProfile({ refused: true, observedAt: new Date('2026-09-20T00:00:00Z') });
    await resolve();
    expect(await storedWebsiteUrl()).toBeFalsy();

    const second = await resolve();
    expect(second.resolved.websiteUrl).toBeUndefined();
    expect(await storedWebsiteUrl()).toBeFalsy();
    expect(
      await Observation.countDocuments({
        entityKey: ENTITY_KEY,
        sourceName: LANE,
        field: 'websiteUrl',
        superseded: { $ne: true },
      }),
    ).toBe(1);
  }, 120000);

  it('drops the earlier link when a later read refuses a different link in the same slot', async () => {
    await readProfile({ refused: false, observedAt: new Date('2026-08-20T00:00:00Z') });
    await resolve();
    expect(await storedWebsiteUrl()).toBe(LAB_URL);

    await readProfile({
      refused: true,
      observedAt: new Date('2026-09-20T00:00:00Z'),
      labUrl: 'https://affiliatedcenter.example.org/',
    });
    await resolve();
    expect(await storedWebsiteUrl()).toBeFalsy();

    const second = await resolve();
    expect(second.resolved.websiteUrl).toBeUndefined();
    expect(await storedWebsiteUrl()).toBeFalsy();
  }, 120000);

  it('drops the lane own earlier website alongside its websiteUrl', async () => {
    const [first] = await readProfile({
      refused: false,
      observedAt: new Date('2026-08-20T00:00:00Z'),
    });
    await appendObservations(
      [{ ...first, field: 'website', value: LAB_URL, observedAt: first.observedAt }],
      {
        scrapeRunId: new mongoose.Types.ObjectId().toString(),
        sourceId: new mongoose.Types.ObjectId().toString(),
        sourceName: LANE,
        sourceWeight: 0.8,
        dryRun: false,
      },
    );
    await resolve();
    const adopted = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<Record<string, any>>();
    expect(adopted?.website).toBe(LAB_URL);

    await readProfile({ refused: true, observedAt: new Date('2026-09-20T00:00:00Z') });
    await resolve();
    const withdrawn = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<
      Record<string, any>
    >();
    expect(withdrawn?.websiteUrl).toBeFalsy();
    expect(withdrawn?.website).toBeFalsy();
  }, 120000);

  it('keeps the link when another lane still asserts it', async () => {
    await readProfile({ refused: false, observedAt: new Date('2026-08-20T00:00:00Z') });
    await rivalAssertsLab();
    await readProfile({ refused: true, observedAt: new Date('2026-09-20T00:00:00Z') });
    await resolve();
    await resolve();
    expect(await storedWebsiteUrl()).toBe(LAB_URL);
  }, 120000);

  it('lets a newer read that adopts the link again win over the older refusal', async () => {
    await readProfile({ refused: true, observedAt: new Date('2026-08-20T00:00:00Z') });
    await readProfile({ refused: false, observedAt: new Date('2026-09-20T00:00:00Z') });
    await resolve();
    await resolve();
    expect(await storedWebsiteUrl()).toBe(LAB_URL);
  }, 120000);

  it('never stores the refusal itself on the row', async () => {
    await readProfile({ refused: true, observedAt: new Date('2026-09-20T00:00:00Z') });
    await resolve();
    const row = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<Record<string, any>>();
    expect(row).toBeTruthy();
    expect(row?.refusedWebsiteUrl).toBeUndefined();
    expect(row?.fieldProvenance?.refusedWebsiteUrl).toBeUndefined();
  }, 120000);
});
