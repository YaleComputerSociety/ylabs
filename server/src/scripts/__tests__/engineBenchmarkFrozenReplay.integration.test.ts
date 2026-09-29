import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { engineOutputFingerprint, scoreEngineReplay } from '../engineBenchmarkCore';
import {
  captureEngineBenchmark,
  replayEngineBenchmark,
  rowsWithUnbackedStoredTopics,
} from '../engineBenchmarkRun';

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

const RIVAL_SOURCE = 'fixture-engine-rival-source';

/**
 * A second, older, lower-weighted assertion of the same field, so the resolver has a real
 * recency-decay decision to make and `confidenceByField` becomes a function of `now`.
 */
const seedRivalDescription = async (): Promise<void> => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('no db');
  const entity = await db.collection('research_entities').findOne({ slug: SLUG });
  if (!entity) throw new Error('fixture row missing');
  await db.collection('sources').insertOne({
    _id: new mongoose.Types.ObjectId(),
    name: RIVAL_SOURCE,
    weight: 0.6,
  });
  await db.collection('observations').insertOne({
    _id: new mongoose.Types.ObjectId(),
    entityType: 'researchEntity',
    entityKey: SLUG,
    entityId: (entity as { _id: unknown })._id,
    field: 'fullDescription',
    value:
      'An older account of the same group, describing shell-formation work across three field sites rather than four.',
    sourceName: RIVAL_SOURCE,
    sourceUrl: 'https://biology.example.edu/intertidal/archive/',
    confidence: 0.6,
    superseded: false,
    observedAt: new Date('2025-03-01T00:00:00.000Z'),
  });
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
    await replSet?.stop();
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

  /**
   * The defect the first real capture found. `confidenceResolver` weights every observation by
   * `recencyDecay(observedAt, now, halfLife)` and `confidenceByField` is a stored field, so with
   * a wall clock two replays of identical code computed different confidences: 67 of 90 rows
   * differed on that field alone and the benchmark reported itself unattributable. Pinning the
   * instant from the capture is what makes the digest hold; masking the field would have gone
   * green by making the instrument blind to a real change in engine output.
   */
  it('resolves the same confidence on two replays, because the clock is pinned', async () => {
    // Two rival observations of one field, from sources of different weight and read months
    // apart. That is what makes confidence clock-sensitive: a single observation normalises to 1
    // whatever the instant, so the original one-observation fixture could not have caught this.
    await seedRivalDescription();
    await captureEngineBenchmark({ benchmarkId: BENCHMARK_ID, perScopeLimit: 5 });

    const first = await replayEngineBenchmark(BENCHMARK_ID);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await replayEngineBenchmark(BENCHMARK_ID);

    const confidence = (rows: typeof first.rows) =>
      rows.map((row) => JSON.stringify(row.plannedSet.confidenceByField ?? null));
    expect(confidence(first.rows).join('|')).not.toBe('null');
    expect(confidence(first.rows)).toEqual(confidence(second.rows));
    expect(engineOutputFingerprint(first.rows)).toBe(engineOutputFingerprint(second.rows));
  }, 120000);

  /**
   * The sole-lead answer is the one prefetch read that is neither an observation nor the row
   * itself, and the first capture froze none of it, so all 90 rows fell through to a live read
   * and reported incomplete input.
   */
  it('freezes the sole-lead answer, so a replayed row reports no unfrozen read', async () => {
    await captureEngineBenchmark({ benchmarkId: BENCHMARK_ID, perScopeLimit: 5 });

    const replay = await replayEngineBenchmark(BENCHMARK_ID);

    expect(replay.rows.flatMap((row) => row.unfrozenReads)).toEqual([]);
  }, 120000);

  /**
   * A merge chain is transitive: a loser can itself have been merged into. The engine walks the
   * whole chain, so freezing only the first hop leaves the survivor reading a second-hop loser's
   * observations from the corpus. That is exactly what happened when the capture used its own
   * one-hop query instead of the engine's walk, and it left one benchmark row reporting an
   * unfrozen read (#3849).
   */
  it('freezes a two-hop merge chain, so a survivor reports no unfrozen read', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const survivor = await db.collection('research_entities').findOne({ slug: SLUG });
    if (!survivor) throw new Error('fixture row missing');
    const firstHopId = new mongoose.Types.ObjectId();
    const secondHopId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertMany([
      {
        _id: firstHopId,
        slug: 'fixture-engine-loser-hop-one',
        name: 'Absorbed Group One',
        kind: 'group',
        entityType: 'LAB',
        schemaVersion: 1,
        archived: true,
        canonicalGroupId: (survivor as { _id: unknown })._id,
      },
      {
        _id: secondHopId,
        slug: 'fixture-engine-loser-hop-two',
        name: 'Absorbed Group Two',
        kind: 'group',
        entityType: 'LAB',
        schemaVersion: 1,
        archived: true,
        canonicalGroupId: firstHopId,
      },
    ]);
    await db.collection('observations').insertOne({
      _id: new mongoose.Types.ObjectId(),
      entityType: 'researchEntity',
      entityKey: 'fixture-engine-loser-hop-two',
      entityId: secondHopId,
      field: 'methods',
      value: ['controlled-pH aquaria'],
      sourceName: SOURCE_NAME,
      sourceUrl: 'https://biology.example.edu/intertidal/absorbed-two/',
      confidence: 0.8,
      superseded: false,
      observedAt: new Date('2025-06-01T00:00:00.000Z'),
    });

    await captureEngineBenchmark({ benchmarkId: BENCHMARK_ID, perScopeLimit: 5 });
    const replay = await replayEngineBenchmark(BENCHMARK_ID);

    expect(replay.rows.flatMap((row) => row.unfrozenReads)).toEqual([]);
  }, 120000);

  /**
   * The arm that #3871 added, and the reason it exists: replaying #3868 against a benchmark
   * without it reported one row GAINING three topics while the regression stripped 138 chips from
   * 79 rows, because no arm selected the population a re-derivation acts on.
   *
   * Uses both identity forms deliberately. A `researchAreas` observation is keyed by `entityKey`
   * far more often than by `entityId` in this corpus, so an id-only join would call a
   * well-evidenced row unbacked, which is the mistake that made three earlier measurements wrong.
   */
  it('captures a row whose stored topics no live observation states', async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    const unbackedId = new mongoose.Types.ObjectId();
    const backedId = new mongoose.Types.ObjectId();
    await db.collection('research_entities').insertMany([
      {
        _id: unbackedId,
        slug: 'fixture-unbacked-topics',
        name: 'Unbacked Topics Row',
        kind: 'group',
        entityType: 'LAB',
        schemaVersion: 1,
        archived: false,
        studentVisibilityTier: 'student_ready',
        researchAreas: ['Immunology', 'Genetics'],
      },
      {
        _id: backedId,
        slug: 'fixture-backed-topics',
        name: 'Backed Topics Row',
        kind: 'group',
        entityType: 'LAB',
        schemaVersion: 1,
        archived: false,
        studentVisibilityTier: 'student_ready',
        researchAreas: ['Biophysics'],
      },
    ]);
    // Backed by entityKey only, which is the common shape and the one an id-only join misses.
    await db.collection('observations').insertOne({
      _id: new mongoose.Types.ObjectId(),
      entityType: 'researchEntity',
      entityKey: 'fixture-backed-topics',
      field: 'researchAreas',
      value: ['Biophysics'],
      sourceName: SOURCE_NAME,
      sourceUrl: 'https://biology.example.edu/backed/',
      confidence: 0.8,
      superseded: false,
      observedAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const unbacked = (await rowsWithUnbackedStoredTopics()).map(String);

    expect(unbacked).toContain(String(unbackedId));
    expect(unbacked).not.toContain(String(backedId));

    // And the arm is wired into the capture, which is a separate claim from the predicate working.
    const capture = await captureEngineBenchmark({ benchmarkId: BENCHMARK_ID, perScopeLimit: 20 });
    expect(capture.byScope.map((entry) => entry.scope)).toContain('unbacked-topics');
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
