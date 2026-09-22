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
import {
  buildSupersededObservationPruneFilter,
  pruneSupersededObservations,
} from '../observationRetention';
import { clearC4Flags } from './c4FlagTestEnv';

/**
 * Pins the coupling between superseded-observation pruning and the materializer
 * read scope (#2944) against a real store and the real materializer.
 *
 * The two halves are individually safe and jointly destructive: the prune keys on
 * `superseded: true` because that means "not projected", which stops being true the
 * moment `C4_LOSSLESS_INGEST` widens the read scope to the whole retained log. The
 * unit tests assert the guard throws; these assert what the guard is protecting,
 * which is a served field whose sole surviving evidence is a superseded row.
 */
const ENTITY_SLUG = 'lossless-sole-evidence-fixture';
const NINETY_DAYS_AGO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

async function seedSoleEvidenceSlot(): Promise<mongoose.Types.ObjectId> {
  await ResearchEntity.create({
    slug: ENTITY_SLUG,
    name: 'Lossless Sole Evidence Lab',
    displayName: 'Lossless Sole Evidence Lab',
    entityType: 'LAB',
    kind: 'lab',
    school: 'Yale School of Medicine',
    archived: false,
  });
  const supersededSoleEvidence = await Observation.create({
    entityType: 'researchEntity',
    entityKey: ENTITY_SLUG,
    field: 'methods',
    value: ['cryo-electron microscopy'],
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'synthetic-lab-microsite',
    confidence: 0.8,
    observedAt: NINETY_DAYS_AGO,
    superseded: true,
  });
  await Observation.create({
    entityType: 'researchEntity',
    entityKey: ENTITY_SLUG,
    field: 'researchAreas',
    value: ['structural biology'],
    sourceId: new mongoose.Types.ObjectId(),
    sourceName: 'synthetic-lab-microsite',
    confidence: 0.8,
    observedAt: NINETY_DAYS_AGO,
    superseded: false,
  });
  return supersededSoleEvidence._id;
}

async function materializedMethods(): Promise<string[]> {
  const doc = await ResearchEntity.findOne({ slug: ENTITY_SLUG }).lean<{ methods?: string[] }>();
  return doc?.methods ?? [];
}

describe('superseded pruning under the lossless materializer read scope (#2944)', () => {
  let memoryReplSet: MongoMemoryReplSet | undefined;

  beforeAll(async () => {
    memoryReplSet = await MongoMemoryReplSet.create({
      binary: { version: '8.0.12' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(memoryReplSet.getUri('observation_retention_lossless_test'));
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryReplSet?.stop();
  });

  beforeEach(async () => {
    clearC4Flags();
    await Observation.deleteMany({});
    await ResearchEntity.deleteMany({});
  });

  afterEach(() => {
    clearC4Flags();
    vi.clearAllMocks();
  });

  it('projects a field whose only evidence is superseded once lossless ingest is on', async () => {
    await seedSoleEvidenceSlot();

    await materializeEntity('researchEntity', { entityKey: ENTITY_SLUG });
    expect(await materializedMethods()).toEqual([]);

    process.env.C4_LOSSLESS_INGEST = 'true';
    await materializeEntity('researchEntity', { entityKey: ENTITY_SLUG });

    expect(await materializedMethods()).toEqual(['cryo-electron microscopy']);
  });

  it('would lose that field if the prune selection were deleted under lossless ingest', async () => {
    const soleEvidenceId = await seedSoleEvidenceSlot();
    process.env.C4_LOSSLESS_INGEST = 'true';
    await materializeEntity('researchEntity', { entityKey: ENTITY_SLUG });
    expect(await materializedMethods()).toEqual(['cryo-electron microscopy']);

    await ResearchEntity.updateOne({ slug: ENTITY_SLUG }, { $unset: { fieldProvenance: '' } });
    const deletion = await Observation.deleteMany(
      buildSupersededObservationPruneFilter({ cutoff: new Date() }),
    );
    expect(deletion.deletedCount).toBe(1);
    expect(await Observation.findById(soleEvidenceId).lean()).toBeNull();

    await materializeEntity('researchEntity', { entityKey: ENTITY_SLUG });

    expect(await materializedMethods()).toEqual([]);
  });

  it('keeps the sole-evidence row and its projected field across an apply attempt', async () => {
    const soleEvidenceId = await seedSoleEvidenceSlot();
    process.env.C4_LOSSLESS_INGEST = 'true';
    await materializeEntity('researchEntity', { entityKey: ENTITY_SLUG });
    await ResearchEntity.updateOne({ slug: ENTITY_SLUG }, { $unset: { fieldProvenance: '' } });

    await pruneSupersededObservations({ olderThanDays: 30, keepRuns: 3, apply: true }).catch(
      () => undefined,
    );
    await materializeEntity('researchEntity', { entityKey: ENTITY_SLUG });

    expect(await materializedMethods()).toEqual(['cryo-electron microscopy']);
    expect(await Observation.findById(soleEvidenceId).lean()).not.toBeNull();
  });

  it('refuses the apply run with an error naming the flag that widened the read scope', async () => {
    await seedSoleEvidenceSlot();
    process.env.C4_LOSSLESS_INGEST = 'true';

    await expect(
      pruneSupersededObservations({ olderThanDays: 30, keepRuns: 3, apply: true }),
    ).rejects.toThrow(/C4_LOSSLESS_INGEST/);
  });

  it('reports the candidates as non-neutral rather than as dead storage in a dry run', async () => {
    await seedSoleEvidenceSlot();
    process.env.C4_LOSSLESS_INGEST = 'true';

    const dryRun = await pruneSupersededObservations({ olderThanDays: 30, keepRuns: 3 });

    expect(dryRun).toMatchObject({ projectionNeutral: false, candidates: 1, deleted: 0 });
  });

  it('still reclaims the same row when the materializer excludes superseded rows', async () => {
    const soleEvidenceId = await seedSoleEvidenceSlot();

    const applied = await pruneSupersededObservations({
      olderThanDays: 30,
      keepRuns: 3,
      apply: true,
    });

    expect(applied).toMatchObject({ projectionNeutral: true, candidates: 1, deleted: 1 });
    expect(await Observation.findById(soleEvidenceId).lean()).toBeNull();

    await materializeEntity('researchEntity', { entityKey: ENTITY_SLUG });
    expect(await materializedMethods()).toEqual([]);
  });
});
