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
import { runReleaseRevisitableFieldLocks } from '../releaseRevisitableFieldLocks';

/**
 * End to end for the one thing #2612 is about: a lock a repair applied stops being
 * permanent, and only when releasing it cannot change what a student reads.
 *
 * Both halves matter equally, so both are asserted on stored documents rather than
 * on the run's counters. The release half proves a frozen row returns to the
 * engine; the refusal half proves the operation does not hand a cleared field back
 * to a source that still asserts the value someone removed, which is the way an
 * unlock turns into a regression.
 */
const SLUG = 'field-lock-release-fixture';

const seedEntity = async (over: Record<string, unknown> = {}) =>
  ResearchEntity.create({
    slug: SLUG,
    name: 'Release Fixture Lab',
    displayName: 'Release Fixture Lab',
    entityType: 'LAB',
    kind: 'lab',
    shortDescription: 'Studies how a lock is released.',
    fullDescription:
      'The laboratory studies whether a lock applied by a repair can be handed back to the engine without changing a served value.',
    archived: false,
    studentVisibilityTier: 'student_ready',
    ...over,
  });

const seedObservation = async (field: string, value: unknown) =>
  Observation.create({
    entityType: 'researchEntity',
    entityKey: SLUG,
    field,
    value,
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'lab-microsite-description-llm',
    sourceUrl: 'https://example.edu/lab/',
    confidence: 0.9,
    observedAt: new Date('2026-01-01T00:00:00Z'),
    superseded: false,
  });

const storedRow = () =>
  ResearchEntity.findOne({ slug: SLUG }).lean<{
    manuallyLockedFields?: string[];
    fieldLockProvenance?: Record<string, unknown>;
    websiteUrl?: string;
    methods?: string[];
  }>();

describe('research-entity:release-field-locks (#2612)', () => {
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

  const apply = () =>
    runReleaseRevisitableFieldLocks({ apply: true, confirm: true, slugs: [SLUG] });

  it('releases a lock that asserts absence once no source asserts a value either', async () => {
    await seedEntity({ websiteUrl: '', manuallyLockedFields: ['websiteUrl'] });
    await seedObservation('name', 'Release Fixture Lab');

    const result = await apply();

    expect(result.summary.released).toBe(1);
    expect((await storedRow())?.manuallyLockedFields).toEqual([]);
  });

  // The hazard this operation exists to avoid. The lock is a hand-rolled retraction
  // of a URL the source still states, so releasing it would serve that URL again.
  it('keeps an absence lock the engine disagrees with, and says the engine disagreed', async () => {
    await seedEntity({ websiteUrl: '', manuallyLockedFields: ['websiteUrl'] });
    await seedObservation('name', 'Release Fixture Lab');
    await seedObservation('websiteUrl', 'https://example.edu/lab/');

    const result = await apply();

    expect(result.summary.released).toBe(0);
    expect(result.decisions.map((decision) => decision.verdict)).toEqual(['keep_engine_disagrees']);
    expect((await storedRow())?.manuallyLockedFields).toEqual(['websiteUrl']);
    expect((await storedRow())?.websiteUrl).toBe('');
  });

  it('leaves an unrecorded lock that pins a value shut, whatever the engine derives', async () => {
    await seedEntity({
      websiteUrl: 'https://example.edu/pinned/',
      manuallyLockedFields: ['websiteUrl'],
    });
    await seedObservation('name', 'Release Fixture Lab');
    await seedObservation('websiteUrl', 'https://example.edu/pinned/');

    const result = await apply();

    expect(result.decisions.map((decision) => decision.verdict)).toEqual(['keep_not_revisitable']);
    expect((await storedRow())?.manuallyLockedFields).toEqual(['websiteUrl']);
  });

  it('releases a value lock recorded as a workaround when the engine derives that value', async () => {
    await seedEntity({
      websiteUrl: 'https://example.edu/pinned/',
      manuallyLockedFields: ['websiteUrl'],
      fieldLockProvenance: {
        websiteUrl: {
          reason: 'engine_gap_workaround',
          lockedBy: 'repair-fixture',
          lockedAt: new Date('2026-01-01T00:00:00Z'),
          note: '',
        },
      },
    });
    await seedObservation('name', 'Release Fixture Lab');
    await seedObservation('websiteUrl', 'https://example.edu/pinned/');

    const result = await apply();

    expect(result.summary.released).toBe(1);
    const after = await storedRow();
    expect(after?.manuallyLockedFields).toEqual([]);
    // The reason goes with the lock: a row must never record why it locks a field
    // it no longer locks.
    expect(after?.fieldLockProvenance?.websiteUrl).toBeUndefined();
    expect(after?.websiteUrl).toBe('https://example.edu/pinned/');
  });

  it('writes nothing in dry run, which is the default', async () => {
    await seedEntity({ websiteUrl: '', manuallyLockedFields: ['websiteUrl'] });
    await seedObservation('name', 'Release Fixture Lab');

    const result = await runReleaseRevisitableFieldLocks({
      apply: false,
      confirm: false,
      slugs: [SLUG],
    });

    expect(result.summary.released).toBe(1);
    expect(result.releasedRows).toBe(0);
    expect((await storedRow())?.manuallyLockedFields).toEqual(['websiteUrl']);
  });
});
