import axios from 'axios';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { defaultCardSynthesisLLM } from '../../utils/groundedCardSynthesis';
import {
  ModelCallRefusedError,
  restoreDefaultModelUsageSink,
  setModelUsageSink,
  type ModelUsageRecord,
  withoutModelCalls,
} from '../../utils/modelClient';
import { materializeEntity } from '../entityMaterializer';
import {
  CURRENT_CARD_INPUTS,
  cardInputHash,
  mongoCardSynthesisDerivationStore,
} from '../cardSynthesisDerivation';
import { collectCardRequests } from '../../scripts/cardSynthesisCore';

const SLUG = 'tidepool-no-model-calls-fixture';
const BODY =
  'The Tidepool Lab studies how coastal kelp forests recover after marine heatwaves along rocky temperate shores, combining long-term field surveys of kelp canopy cover, sea urchin grazing pressure, water temperature records and juvenile kelp recruitment across many monitored sites and seasons. The lab also compares recovery across shores.';
const CACHED_CARD =
  'Studies how coastal kelp forests recover after marine heatwaves along rocky shores.';

describe('materialization makes no model calls (#5537)', () => {
  let replSet: MongoMemoryReplSet;
  const usage: ModelUsageRecord[] = [];
  const savedKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    process.env.OPENAI_API_KEY = 'sk-synthetic-test-key';
    usage.length = 0;
    setModelUsageSink(async (record) => {
      usage.push(record);
    });
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'card_synthesis_derivations'])
      await db.collection(name).deleteMany({});
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Tidepool Lab Fixture',
      kind: 'lab',
      entityType: 'LAB',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: 'fullDescription',
      value: BODY,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://tidepool.example.org/',
      confidence: 0.9,
      observedAt: new Date(),
      superseded: false,
    });
  });

  afterEach(() => {
    restoreDefaultModelUsageSink();
    vi.restoreAllMocks();
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });

  it('writes no synthesized card with an API key set and its default synthesizer', async () => {
    const post = vi.spyOn(axios, 'post');
    const result = await materializeEntity(
      'researchEntity',
      { entityKey: SLUG },
      { dryRun: false },
    );
    expect(result.entityId).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    expect(usage).toEqual([]);
  });

  it('reads a cached card for the body it projects and still makes no model call', async () => {
    const requests = await collectCardRequests([{ slug: SLUG, name: 'Tidepool Lab Fixture' }]);
    expect(requests.length).toBeGreaterThan(0);
    await mongoCardSynthesisDerivationStore.save({
      inputHash: cardInputHash(requests[0].fullDescription),
      promptHash: CURRENT_CARD_INPUTS.promptHash,
      model: CURRENT_CARD_INPUTS.model,
      writer: 'claude-agent:test',
      rawCards: [CACHED_CARD],
      derivedAt: new Date(),
    });
    const post = vi.spyOn(axios, 'post');
    const result = await materializeEntity('researchEntity', { entityKey: SLUG }, { dryRun: true });
    expect(result.plannedSet?.shortDescription).toBe(CACHED_CARD);
    expect(post).not.toHaveBeenCalled();
    expect(usage).toEqual([]);
  });

  it('refuses any model call made inside the materialization scope', async () => {
    const post = vi.spyOn(axios, 'post');
    const call = () =>
      defaultCardSynthesisLLM({
        fullDescription: BODY,
        entityName: 'Tidepool Lab Fixture',
        maxCharacters: 160,
        apiKey: 'sk-synthetic-test-key',
        model: 'gpt-5-mini',
      });
    await expect(withoutModelCalls('materializeEntity', call)).rejects.toBeInstanceOf(
      ModelCallRefusedError,
    );
    expect(post).not.toHaveBeenCalled();
    expect(usage).toEqual([]);
  });
});
