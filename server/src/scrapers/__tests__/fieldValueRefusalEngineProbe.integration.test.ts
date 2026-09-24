/**
 * The claim the whole refusal design rests on, run against a real materialize: a
 * refusal survives re-observation and `superseded` does not (#3167).
 *
 * `superseded` retires one observation ROW. The next run mints a fresh row carrying
 * the same value, live and unopposed, which is the #2542 mechanism itself. So the
 * contrast is the test: supersede the row and the wrong value comes back on the next
 * pass; record a refusal and it does not, because the refusal is keyed on the value.
 *
 * The other half is that a refusal must not behave like `manuallyLockedFields`: a
 * better rival at the same field still has to win, or the row can never improve and
 * the lock has been reinvented.
 */
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
import { materializeEntity } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import {
  fieldValueRefusalKey,
  fieldValueRefusalsPath,
  planFieldValueRefusal,
  planFieldValueRefusalWithdrawal,
} from '../../utils/researchEntityFieldValueRefusals';
import {
  extractProfile,
  facultyToResearchEntityObservations,
  type RawYsmFaculty,
} from '../sources/ysmFacultyDirectoryScraper';

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

const storedWebsiteUrl = async (): Promise<unknown> => {
  const doc = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<{ websiteUrl?: unknown }>();
  return doc?.websiteUrl;
};

const liveWebsiteUrlObservations = () =>
  Observation.find({
    entityType: 'researchEntity',
    entityKey: ENTITY_KEY,
    field: 'websiteUrl',
    superseded: { $ne: true },
  }).lean();

const WRONG_LAB = 'https://journals.example.org/doi/10.1177/000000';
const RIGHT_LAB = 'https://riverslab.example.org';

/**
 * Recording a refusal clears the stored value in the same write when the stored
 * value is the one being refused, which is what `research-entity:refuse-field-value`
 * does.
 *
 * The refusal itself is forward-looking: it removes a candidate before the resolver
 * ranks, so it stops the value being ADOPTED again. It deliberately does not reach
 * back and unset a field on its own during materialization, because a materializer
 * that unsets a served field on a sweep is how a value someone removed disappears
 * without a visibility re-gate. Clearing is therefore the operation's job and
 * keeping it clear is the refusal's.
 */
const refuse = async (value: string) => {
  const doc = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<Record<string, unknown>>();
  const storedKey = fieldValueRefusalKey('websiteUrl', doc?.websiteUrl);
  const clearStored = storedKey !== '' && storedKey === fieldValueRefusalKey('websiteUrl', value);
  await ResearchEntity.updateOne(
    { slug: ENTITY_KEY },
    {
      $set: planFieldValueRefusal(doc?.fieldValueRefusals, {
        field: 'websiteUrl',
        value,
        rule: 'not_this_rows_research',
        refusedBy: 'probe',
        note: 'the page is a journal article, not this row research',
      }),
      ...(clearStored ? { $unset: { websiteUrl: '' } } : {}),
    },
  );
};

describe('a durable refusal survives re-observation where superseded does not (#3167)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 120000);

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

  it('lets the wrong value back when the observation is merely superseded', async () => {
    await runDirectoryPass({ name: 'Rivers Lab', url: WRONG_LAB });
    expect(await storedWebsiteUrl()).toBe(WRONG_LAB);

    await Observation.updateMany(
      { entityType: 'researchEntity', entityKey: ENTITY_KEY, field: 'websiteUrl' },
      { $set: { superseded: true, rollback: { rolledBackAt: new Date(), reason: 'probe' } } },
    );
    await ResearchEntity.updateOne({ slug: ENTITY_KEY }, { $unset: { websiteUrl: '' } });
    expect(await liveWebsiteUrlObservations()).toHaveLength(0);

    // The next pass re-states the same value, which is what a real re-scrape does.
    await runDirectoryPass({ name: 'Rivers Lab', url: WRONG_LAB });

    expect(await storedWebsiteUrl()).toBe(WRONG_LAB);
  }, 180000);

  it('keeps the wrong value out across a re-observation once refused', async () => {
    await runDirectoryPass({ name: 'Rivers Lab', url: WRONG_LAB });
    expect(await storedWebsiteUrl()).toBe(WRONG_LAB);

    await refuse(WRONG_LAB);
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});
    expect(await storedWebsiteUrl()).not.toBe(WRONG_LAB);

    await runDirectoryPass({ name: 'Rivers Lab', url: WRONG_LAB });

    expect(await storedWebsiteUrl()).not.toBe(WRONG_LAB);
    // The observation is still live: a refusal judges the value, it does not retire
    // the row, so the corpus keeps its record of what the source said.
    expect((await liveWebsiteUrlObservations()).length).toBeGreaterThan(0);
  }, 180000);

  it('still adopts a better value at the refused field, so the row can improve', async () => {
    await runDirectoryPass({ name: 'Rivers Lab', url: WRONG_LAB });
    await refuse(WRONG_LAB);
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});

    await runDirectoryPass({ name: 'Rivers Lab', url: RIGHT_LAB });

    expect(await storedWebsiteUrl()).toBe(RIGHT_LAB);
  }, 180000);

  it('re-admits the value once the refusal is withdrawn', async () => {
    await runDirectoryPass({ name: 'Rivers Lab', url: WRONG_LAB });
    await refuse(WRONG_LAB);
    await materializeEntity('researchEntity', { entityKey: ENTITY_KEY }, {});
    expect(await storedWebsiteUrl()).not.toBe(WRONG_LAB);

    const doc = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<Record<string, unknown>>();
    await ResearchEntity.updateOne(
      { slug: ENTITY_KEY },
      {
        $set: planFieldValueRefusalWithdrawal(
          doc?.fieldValueRefusals,
          'websiteUrl',
          WRONG_LAB,
          'the attribution was corrected at the source',
        ),
      },
    );
    await runDirectoryPass({ name: 'Rivers Lab', url: WRONG_LAB });

    expect(await storedWebsiteUrl()).toBe(WRONG_LAB);
  }, 180000);

  it('records the refusal under the field it names', async () => {
    await runDirectoryPass({ name: 'Rivers Lab', url: WRONG_LAB });
    await refuse(WRONG_LAB);

    const doc = await ResearchEntity.findOne({ slug: ENTITY_KEY }).lean<Record<string, any>>();
    const recorded =
      doc?.fieldValueRefusals?.websiteUrl ?? doc?.fieldValueRefusals?.get?.('websiteUrl');
    expect(recorded).toHaveLength(1);
    expect(recorded[0].rule).toBe('not_this_rows_research');
    expect(fieldValueRefusalsPath('websiteUrl')).toBe('fieldValueRefusals.websiteUrl');
  }, 180000);
});
