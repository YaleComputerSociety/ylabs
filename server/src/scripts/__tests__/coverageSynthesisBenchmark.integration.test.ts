import axios, { type AxiosAdapter } from 'axios';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelCallUsage } from '../../models/modelCallUsage';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { WrittenDescriptionDerivation } from '../../models/writtenDescriptionDerivation';
import {
  beginBenchmarkCapture,
  beginBenchmarkReplay,
  finishBenchmarkCaptureWithCoverage,
  finishBenchmarkReplay,
  MODEL_RESPONSE_NAMESPACE,
  type CapturedPage,
} from '../../scrapers/snapshotBenchmarkMode';
import { WRITER_EVIDENCE_BENCHMARK_NAMESPACE } from '../coverageSynthesisBenchmark';
import { BENCHMARKABLE_LANES, runLaneDry } from '../laneBenchmarkRun';

const LANE = 'coverage-synthesis-llm';
const SLUG = 'reef-lab-benchmark-fixture';
const PAGE_URL = 'https://reef-lab.example.org/research';
const PAGE_TEXT = [
  'Coral Reef Recovery',
  'We study how coral reefs recover after marine heatwaves and bleaching events.',
  'Our field surveys follow coral colonies and reef fish across the Caribbean.',
  'Algae Competition',
  'We test how algae compete with coral for space on damaged reefs.',
].join('\n');
const GOOD =
  'Studies how coral reefs recover after marine heatwaves and bleaching events. Field surveys follow coral colonies and reef fish across the Caribbean, and test how algae compete with coral for space on damaged reefs.';
const CAPTURED_AT = new Date('2026-11-10T00:00:00Z');

const modelAdapter = vi.fn<AxiosAdapter>(async (config) => ({
  data: {
    choices: [
      { message: { content: JSON.stringify({ fullDescription: GOOD, usedSnippetIndexes: [0] }) } },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  },
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
}));

async function capture(): Promise<{ pages: CapturedPage[]; planned: number }> {
  const originalAdapter = axios.defaults.adapter;
  axios.defaults.adapter = modelAdapter;
  beginBenchmarkCapture();
  let run;
  try {
    run = await runLaneDry({ sourceName: LANE, only: [SLUG], referenceDate: CAPTURED_AT });
  } finally {
    axios.defaults.adapter = originalAdapter;
  }
  const { pages } = finishBenchmarkCaptureWithCoverage();
  return { pages, planned: run.observations.length };
}

async function replay(pages: CapturedPage[]) {
  beginBenchmarkReplay(pages);
  try {
    return await runLaneDry({ sourceName: LANE, only: [SLUG], referenceDate: CAPTURED_AT });
  } finally {
    finishBenchmarkReplay();
  }
}

const counts = async () => ({
  observations: await Observation.countDocuments(),
  derivations: await WrittenDescriptionDerivation.countDocuments(),
  usages: await ModelCallUsage.countDocuments(),
});

describe('the coverage writer as a frozen-evidence benchmark (#5537)', () => {
  let replSet: MongoMemoryReplSet;
  const savedKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
    modelAdapter.mockClear();
  });

  beforeEach(async () => {
    process.env.OPENAI_API_KEY = 'sk-synthetic-test-key';
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'observations',
      'research_entities',
      'written_description_derivations',
      'model_call_usages',
    ]) {
      await db.collection(name).deleteMany({});
    }
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Reef Lab Benchmark Fixture',
      kind: 'lab',
      entityType: 'LAB',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SLUG,
      field: 'researchPageText',
      value: [{ url: PAGE_URL, text: PAGE_TEXT }],
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'research-page-text',
      sourceUrl: PAGE_URL,
      confidence: 0.85,
      observedAt: new Date('2026-11-01T00:00:00Z'),
      superseded: false,
    });
  });

  it('is a benchmarkable lane', () => {
    expect(BENCHMARKABLE_LANES.has(LANE)).toBe(true);
  });

  it('captures the evidence and the model answer and never touches the shared draft cache', async () => {
    const { pages, planned } = await capture();
    expect(planned).toBe(1);
    expect(modelAdapter).toHaveBeenCalledTimes(1);
    expect(pages.map((page) => page.sourceName).sort()).toEqual([
      WRITER_EVIDENCE_BENCHMARK_NAMESPACE,
      MODEL_RESPONSE_NAMESPACE,
    ]);
    expect(await WrittenDescriptionDerivation.countDocuments()).toBe(0);
  });

  it('replays offline on the frozen evidence with the frozen answer and writes nothing', async () => {
    const { pages } = await capture();
    await Observation.updateOne(
      { field: 'researchPageText' },
      { $set: { value: [{ url: PAGE_URL, text: 'Kelp forests and sea urchins only.' }] } },
    );
    delete process.env.OPENAI_API_KEY;
    const before = await counts();

    const run = await replay(pages);

    expect(modelAdapter).toHaveBeenCalledTimes(1);
    expect(run.observations).toEqual([
      expect.objectContaining({ entityKey: SLUG, field: 'fullDescription', value: GOOD }),
    ]);
    expect(run.writerRows).toEqual([
      expect.objectContaining({ slug: SLUG, step: 'synthesized', refusalReasons: [] }),
    ]);
    expect(await counts()).toEqual(before);
  });

  it('reports a writer refusal per row', async () => {
    const { pages } = await capture();
    const firstPerson = pages.map((page) =>
      page.sourceName === MODEL_RESPONSE_NAMESPACE
        ? {
            ...page,
            payload: {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      fullDescription: `We study coral. ${GOOD}`,
                      usedSnippetIndexes: [0],
                    }),
                  },
                },
              ],
            },
          }
        : page,
    );
    const run = await replay(firstPerson);
    expect(run.observations).toEqual([]);
    expect(run.writerRows).toEqual([
      expect.objectContaining({ slug: SLUG, step: 'refused', refusalReasons: ['first-person'] }),
    ]);
  });
});
