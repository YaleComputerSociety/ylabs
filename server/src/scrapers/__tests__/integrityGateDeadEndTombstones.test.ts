import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const rows = vi.hoisted(() => ({ tombstones: [] as any[], extra: new Map<string, any>() }));

vi.mock('../../models/researchEntity', () => ({
  ResearchEntity: {
    find: () => ({ select: () => ({ lean: async () => rows.tombstones }) }),
    findOne: (filter: any) => ({
      select: () => ({ lean: async () => rows.extra.get(String(filter._id)) ?? null }),
    }),
  },
}));

import { loadDeadEndTombstoneChains } from '../integrityGate';

const oid = (n: number) => new mongoose.Types.ObjectId(String(n).padStart(24, '0'));
const tombstone = (id: number, slug: string, pointsTo?: number) => ({
  _id: oid(id),
  slug,
  archived: true,
  ...(pointsTo === undefined ? {} : { canonicalGroupId: oid(pointsTo) }),
});

describe('loadDeadEndTombstoneChains', () => {
  it('warns on a cycle', async () => {
    rows.tombstones = [tombstone(1, 'synthetic-a', 2), tombstone(2, 'synthetic-b', 1)];
    rows.extra = new Map();
    const warnings = await loadDeadEndTombstoneChains(5);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].name).toBe('deadEndTombstoneChains');
    expect(warnings[0].count).toBe(2);
    expect(warnings[0].message).toContain('cycle=2');
  });

  it('warns on a pointer at a row that is not there', async () => {
    rows.tombstones = [tombstone(1, 'synthetic-a', 99)];
    rows.extra = new Map();
    const warnings = await loadDeadEndTombstoneChains(5);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].count).toBe(1);
    expect(warnings[0].message).toContain('absent_target=1');
  });

  // The property 40 real rows depend on. A chain that ends on an archived row is
  // well-formed data saying the subject has no live home, so warning on it would put 40
  // correct rows in a warning that fires forever.
  it('stays silent on a chain that ends on an archived row', async () => {
    rows.tombstones = [tombstone(1, 'synthetic-a', 2), tombstone(2, 'synthetic-b')];
    rows.extra = new Map();
    expect(await loadDeadEndTombstoneChains(5)).toEqual([]);
  });

  it('stays silent when every chain reaches a live canonical', async () => {
    rows.tombstones = [tombstone(1, 'synthetic-a', 3)];
    rows.extra = new Map([[String(oid(3)), { _id: oid(3), archived: false }]]);
    expect(await loadDeadEndTombstoneChains(5)).toEqual([]);
  });

  it('reports nothing when there are no tombstones at all', async () => {
    rows.tombstones = [];
    rows.extra = new Map();
    expect(await loadDeadEndTombstoneChains(5)).toEqual([]);
  });
});
