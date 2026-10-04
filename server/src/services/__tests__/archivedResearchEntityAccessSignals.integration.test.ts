import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { Signal } from '../../models/signal';
import { materializeAccessForResearchGroup } from '../../scrapers/accessMaterializer';
import { runPostMaterializationIntegrityGate } from '../../scrapers/integrityGate';
import {
  planAccessSignalSettlements,
  settleAccessSignalsOfArchivedResearchEntities,
} from '../archivedResearchEntityAccessSignals';
import { archiveResearchEntities } from '../archivedResearchEntityRoleEdges';

describe('archiving a research entity settles its live access signals (#4816)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    await Signal.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'role_assignments', 'signals', 'observations']) {
      await db.collection(name).deleteMany({});
    }
  });

  const entity = async (slug: string, overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({ slug, name: `Synthetic ${slug}`, archived: false, ...overrides });

  const signal = async (
    researchEntityId: mongoose.Types.ObjectId,
    type: 'CURRENT_UNDERGRADS' | 'APPLICATION_FORM_EXISTS',
    overrides: Record<string, unknown> = {},
  ) =>
    Signal.create({
      researchEntityId,
      type,
      derivationKey: `signal:${type}`,
      confidence: 'MEDIUM',
      observedAt: new Date('2026-09-01T00:00:00Z'),
      archived: false,
      ...overrides,
    });

  const stored = async (id: unknown) =>
    Signal.findById(id).lean<{
      researchEntityId: mongoose.Types.ObjectId;
      archived: boolean;
      archivedReason?: string;
      archivedAt?: Date;
      source?: { evidenceIds?: mongoose.Types.ObjectId[] };
    }>();

  const liveSignalsOn = async (researchEntityId: mongoose.Types.ObjectId) =>
    Signal.countDocuments({ researchEntityId, archived: { $ne: true } });

  const gateCounts = async () =>
    (await runPostMaterializationIntegrityGate({ includeSamples: false })).counts;

  it('archives every live signal of a row retired with no survivor, under the row reason', async () => {
    const retired = await entity('synthetic-retired-row');
    const undergrads = await signal(retired._id, 'CURRENT_UNDERGRADS');
    const joinPage = await signal(retired._id, 'APPLICATION_FORM_EXISTS');
    const now = new Date('2026-10-04T12:00:00Z');

    const result = await archiveResearchEntities({
      ids: [retired._id],
      archivedReason: 'synthetic:retire',
      now,
    });

    expect(result.accessSignals).toEqual({
      relinked: 0,
      mergedIntoSurvivor: 0,
      archivedAsDuplicate: 0,
      archivedWithoutSurvivor: 2,
      refusedSurvivorNotLive: 0,
    });
    for (const id of [undergrads._id, joinPage._id]) {
      const archived = await stored(id);
      expect(archived).toMatchObject({ archived: true, archivedReason: 'synthetic:retire' });
      expect(archived?.archivedAt?.toISOString()).toBe(now.toISOString());
      expect(String(archived?.researchEntityId)).toBe(String(retired._id));
    }
    expect(await liveSignalsOn(retired._id)).toBe(0);
    expect((await gateCounts()).activeArtifactsOnArchivedEntities).toBe(0);
  });

  it('merges into the survivor signal it duplicates and relinks the rest on a fold', async () => {
    const survivor = await entity('synthetic-survivor-lab');
    const shell = await entity('dept-synthetic-shell');
    const shellEvidence = new mongoose.Types.ObjectId();
    const survivorEvidence = new mongoose.Types.ObjectId();
    const survivorUndergrads = await signal(survivor._id, 'CURRENT_UNDERGRADS', {
      source: { evidenceIds: [survivorEvidence] },
    });
    const shellUndergrads = await signal(shell._id, 'CURRENT_UNDERGRADS', {
      source: { evidenceIds: [shellEvidence] },
    });
    const shellJoinPage = await signal(shell._id, 'APPLICATION_FORM_EXISTS');

    const result = await archiveResearchEntities({
      ids: [shell._id],
      archivedReason: 'synthetic:fold',
      set: { canonicalGroupId: survivor._id },
      survivorId: survivor._id,
    });

    expect(result.accessSignals).toEqual({
      relinked: 1,
      mergedIntoSurvivor: 1,
      archivedAsDuplicate: 1,
      archivedWithoutSurvivor: 0,
      refusedSurvivorNotLive: 0,
    });
    expect(await stored(shellUndergrads._id)).toMatchObject({
      archived: true,
      archivedReason: 'synthetic:fold',
    });
    const merged = await stored(survivorUndergrads._id);
    expect(merged?.archived).toBe(false);
    expect((merged?.source?.evidenceIds || []).map(String).sort()).toEqual(
      [String(survivorEvidence), String(shellEvidence)].sort(),
    );
    expect(String((await stored(shellJoinPage._id))?.researchEntityId)).toBe(String(survivor._id));
    expect(await liveSignalsOn(shell._id)).toBe(0);
    const counts = await gateCounts();
    expect(counts.activeArtifactsOnArchivedEntities).toBe(0);
    expect(counts.duplicateAccessSignals).toBe(0);
  });

  it('never hands the survivor the same derivation from two archived rows', async () => {
    const survivor = await entity('synthetic-survivor-lab');
    const first = await entity('dept-synthetic-first');
    const second = await entity('dept-synthetic-second');
    const firstSignal = await signal(first._id, 'CURRENT_UNDERGRADS');
    const secondSignal = await signal(second._id, 'CURRENT_UNDERGRADS');

    const result = await archiveResearchEntities({
      ids: [first._id, second._id],
      archivedReason: 'synthetic:fold',
      survivorId: survivor._id,
    });

    expect(result.accessSignals).toMatchObject({ relinked: 1, archivedAsDuplicate: 1 });
    expect(String((await stored(firstSignal._id))?.researchEntityId)).toBe(String(survivor._id));
    expect(await stored(secondSignal._id)).toMatchObject({ archived: true });
    expect((await gateCounts()).duplicateAccessSignals).toBe(0);
  });

  it('archives a signal as a duplicate when the survivor holds the derivation archived', async () => {
    const survivor = await entity('synthetic-survivor-lab');
    const shell = await entity('dept-synthetic-shell');
    await signal(survivor._id, 'CURRENT_UNDERGRADS', {
      archived: true,
      archivedReason: 'synthetic:earlier',
    });
    const shellSignal = await signal(shell._id, 'CURRENT_UNDERGRADS');

    const result = await archiveResearchEntities({
      ids: [shell._id],
      archivedReason: 'synthetic:fold',
      survivorId: survivor._id,
    });

    expect(result.accessSignals).toMatchObject({ relinked: 0, archivedAsDuplicate: 1 });
    expect(await stored(shellSignal._id)).toMatchObject({ archived: true });
    expect(String((await stored(shellSignal._id))?.researchEntityId)).toBe(String(shell._id));
  });

  it('refuses a survivor that is not live and leaves the signals for the gate to count', async () => {
    const survivor = await entity('synthetic-archived-survivor', {
      archived: true,
      archivedReason: 'synthetic:earlier',
    });
    const shell = await entity('dept-synthetic-shell');
    const shellSignal = await signal(shell._id, 'CURRENT_UNDERGRADS');

    const result = await archiveResearchEntities({
      ids: [shell._id],
      archivedReason: 'synthetic:fold',
      survivorId: survivor._id,
    });

    expect(result.accessSignals).toMatchObject({ refusedSurvivorNotLive: 1, relinked: 0 });
    expect(await stored(shellSignal._id)).toMatchObject({ archived: false });
    expect((await gateCounts()).activeArtifactsOnArchivedEntities).toBe(1);
  });

  it('touches no signal of a row that is still live', async () => {
    const live = await entity('synthetic-live-row');
    const liveSignal = await signal(live._id, 'CURRENT_UNDERGRADS');

    const outcome = await settleAccessSignalsOfArchivedResearchEntities({
      archivedEntityIds: [live._id],
      archivedReason: 'synthetic:retire',
    });

    expect(outcome).toMatchObject({ relinked: 0, archivedWithoutSurvivor: 0 });
    expect(await stored(liveSignal._id)).toMatchObject({ archived: false });
  });

  it('derives no signal onto the archived row on the next access pass', async () => {
    const retired = await entity('synthetic-retired-row');
    await Observation.create({
      entityType: 'researchEntity',
      entityId: retired._id,
      entityKey: retired.slug,
      field: 'currentUndergradCount',
      value: 2,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'synthetic-roster-lane',
      sourceUrl: 'https://syntheticlab.example.org/people',
      confidence: 0.8,
      observedAt: new Date('2026-09-01T00:00:00Z'),
      superseded: false,
    });
    await archiveResearchEntities({ ids: [retired._id], archivedReason: 'synthetic:retire' });

    const result = await materializeAccessForResearchGroup({
      researchEntityId: String(retired._id),
      entityKey: retired.slug,
    });

    expect(result.skipped).toBe('archived-research-entity');
    expect(await liveSignalsOn(retired._id)).toBe(0);
    expect((await gateCounts()).activeArtifactsOnArchivedEntities).toBe(0);
  });
});

describe('planAccessSignalSettlements', () => {
  it('plans in input order with the repair outcomes', () => {
    const plan = planAccessSignalSettlements({
      signals: [
        {
          id: 's1',
          archivedEntityId: 'shell',
          signalType: 'CURRENT_UNDERGRADS',
          derivationKey: 'k',
        },
        {
          id: 's2',
          archivedEntityId: 'shell',
          signalType: 'APPLICATION_FORM_EXISTS',
          derivationKey: 'k',
        },
        {
          id: 's3',
          archivedEntityId: 'retired',
          signalType: 'CURRENT_UNDERGRADS',
          derivationKey: 'k',
        },
      ],
      survivorIdFor: (id) => (id === 'shell' ? 'survivor' : undefined),
      survivorSignals: [
        { id: 'v1', survivorId: 'survivor', signalType: 'CURRENT_UNDERGRADS', derivationKey: 'k' },
      ],
    });

    expect(plan).toEqual([
      {
        action: 'merge-and-archive',
        signalId: 's1',
        archivedEntityId: 'shell',
        survivorId: 'survivor',
        survivorSignalId: 'v1',
      },
      { action: 'relink', signalId: 's2', archivedEntityId: 'shell', survivorId: 'survivor' },
      { action: 'archive', signalId: 's3', archivedEntityId: 'retired' },
    ]);
  });
});
