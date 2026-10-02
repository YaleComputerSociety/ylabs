import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    syncEntities: vi.fn().mockResolvedValue(undefined),
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
import { ScrapeRun } from '../../models/scrapeRun';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';
import { materializeEntity } from '../../scrapers/entityMaterializer';
import { appendObservations } from '../../scrapers/observationStore';
import {
  countWebsiteUrlOwnerRows,
  planDeadResearchWebsiteClears,
  planDeadWebsiteClearWrite,
  planDeadWebsiteRefusalWithdrawals,
  planDeadWebsiteRefusalWithdrawalWrite,
  type DeadWebsiteRow,
} from '../clearDeadResearchWebsitesCore';
import { isKnownDeadSourceUrl } from '../../services/sourceLinkHealth';
import {
  extractProfile,
  facultyToResearchEntityObservations,
  type RawYsmFaculty,
} from '../../scrapers/sources/ysmFacultyDirectoryScraper';

const SOURCE_NAME = 'ysm-faculty-directory';
const SOURCE_ID = new mongoose.Types.ObjectId();
const ENTITY_KEY = 'ysm-faculty-jordan-rivers';

const RIVERS: RawYsmFaculty = {
  name: 'Rivers, Jordan',
  profileUrl: 'https://medicine.yale.edu/profile/jordan-rivers/',
  slug: 'jordan-rivers',
};

function profileHtml(options: {
  labWebsite?: { name: string; url: string; description?: string };
}): string {
  const pageData = {
    mainComponents: [
      {
        key: 'ProfileDetails',
        model: {
          fullName: 'Jordan Rivers',
          sections: [
            {
              sectionType: 'about',
              bio: '',
              workdayTitle: 'Professor of Medicine',
              appointments: [],
              organizations: [],
            },
            {
              sectionType: 'research',
              researchDescription: '',
              meshKeywords: [{ id: 1000, name: 'Heart Failure' }],
              labWebsite: options.labWebsite ?? null,
              orcids: [],
            },
            { sectionType: 'getInTouch', email: 'jordan.rivers@yale.edu' },
          ],
        },
      },
    ],
  };
  return `<html><body><script id='page-data' type='application/json'>${JSON.stringify(
    pageData,
  )}</script></body></html>`;
}

async function runDirectoryPass(labWebsite?: { name: string; url: string }): Promise<string> {
  const profile = extractProfile(profileHtml({ labWebsite }), RIVERS);
  if (!profile) throw new Error('probe fixture produced no profile');
  const observations = facultyToResearchEntityObservations(
    profile,
    'netid:jordan.rivers',
    NO_SURNAME_ROSTER,
  );
  expect(observations.length).toBeGreaterThan(0);

  const run = await ScrapeRun.create({
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    status: 'success',
    startedAt: new Date(),
  });
  const scrapeRunId = String(run._id);
  const appended = await appendObservations(observations, {
    scrapeRunId,
    sourceId: String(SOURCE_ID),
    sourceName: SOURCE_NAME,
    sourceWeight: 0.8,
    dryRun: false,
  });
  expect(appended.inserted).toBeGreaterThan(0);

  await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});
  return scrapeRunId;
}

const liveWebsiteUrlObservations = () =>
  Observation.find({
    entityType: 'researchEntity',
    entityKey: ENTITY_KEY,
    field: 'websiteUrl',
    superseded: { $ne: true },
  }).lean();

const DEAD_LAB = 'https://riverslab.example.org/';

const storedRow = () =>
  ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<DeadWebsiteRow & Record<string, unknown>>();

const recordHealth = (healthStatus: 'UNAVAILABLE' | 'HEALTHY', httpStatusCode: number) =>
  ResearchEntity.updateOne(
    { slug: ENTITY_KEY },
    {
      $set: {
        sourceLinkHealth: [{ url: DEAD_LAB, healthStatus, httpStatusCode, checkedAt: new Date() }],
      },
    },
  );

const runClearStage = async () => {
  const row = await storedRow();
  if (!row) throw new Error('no row');
  const rows = [row];
  const owners = countWebsiteUrlOwnerRows(rows);
  const withdrawals = planDeadWebsiteRefusalWithdrawals(rows);
  if (withdrawals.length > 0) {
    await ResearchEntity.updateOne(
      { slug: ENTITY_KEY },
      { $set: planDeadWebsiteRefusalWithdrawalWrite(row, withdrawals, new Date()) },
    );
  }
  const outcome = planDeadResearchWebsiteClears(
    rows,
    (candidate, url) => isKnownDeadSourceUrl(candidate.sourceLinkHealth, url),
    () => 0,
    (key) => owners.get(key) ?? 0,
  );
  if (outcome.plans.length > 0) {
    await ResearchEntity.updateOne(
      { slug: ENTITY_KEY },
      { $set: planDeadWebsiteClearWrite(row, outcome.plans, new Date()) },
    );
  }
  return { plans: outcome.plans.length, withdrawals: withdrawals.length };
};

const resolve = () => materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

describe('a dead research website cleared by the sweep stays cleared on resolve (#3722)', () => {
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
    for (const name of [
      'observations',
      'research_entities',
      'role_assignments',
      'signals',
      'scrape_runs',
      'researchers',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  it('brings a dead website back on the next resolve when only the field is cleared', async () => {
    await runDirectoryPass({ name: 'Rivers Lab', url: DEAD_LAB });
    expect((await storedRow())?.websiteUrl).toBe(DEAD_LAB);

    await ResearchEntity.updateOne({ slug: ENTITY_KEY }, { $set: { websiteUrl: '' } });
    await resolve();

    expect((await storedRow())?.websiteUrl).toBe(DEAD_LAB);
  }, 180000);

  it('keeps the dead website off across two resolves and a re-observation', async () => {
    await runDirectoryPass({ name: 'Rivers Lab', url: DEAD_LAB });
    await recordHealth('UNAVAILABLE', 404);

    expect(await runClearStage()).toEqual({ plans: 1, withdrawals: 0 });
    expect((await storedRow())?.websiteUrl).toBe('');

    await resolve();
    await resolve();
    expect((await storedRow())?.websiteUrl).toBe('');

    await runDirectoryPass({ name: 'Rivers Lab', url: DEAD_LAB });
    expect((await storedRow())?.websiteUrl).toBe('');
    expect((await liveWebsiteUrlObservations()).length).toBeGreaterThan(0);
    expect(await runClearStage()).toEqual({ plans: 0, withdrawals: 0 });
  }, 180000);

  it('re-admits the website once the link-health lane reads it healthy again', async () => {
    await runDirectoryPass({ name: 'Rivers Lab', url: DEAD_LAB });
    await recordHealth('UNAVAILABLE', 404);
    await runClearStage();
    await resolve();
    expect((await storedRow())?.websiteUrl).toBe('');

    await recordHealth('HEALTHY', 200);
    expect(await runClearStage()).toEqual({ plans: 0, withdrawals: 1 });
    await resolve();

    expect((await storedRow())?.websiteUrl).toBe(DEAD_LAB);
    expect(await runClearStage()).toEqual({ plans: 0, withdrawals: 0 });
  }, 180000);
});
