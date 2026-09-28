import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { engineOutputFingerprint, scoreEngineReplay } from '../engineBenchmarkCore';
import { captureEngineBenchmark, replayEngineBenchmark } from '../engineBenchmarkRun';

/**
 * The claim #3589 rests on: a replay measures the code, not the corpus.
 *
 * Two replays giving the same digest proves determinism but not isolation, because a
 * replay that reads the live corpus twice in a row also agrees with itself. So the test
 * that matters deletes the live rows between replays and requires the digest to hold: if
 * the engine reached past the frozen input for anything, the second replay sees an empty
 * corpus and answers differently.
 */
const BENCHMARK_ID = 'fixture-engine-benchmark';
const SOURCE_NAME = 'fixture-engine-source';
const SLUG = 'fixture-engine-benchmark-row';

const RESEARCH_BODY =
  'The group studies how intertidal invertebrates regulate calcium during shell formation, pairing field transplants across four sites with controlled-pH aquaria to separate temperature effects from acidification effects.';

const seedCorpus = async (): Promise<void> => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const entityId = new mongoose.Types.ObjectId();
  await db.collection('sources').insertOne({
    _id: new mongoose.Types.ObjectId(),
    name: SOURCE_NAME,
    weight: 0.9,
  });
  await db.collection('research_entities').insertOne({
    _id: entityId,
    slug: SLUG,
    name: 'Example Intertidal Group',
    kind: 'group',
    entityType: 'LAB',
    schemaVersion: 1,
    archived: false,
    studentVisibilityTier: 'student_ready',
    studentVisibilityReasons: [],
    fullDescription: RESEARCH_BODY,
    websiteUrl: 'https://biology.example.edu/intertidal/',
    sourceUrls: ['https://biology.example.edu/intertidal/'],
  });
  await db.collection('observations').insertMany(
    ['fullDescription', 'name'].map((field) => ({
      _id: new mongoose.Types.ObjectId(),
      entityType: 'researchEntity',
      entityKey: SLUG,
      entityId,
      field,
      value: field === 'name' ? 'Example Intertidal Group' : RESEARCH_BODY,
      sourceName: SOURCE_NAME,
      sourceUrl: 'https://biology.example.edu/intertidal/',
      confidence: 0.9,
      superseded: false,
      observedAt: new Date('2026-01-01T00:00:00.000Z'),
    })),
  );
};

/**
 * A replay that resolved nothing is deterministic for the wrong reason: an empty input
 * agrees with itself, so every assertion below it holds while measuring nothing. Asserted
 * in each replay test rather than once, because the vacuous pass is the failure mode the
 * first run of this suite actually hit.
 */
const expectReplayResolvedSomething = (
  rows: readonly { plannedSet: Record<string, unknown> }[],
) => {
  const planned = rows.flatMap((row) => Object.keys(row.plannedSet));
  expect(planned.length).toBeGreaterThan(0);
};

const deleteLiveCorpus = async (): Promise<void> => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  for (const name of ['research_entities', 'observations']) {
    await db.collection(name).deleteMany({});
  }
};

describe('the engine benchmark replays a frozen input rather than the corpus (#3589)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'research_entities',
      'observations',
      'sources',
      'engine_benchmarks',
      'engine_benchmark_rows',
    ]) {
      await db.collection(name).deleteMany({});
    }
    await seedCorpus();
  });

  it('captures the row its scope predicate selects, with its observations', async () => {
    const capture = await captureEngineBenchmark({
      benchmarkId: BENCHMARK_ID,
      perScopeLimit: 5,
    });

    expect(capture.rowCount).toBe(1);
    expect(capture.observationCount).toBe(2);
    expect(capture.byScope.find((entry) => entry.scope === 'served')?.rows).toBe(1);
  }, 60000);

  it('gives the same fingerprint on two replays of unchanged code', async () => {
    await captureEngineBenchmark({ benchmarkId: BENCHMARK_ID, perScopeLimit: 5 });

    const first = await replayEngineBenchmark(BENCHMARK_ID);
    const second = await replayEngineBenchmark(BENCHMARK_ID);

    expect(first.rows).toHaveLength(1);
    expectReplayResolvedSomething(first.rows);
    expect(engineOutputFingerprint(first.rows)).toBe(engineOutputFingerprint(second.rows));
  }, 120000);

  it('gives the same fingerprint after the live rows it was captured from are deleted', async () => {
    await captureEngineBenchmark({ benchmarkId: BENCHMARK_ID, perScopeLimit: 5 });
    const beforeDeletion = await replayEngineBenchmark(BENCHMARK_ID);

    await deleteLiveCorpus();
    const afterDeletion = await replayEngineBenchmark(BENCHMARK_ID);

    expect(afterDeletion.rows).toHaveLength(1);
    expectReplayResolvedSomething(beforeDeletion.rows);
    expectReplayResolvedSomething(afterDeletion.rows);
    expect(engineOutputFingerprint(afterDeletion.rows)).toBe(
      engineOutputFingerprint(beforeDeletion.rows),
    );
  }, 120000);

  it('reports a gate verdict for the replayed row', async () => {
    await captureEngineBenchmark({ benchmarkId: BENCHMARK_ID, perScopeLimit: 5 });

    const replay = await replayEngineBenchmark(BENCHMARK_ID);
    const score = scoreEngineReplay(replay.rows, []);

    expectReplayResolvedSomething(replay.rows);
    expect(score.rowsReplayed).toBe(1);
    expect(score.gateTiers.reduce((sum, entry) => sum + entry.rows, 0)).toBe(1);
  }, 120000);

  /**
   * This row has research prose and no card, so the materializer does ask for synthesis.
   * The guarantee is not that it never asks: it is that asking reaches a refusal that
   * returns nothing and is counted. A replay that quietly called the live model would be
   * neither reproducible nor free, and the count is what makes a lane that starts asking
   * visible as a number instead of as drift in the fingerprint.
   */
  it('counts a card synthesis request instead of calling the model', async () => {
    await captureEngineBenchmark({ benchmarkId: BENCHMARK_ID, perScopeLimit: 5 });

    const replay = await replayEngineBenchmark(BENCHMARK_ID);

    expect(replay.cardSynthesisRequested).toBeGreaterThan(0);
    expect(replay.rows.every((row) => !row.plannedSet.shortDescription)).toBe(true);
  }, 120000);
});
