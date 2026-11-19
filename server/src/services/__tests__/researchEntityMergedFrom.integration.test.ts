import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import {
  applyMergedFromPlan,
  loadMergedFromNodes,
  planMergedFromDerivation,
} from '../researchEntityMergedFrom';

describe('survivors carry the rows merged into them as mergedFrom (#5148)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db?.collection('research_entities').deleteMany({});
  });

  const entity = (slug: string, overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({ slug, name: `Synthetic ${slug}`, archived: false, ...overrides });

  const merged = (slug: string, survivor: mongoose.Types.ObjectId, at: string) =>
    entity(slug, {
      archived: true,
      canonicalGroupId: survivor,
      archivedAt: new Date(at),
      archivedReason: 'synthetic:merge',
    });

  const derive = async () => {
    const plan = planMergedFromDerivation(await loadMergedFromNodes());
    return { plan, applied: await applyMergedFromPlan(plan) };
  };

  const stored = async (id: unknown) =>
    (await ResearchEntity.findById(id).lean()) as Record<string, any> | null;

  it('records every merged row on its survivor, flattening a chain onto the final survivor', async () => {
    const survivor = await entity('synthetic-survivor');
    const middle = await merged('synthetic-middle', survivor._id, '2026-09-01T00:00:00Z');
    const loser = await merged('synthetic-loser', middle._id, '2026-08-01T00:00:00Z');

    const { plan, applied } = await derive();

    expect(plan).toMatchObject({ tombstones: 2, unresolvedTombstones: 0, mergedEntries: 2 });
    expect(applied).toEqual({ written: 1, cleared: 0 });
    const row = await stored(survivor._id);
    expect(
      row?.mergedFrom.map((entry: any) => [
        entry.slug,
        String(entry.entityId),
        entry.archivedReason,
      ]),
    ).toEqual([
      ['synthetic-loser', String(loser._id), 'synthetic:merge'],
      ['synthetic-middle', String(middle._id), 'synthetic:merge'],
    ]);
    expect(row?.mergedFrom[1].mergedAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('writes nothing on a second run, and does not touch updatedAt', async () => {
    const survivor = await entity('synthetic-survivor');
    await merged('synthetic-loser', survivor._id, '2026-08-01T00:00:00Z');
    const before = (await stored(survivor._id))?.updatedAt;

    await derive();
    const rerun = await derive();

    expect(rerun.plan.writes).toEqual([]);
    expect(rerun.plan.clears).toEqual([]);
    expect((await stored(survivor._id))?.updatedAt).toEqual(before);
  });

  it('removes an entry whose merge was withdrawn, and clears a survivor left with none', async () => {
    const survivor = await entity('synthetic-survivor');
    const kept = await merged('synthetic-kept', survivor._id, '2026-08-01T00:00:00Z');
    const withdrawn = await merged('synthetic-withdrawn', survivor._id, '2026-08-02T00:00:00Z');
    const lone = await entity('synthetic-lone-survivor');
    const loneLoser = await merged('synthetic-lone-loser', lone._id, '2026-08-03T00:00:00Z');
    await derive();

    await ResearchEntity.updateOne({ _id: withdrawn._id }, { $set: { canonicalGroupId: null } });
    await ResearchEntity.deleteOne({ _id: loneLoser._id });
    const { applied } = await derive();

    expect(applied).toEqual({ written: 1, cleared: 1 });
    expect(
      (await stored(survivor._id))?.mergedFrom.map((entry: any) => String(entry.entityId)),
    ).toEqual([String(kept._id)]);
    expect((await stored(lone._id))?.mergedFrom).toBeUndefined();
  });

  it('credits nobody for a chain that cycles or ends on an archived row', async () => {
    const archivedEnd = await entity('synthetic-archived-end', { archived: true });
    await merged('synthetic-dead-end', archivedEnd._id, '2026-08-01T00:00:00Z');
    const cycleA = new mongoose.Types.ObjectId();
    const cycleB = await merged('synthetic-cycle-b', cycleA, '2026-08-01T00:00:00Z');
    await entity('synthetic-cycle-a', {
      _id: cycleA,
      archived: true,
      canonicalGroupId: cycleB._id,
    });

    const { plan, applied } = await derive();

    expect(plan).toMatchObject({ tombstones: 3, unresolvedTombstones: 3, mergedEntries: 0 });
    expect(applied).toEqual({ written: 0, cleared: 0 });
  });

  it('moves the entries when a survivor is itself merged later', async () => {
    const first = await entity('synthetic-first-survivor');
    const loser = await merged('synthetic-loser', first._id, '2026-08-01T00:00:00Z');
    await derive();

    const final = await entity('synthetic-final-survivor');
    await ResearchEntity.updateOne(
      { _id: first._id },
      { $set: { archived: true, canonicalGroupId: final._id, archivedReason: 'synthetic:merge' } },
    );
    await derive();

    expect((await stored(first._id))?.mergedFrom).toBeUndefined();
    expect(
      (await stored(final._id))?.mergedFrom.map((entry: any) => String(entry.entityId)).sort(),
    ).toEqual([String(first._id), String(loser._id)].sort());
  });
});
