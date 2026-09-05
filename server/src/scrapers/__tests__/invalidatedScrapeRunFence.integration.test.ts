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
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeEntity, materializeFromRun } from '../entityMaterializer';
import {
  partitionObservationsByInvalidatedRun,
  resetInvalidatedScrapeRunCache,
} from '../invalidatedScrapeRuns';

/**
 * `scrapeRun.invalidated` is how an operator quarantines a bad run's evidence.
 * Before #2469 nothing on the write path read it: `sourceHealthService` honoured it
 * but `materializeFromRun` and `observations:catch-up-materialize` did not, so a
 * quarantined run's observations were structurally indistinguishable from good ones
 * and the catch-up lane would have materialized them.
 *
 * The live case that motivated it: run `dept-faculty-roster` was killed mid-scrape
 * because the source had no identity validation, leaving 7,300 live observations
 * across 650 keys marked `invalidated: true` - 273 `researchEntity` keys (221 of
 * which already have a served entity row, so materializing would have written
 * known-bad citations into live records) and 377 `user` keys carrying identity
 * fields.
 */
const GOOD_RUN_ID = new mongoose.Types.ObjectId();
const BAD_RUN_ID = new mongoose.Types.ObjectId();
const SLUG = 'fence-fixture';

// Realistic prose rather than an obviously-bad string: a placeholder like "bad
// citation" is rejected by the description quality gates, so the fence would never
// be the thing under test. Mutating the fence must be what makes these fail.
const QUARANTINED_DESCRIPTION =
  'The laboratory investigates enteric viral pathogenesis in the mouse intestine.';

const SOURCE_ID = new mongoose.Types.ObjectId();

const seedRuns = async () => {
  await ScrapeRun.create({
    _id: GOOD_RUN_ID,
    sourceId: SOURCE_ID,
    sourceName: 'test-source',
    status: 'success',
    invalidated: false,
  });
  await ScrapeRun.create({
    _id: BAD_RUN_ID,
    sourceId: SOURCE_ID,
    sourceName: 'test-source',
    status: 'failure',
    invalidated: true,
  });
};

const observation = (runId: mongoose.Types.ObjectId, field: string, value: unknown) => ({
  entityType: 'researchEntity',
  entityKey: SLUG,
  field,
  value,
  sourceId: SOURCE_ID,
  sourceName: 'test-source',
  scrapeRunId: runId,
  observedAt: new Date(),
  confidence: 0.9,
  superseded: false,
  observationFingerprint: `${field}-${String(runId)}-${String(value)}`,
});

describe('invalidated scrape runs are fenced out of the write path (#2469)', () => {
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
    for (const name of ['observations', 'research_entities', 'scrape_runs', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
    resetInvalidatedScrapeRunCache();
    await seedRuns();
  });

  it('does not mint an entity from an invalidated run alone', async () => {
    await Observation.create([
      observation(BAD_RUN_ID, 'name', 'Quarantined Lab'),
      observation(BAD_RUN_ID, 'entityType', 'LAB'),
      observation(BAD_RUN_ID, 'kind', 'lab'),
    ]);

    const result = await materializeEntity('researchEntity', { entityKey: SLUG });

    expect(result.created).toBe(false);
    expect(result.fieldsWritten).toBe(0);
    expect(await ResearchEntity.countDocuments({ slug: SLUG })).toBe(0);
  });

  // Withheld evidence must be distinguishable from absent evidence: both write
  // nothing and would otherwise return identical counters, which is exactly what
  // made the empty-observation guard invisible in #2467.
  it('reports withheld evidence distinctly from no evidence', async () => {
    await Observation.create([observation(BAD_RUN_ID, 'name', 'Quarantined Lab')]);
    const withheld = await materializeEntity('researchEntity', { entityKey: SLUG });
    expect(withheld.skipped).toBe('invalidated-run-evidence');

    await Observation.deleteMany({});
    const absent = await materializeEntity('researchEntity', { entityKey: 'no-evidence-at-all' });
    expect(absent.skipped).toBeUndefined();
  });

  it('does not write an invalidated run field onto an entity that already exists', async () => {
    await ResearchEntity.create({
      slug: SLUG,
      name: 'Good Lab',
      entityType: 'LAB',
      kind: 'lab',
      shortDescription: 'Studies mucosal immunity.',
      archived: false,
    });
    await Observation.create([
      observation(BAD_RUN_ID, 'shortDescription', QUARANTINED_DESCRIPTION),
    ]);

    const result = await materializeEntity('researchEntity', { entityKey: SLUG });

    // The skip reason is the fence-sensitive assertion here. The stored-value check
    // below is weaker than it looks: a lone shortDescription observation does not
    // land on an existing entity even without the fence, so on its own it would pass
    // against an unfenced materializer.
    expect(result.skipped).toBe('invalidated-run-evidence');
    const after = await ResearchEntity.findOne({ slug: SLUG }).lean<{
      shortDescription?: string;
    }>();
    expect(after?.shortDescription).toBe('Studies mucosal immunity.');
  });

  // Documents the mixed-run outcome and is deliberately NOT fence-sensitive: it also
  // passes against an unfenced materializer, because a lone shortDescription from a
  // second source does not win on this key regardless. Kept because the mixed case
  // is the one a reader will ask about, marked so it is not mistaken for protection.
  it('keeps good-run evidence while withholding the invalidated run on the same key', async () => {
    await Observation.create([
      observation(GOOD_RUN_ID, 'name', 'Good Lab'),
      observation(GOOD_RUN_ID, 'entityType', 'LAB'),
      observation(GOOD_RUN_ID, 'kind', 'lab'),
      observation(BAD_RUN_ID, 'shortDescription', QUARANTINED_DESCRIPTION),
    ]);

    await materializeEntity('researchEntity', { entityKey: SLUG });

    const after = await ResearchEntity.findOne({ slug: SLUG }).lean<{
      name?: string;
      shortDescription?: string;
    }>();
    expect(after?.name).toBe('Good Lab');
    // Empty rather than absent: the schema defaults this field to ''. What matters
    // is that the quarantined run's text is not what landed.
    expect(after?.shortDescription || '').toBe('');
  });

  it('materializeFromRun refuses an invalidated run without enumerating it', async () => {
    await Observation.create([
      observation(BAD_RUN_ID, 'name', 'Quarantined Lab'),
      observation(BAD_RUN_ID, 'entityType', 'LAB'),
      observation(BAD_RUN_ID, 'kind', 'lab'),
    ]);

    const result = await materializeFromRun(String(BAD_RUN_ID));

    expect(result.materialized).toBe(0);
    expect(result.created).toBe(0);
    expect(await ResearchEntity.countDocuments({ slug: SLUG })).toBe(0);
  });

  it('materializeFromRun still materializes a run that is not invalidated', async () => {
    await Observation.create([
      observation(GOOD_RUN_ID, 'name', 'Good Lab'),
      observation(GOOD_RUN_ID, 'entityType', 'LAB'),
      observation(GOOD_RUN_ID, 'kind', 'lab'),
    ]);

    const result = await materializeFromRun(String(GOOD_RUN_ID));

    expect(result.materialized).toBeGreaterThan(0);
    expect(await ResearchEntity.countDocuments({ slug: SLUG })).toBe(1);
  });
});

describe('partitionObservationsByInvalidatedRun', () => {
  const rows = [
    { scrapeRunId: 'run-good', field: 'name' },
    { scrapeRunId: 'run-bad', field: 'shortDescription' },
    { scrapeRunId: undefined, field: 'kind' },
  ];

  it('keeps everything when no run is invalidated', () => {
    expect(partitionObservationsByInvalidatedRun(rows, [])).toEqual({
      kept: rows,
      withheld: [],
    });
  });

  it('withholds only the invalidated run and keeps observations with no run id', () => {
    const { kept, withheld } = partitionObservationsByInvalidatedRun(rows, ['run-bad']);
    expect(withheld.map((row) => row.field)).toEqual(['shortDescription']);
    expect(kept.map((row) => row.field)).toEqual(['name', 'kind']);
  });
});
