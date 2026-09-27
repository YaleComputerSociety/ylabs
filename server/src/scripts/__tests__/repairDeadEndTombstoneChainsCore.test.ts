import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import type { ResearchEntityTombstoneNode } from '../../services/researchEntityCanonicalTombstone';
import {
  buildDeadEndTombstoneRepairPlan,
  malformedPointerEntityIds,
} from '../repairDeadEndTombstoneChainsCore';

const oid = (n: number) => new mongoose.Types.ObjectId(String(n).padStart(24, '0'));

const node = (
  id: number,
  archived: boolean,
  pointsTo?: number,
  slug?: string,
): ResearchEntityTombstoneNode & { slug?: string } => ({
  _id: oid(id),
  archived,
  ...(slug === undefined ? {} : { slug }),
  ...(pointsTo === undefined ? {} : { canonicalGroupId: oid(pointsTo) }),
});

const index = (nodes: ResearchEntityTombstoneNode[]) => {
  const map = new Map(nodes.map((entry) => [String(entry._id), entry]));
  return (id: string) => map.get(id);
};

describe('buildDeadEndTombstoneRepairPlan', () => {
  it('clears only a malformed pointer and keeps a well-formed dead end', async () => {
    const resolves = node(1, true, 10, 'a');
    const cyclic = node(2, true, 11, 'b');
    const dangling = node(3, true, 99, 'c');
    const terminal = node(4, true, 12, 'd');
    const summary = await buildDeadEndTombstoneRepairPlan({
      tombstones: [resolves, cyclic, dangling, terminal],
      nodeById: index([
        resolves,
        cyclic,
        dangling,
        terminal,
        node(10, false),
        node(11, true, 2),
        node(12, true),
      ]),
    });

    expect(summary.scanned).toBe(4);
    expect(summary.byVerdict).toEqual({
      clear_malformed_pointer: 2,
      keep_subject_has_no_live_home: 1,
      keep_resolves: 1,
    });
    expect(summary.byTerminalCause).toEqual({
      cycle: 1,
      absent_target: 1,
      archived_terminal: 1,
    });
    expect(malformedPointerEntityIds(summary)).toEqual([String(oid(2)), String(oid(3))]);
  });

  it('treats an over-long chain as malformed rather than a well-formed dead end', async () => {
    const chain = Array.from({ length: 30 }, (_, i) => node(i + 1, true, i + 2));
    const summary = await buildDeadEndTombstoneRepairPlan({
      tombstones: [chain[0]],
      nodeById: index(chain),
    });
    expect(summary.byTerminalCause.cycle).toBe(1);
    expect(summary.plans[0].verdict).toBe('clear_malformed_pointer');
  });

  it('never proposes a destination, only a clear', async () => {
    const dangling = node(3, true, 99, 'c');
    const summary = await buildDeadEndTombstoneRepairPlan({
      tombstones: [dangling],
      nodeById: index([dangling]),
    });
    const plan = summary.plans[0];
    expect(plan.verdict).toBe('clear_malformed_pointer');
    expect(Object.keys(plan)).not.toContain('replacementCanonicalId');
  });

  it('accounts for every scanned tombstone in exactly one verdict', async () => {
    const resolves = node(1, true, 10, 'a');
    const terminal = node(2, true, 12, 'b');
    const summary = await buildDeadEndTombstoneRepairPlan({
      tombstones: [resolves, terminal],
      nodeById: index([resolves, terminal, node(10, false), node(12, true)]),
    });
    const total = Object.values(summary.byVerdict).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(summary.scanned);
  });
});
