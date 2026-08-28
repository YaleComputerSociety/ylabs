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
import { materializeEntity } from '../entityMaterializer';

const MU_LAB_SHORT =
  'Studies the mechanisms of resistance to anti-cancer therapy and novel therapeutic approaches to overcome resistance.';

const MU_LAB_RESTATEMENT_FULL =
  'The Mu Lab studies the mechanisms of resistance to anti-cancer therapy and novel therapeutic approaches to overcome resistance.';

const MU_LAB_RICHER_FULL =
  'The Mu Lab combines patient-derived organoids and single-cell sequencing to map how tumors evolve resistance to targeted anti-cancer therapies, and tests combination regimens designed to delay or reverse that resistance in preclinical models.';

type PersistedEntity = { fullDescription?: string; shortDescription?: string };

describe('materializeEntity rejects a fullDescription that restates shortDescription (#1721)', () => {
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

  const seedEntity = async (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: 'restatement-fixture',
      name: 'Mu Lab',
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
      shortDescription: MU_LAB_SHORT,
      ...overrides,
    });

  const seedFull = async (
    value: string,
    sourceName: string,
    confidence: number,
    observedAt: string,
  ) => {
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'restatement-fixture',
      field: 'fullDescription',
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: `https://example.edu/${sourceName}/`,
      confidence,
      observedAt: new Date(observedAt),
      superseded: false,
    });
  };

  it('falls through past a restatement winner to a genuinely richer observation', async () => {
    await seedEntity();
    await seedFull(MU_LAB_RESTATEMENT_FULL, 'ysm-atoz-index', 0.95, '2026-02-01T00:00:00Z');
    await seedFull(MU_LAB_RICHER_FULL, 'lab-microsite-description-llm', 0.7, '2026-01-01T00:00:00Z');

    await materializeEntity('researchEntity', { entityKey: 'restatement-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'restatement-fixture',
    }).lean<PersistedEntity>();
    expect(persisted?.fullDescription).toBe(MU_LAB_RICHER_FULL);
    expect(persisted?.shortDescription).toBe(MU_LAB_SHORT);
  });

  it('blanks fullDescription when the only candidate restates the short and no richer alternative exists', async () => {
    await seedEntity();
    await seedFull(MU_LAB_RESTATEMENT_FULL, 'ysm-atoz-index', 0.95, '2026-02-01T00:00:00Z');

    await materializeEntity('researchEntity', { entityKey: 'restatement-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'restatement-fixture',
    }).lean<PersistedEntity>();
    expect(persisted?.fullDescription).toBe('');
    expect(persisted?.shortDescription).toBe(MU_LAB_SHORT);
  });

  it('does not blank a genuinely distinct fullDescription', async () => {
    await seedEntity();
    await seedFull(MU_LAB_RICHER_FULL, 'lab-microsite-description-llm', 0.95, '2026-02-01T00:00:00Z');

    await materializeEntity('researchEntity', { entityKey: 'restatement-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'restatement-fixture',
    }).lean<PersistedEntity>();
    expect(persisted?.fullDescription).toBe(MU_LAB_RICHER_FULL);
  });
});

const PROGRAM_SINGLE_SENTENCE_TEXT =
  'Fosters research and teaching across disciplines, including computer science, data science, and economics.';

describe('materializeEntity blanks a program fullDescription that is byte-identical to its shortDescription (#1773)', () => {
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

  it('blanks a stale byte-identical fullDescription on rematerialize even with no new fullDescription observation', async () => {
    await ResearchEntity.create({
      slug: 'program-restatement-fixture',
      name: 'Schmidt Program on AI',
      kind: 'program',
      entityType: 'COURSE_SEQUENCE',
      studentVisibilityTier: 'operator_review',
      archived: false,
      shortDescription: PROGRAM_SINGLE_SENTENCE_TEXT,
      fullDescription: PROGRAM_SINGLE_SENTENCE_TEXT,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'program-restatement-fixture',
      field: 'name',
      value: 'Schmidt Program on AI',
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'jackson-centers',
      sourceUrl: 'https://example.edu/jackson-centers/',
      confidence: 0.9,
      observedAt: new Date('2026-02-01T00:00:00Z'),
      superseded: false,
    });

    await materializeEntity('researchEntity', { entityKey: 'program-restatement-fixture' });

    const persisted = await ResearchEntity.findOne({
      slug: 'program-restatement-fixture',
    }).lean<PersistedEntity>();
    expect(persisted?.fullDescription).toBe('');
    expect(persisted?.shortDescription).toBe(PROGRAM_SINGLE_SENTENCE_TEXT);
  });
});

const IDEMPOTENCE_CONCISE_FULL_DESCRIPTION =
  'Studies climate adaptation, agricultural economics, and rural development policy.';

describe('materializeEntity is idempotent across repeated runs on unchanged observations', () => {
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

  /**
   * Regression for a materializer non-idempotence bug: a concise, already
   * card-shaped fullDescription is derived verbatim into shortDescription on
   * the first materialize pass (deriveShortDescriptionFromFullDescription's
   * "already concise" shortcut), which copies fullDescription's own
   * fieldProvenance onto shortDescription's. A second pass, run against the
   * exact same Observations with no new evidence, must not react to that
   * self-derived shortDescription and blank fullDescription out from under
   * itself - the fullDescription/shortDescription restatement guard
   * (#1721/#1773) previously did exactly that, because it fell back to
   * reading the just-written shortDescription off the entity document as if
   * it were independent evidence.
   */
  it('produces identical fullDescription/shortDescription on a second run with no new observations', async () => {
    await ResearchEntity.create({
      slug: 'idempotence-fixture',
      name: 'Rural Policy Lab',
      kind: 'lab',
      studentVisibilityTier: 'operator_review',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: 'idempotence-fixture',
      field: 'fullDescription',
      value: IDEMPOTENCE_CONCISE_FULL_DESCRIPTION,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'lab-microsite-description-llm',
      sourceUrl: 'https://example.edu/idempotence-fixture/',
      confidence: 0.9,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });

    await materializeEntity('researchEntity', { entityKey: 'idempotence-fixture' });
    const firstRun = await ResearchEntity.findOne({
      slug: 'idempotence-fixture',
    }).lean<PersistedEntity>();
    expect(firstRun?.fullDescription).toBe(IDEMPOTENCE_CONCISE_FULL_DESCRIPTION);
    expect(firstRun?.shortDescription).toBe(IDEMPOTENCE_CONCISE_FULL_DESCRIPTION);

    await materializeEntity('researchEntity', { entityKey: 'idempotence-fixture' });
    const secondRun = await ResearchEntity.findOne({
      slug: 'idempotence-fixture',
    }).lean<PersistedEntity>();
    expect(secondRun?.fullDescription).toBe(firstRun?.fullDescription);
    expect(secondRun?.shortDescription).toBe(firstRun?.shortDescription);
    expect(secondRun?.fullDescription).toBe(IDEMPOTENCE_CONCISE_FULL_DESCRIPTION);
  });
});
