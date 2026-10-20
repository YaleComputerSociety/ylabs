import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntities: vi.fn(async () => {}),
    syncEntity: vi.fn(async () => true),
    deleteFromIndex: vi.fn(async () => {}),
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return {
    ...actual,
    recomputeBrowseRankForEntities: vi.fn().mockResolvedValue({ updated: 0, indexSyncFailures: 0 }),
  };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeFromRun } from '../entityMaterializer';
import { appendObservations } from '../observationStore';
import {
  CODE_TOPIC_SOURCE_NAME,
  MODEL_TOPIC_SOURCE_NAME,
  TOPIC_HAND_OFF_REASON,
  planTopicHandOff,
  withoutHandedOffModelTopics,
} from '../topicHandOff';
import type { ObservationInput } from '../types';
import { clearC4Flags } from './c4FlagTestEnv';

const READ_ROW = 'quillfeather-lab';
const UNREAD_ROW = 'marrowstone-lab';
const MODEL_TOPICS = ['Alpine Microbes', 'Meltwater Chemistry', 'Thaw Seasons'];
const CODE_TOPICS = ['Glacier Hydrology', 'Membrane Biology'];

const afterAMoment = () => new Promise((resolve) => setTimeout(resolve, 5));

async function laneRun(sourceName: string, observations: ObservationInput[]): Promise<string> {
  await afterAMoment();
  const scrapeRunId = new mongoose.Types.ObjectId();
  await ScrapeRun.create({
    _id: scrapeRunId,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName,
    status: 'running',
  });
  await appendObservations(observations, {
    scrapeRunId: String(scrapeRunId),
    sourceId: String(new mongoose.Types.ObjectId()),
    sourceName,
    sourceWeight: 0.6,
    dryRun: false,
  });
  return String(scrapeRunId);
}

const topics = (entityKey: string, value: string[], confidenceOverride?: number) => ({
  entityType: 'researchEntity' as const,
  entityKey,
  field: 'researchAreas',
  value,
  sourceUrl: `https://example.org/lab/${entityKey}/`,
  ...(confidenceOverride ? { confidenceOverride } : {}),
});

const storedTopics = async (slug: string) =>
  ((await ResearchEntity.findOne({ slug }).lean()) as any)?.researchAreas ?? [];

const liveModelTopicRows = async (entityKey: string) =>
  Observation.countDocuments({
    sourceName: MODEL_TOPIC_SOURCE_NAME,
    field: 'researchAreas',
    entityKey,
    superseded: false,
  });

describe('topic hand-off from the model description lane to the code lane (#5296)', () => {
  it('retires the model list only where the code lane states topics', () => {
    const model = {
      _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      sourceName: MODEL_TOPIC_SOURCE_NAME,
      field: 'researchAreas',
      value: MODEL_TOPICS,
    };
    const code = {
      _id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      sourceName: CODE_TOPIC_SOURCE_NAME,
      field: 'researchAreas',
      value: CODE_TOPICS,
    };
    const emptyCode = { ...code, value: [] };
    expect(planTopicHandOff([model, code])).toEqual(['aaaaaaaaaaaaaaaaaaaaaaaa']);
    expect(planTopicHandOff([model, emptyCode])).toEqual([]);
    expect(planTopicHandOff([model])).toEqual([]);
    expect(withoutHandedOffModelTopics([model, code])).toEqual([code]);
    expect(withoutHandedOffModelTopics([model, emptyCode])).toEqual([model, emptyCode]);
    const otherField = { ...model, field: 'fullDescription' };
    expect(withoutHandedOffModelTopics([otherField, code])).toEqual([otherField, code]);
  });
});

describe(
  'a materialize after the code lane reads a row serves its topics and cannot restore the model list',
  { timeout: 120000 },
  () => {
    let replSet: MongoMemoryReplSet;

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      await mongoose.connect(replSet.getUri());
      await Observation.syncIndexes();
    });

    afterAll(async () => {
      await mongoose.disconnect();
      await replSet?.stop();
    });

    beforeEach(async () => {
      clearC4Flags();
      const db = mongoose.connection.db!;
      for (const name of ['observations', 'research_entities', 'scrape_runs']) {
        await db.collection(name).deleteMany({});
      }
      for (const [slug, name] of [
        [READ_ROW, 'Quillfeather Lab'],
        [UNREAD_ROW, 'Marrowstone Lab'],
      ]) {
        await ResearchEntity.create({
          slug,
          name,
          kind: 'lab',
          entityType: 'LAB',
          websiteUrl: `https://example.org/lab/${slug}/`,
          archived: false,
        });
      }
    });

    it('hands off where the code lane found topics and keeps the model list elsewhere', async () => {
      const modelRun = await laneRun(MODEL_TOPIC_SOURCE_NAME, [
        topics(READ_ROW, MODEL_TOPICS, 0.82),
        topics(UNREAD_ROW, MODEL_TOPICS, 0.82),
      ]);
      await materializeFromRun(modelRun);
      expect(await storedTopics(READ_ROW)).toEqual(MODEL_TOPICS);

      const codeRun = await laneRun(CODE_TOPIC_SOURCE_NAME, [topics(READ_ROW, CODE_TOPICS)]);
      await materializeFromRun(codeRun);

      expect(await storedTopics(READ_ROW)).toEqual(CODE_TOPICS);
      expect(await liveModelTopicRows(READ_ROW)).toBe(0);
      const retired = (await Observation.findOne({
        sourceName: MODEL_TOPIC_SOURCE_NAME,
        entityKey: READ_ROW,
        field: 'researchAreas',
      }).lean()) as any;
      expect(retired.rollback?.reason).toBe(TOPIC_HAND_OFF_REASON);

      expect(await storedTopics(UNREAD_ROW)).toEqual(MODEL_TOPICS);
      expect(await liveModelTopicRows(UNREAD_ROW)).toBe(1);

      await materializeFromRun(modelRun);
      expect(await storedTopics(READ_ROW)).toEqual(CODE_TOPICS);
    });

    it('keeps the code topics when the manual model lane asserts its list again', async () => {
      await materializeFromRun(
        await laneRun(MODEL_TOPIC_SOURCE_NAME, [topics(READ_ROW, MODEL_TOPICS, 0.82)]),
      );
      await materializeFromRun(
        await laneRun(CODE_TOPIC_SOURCE_NAME, [topics(READ_ROW, CODE_TOPICS)]),
      );
      await materializeFromRun(
        await laneRun(MODEL_TOPIC_SOURCE_NAME, [topics(READ_ROW, ['Rewritten Model Topic'], 0.82)]),
      );
      expect(await storedTopics(READ_ROW)).toEqual(CODE_TOPICS);
    });

    it('plans the hand-off on a dry run without retiring anything', async () => {
      await materializeFromRun(
        await laneRun(MODEL_TOPIC_SOURCE_NAME, [topics(READ_ROW, MODEL_TOPICS, 0.82)]),
      );
      const codeRun = await laneRun(CODE_TOPIC_SOURCE_NAME, [topics(READ_ROW, CODE_TOPICS)]);
      await materializeFromRun(codeRun, { dryRun: true });
      expect(await liveModelTopicRows(READ_ROW)).toBe(1);
      expect(await storedTopics(READ_ROW)).toEqual(MODEL_TOPICS);
    });
  },
);
