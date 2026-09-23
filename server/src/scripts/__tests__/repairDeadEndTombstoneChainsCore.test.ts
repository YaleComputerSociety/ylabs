import { describe, expect, it } from 'vitest';
import {
  buildDeadEndTombstoneRepairPlan,
  malformedPointerEntityIds,
  walkTombstoneChain,
  type TombstoneChainNode,
} from '../repairDeadEndTombstoneChainsCore';

const index = (nodes: TombstoneChainNode[]) => {
  const map = new Map(nodes.map((node) => [node.id, node]));
  return (id: string) => map.get(id);
};

describe('walkTombstoneChain', () => {
  it('resolves through an archived intermediate to the live canonical', () => {
    const result = walkTombstoneChain(
      { id: 'shell', archived: true, canonicalGroupId: 'mid' },
      index([
        { id: 'mid', archived: true, canonicalGroupId: 'live' },
        { id: 'live', archived: false },
      ]),
    );
    expect(result.resolvedCanonicalId).toBe('live');
    expect(result.hops).toBe(2);
    expect(result.terminalCause).toBeUndefined();
  });

  it('names a cycle rather than looping', () => {
    const result = walkTombstoneChain(
      { id: 'a', archived: true, canonicalGroupId: 'b' },
      index([
        { id: 'b', archived: true, canonicalGroupId: 'a' },
        { id: 'a', archived: true, canonicalGroupId: 'b' },
      ]),
    );
    expect(result.resolvedCanonicalId).toBeUndefined();
    expect(result.terminalCause).toBe('cycle');
  });

  it('names an absent target', () => {
    const result = walkTombstoneChain(
      { id: 'shell', archived: true, canonicalGroupId: 'gone' },
      index([]),
    );
    expect(result.terminalCause).toBe('absent_target');
  });

  it('names an archived terminal, which is well-formed data', () => {
    const result = walkTombstoneChain(
      { id: 'shell', archived: true, canonicalGroupId: 'end' },
      index([{ id: 'end', archived: true }]),
    );
    expect(result.terminalCause).toBe('archived_terminal');
  });

  it('treats an over-long chain as a cycle rather than reporting a resolution', () => {
    const nodes: TombstoneChainNode[] = [];
    for (let i = 0; i < 30; i += 1) {
      nodes.push({ id: `n${i}`, archived: true, canonicalGroupId: `n${i + 1}` });
    }
    const result = walkTombstoneChain(
      { id: 'start', archived: true, canonicalGroupId: 'n0' },
      index(nodes),
    );
    expect(result.resolvedCanonicalId).toBeUndefined();
    expect(result.terminalCause).toBe('cycle');
  });
});

describe('buildDeadEndTombstoneRepairPlan', () => {
  it('clears only a malformed pointer and keeps a well-formed dead end', () => {
    const summary = buildDeadEndTombstoneRepairPlan({
      tombstones: [
        { id: 'resolves', slug: 'a', canonicalGroupId: 'live' },
        { id: 'cyclic', slug: 'b', canonicalGroupId: 'cyclic-peer' },
        { id: 'dangling', slug: 'c', canonicalGroupId: 'gone' },
        { id: 'terminal', slug: 'd', canonicalGroupId: 'archived-end' },
      ],
      nodeById: index([
        { id: 'live', archived: false },
        { id: 'cyclic-peer', archived: true, canonicalGroupId: 'cyclic' },
        { id: 'cyclic', archived: true, canonicalGroupId: 'cyclic-peer' },
        { id: 'archived-end', archived: true },
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
    expect(malformedPointerEntityIds(summary)).toEqual(['cyclic', 'dangling']);
  });

  it('never proposes a destination, only a clear', () => {
    const summary = buildDeadEndTombstoneRepairPlan({
      tombstones: [{ id: 'dangling', slug: 'c', canonicalGroupId: 'gone' }],
      nodeById: index([]),
    });
    const plan = summary.plans[0];
    expect(plan.verdict).toBe('clear_malformed_pointer');
    expect(Object.keys(plan)).not.toContain('replacementCanonicalId');
  });

  it('accounts for every scanned tombstone in exactly one verdict', () => {
    const summary = buildDeadEndTombstoneRepairPlan({
      tombstones: [
        { id: 'r', slug: 'a', canonicalGroupId: 'live' },
        { id: 't', slug: 'b', canonicalGroupId: 'archived-end' },
      ],
      nodeById: index([
        { id: 'live', archived: false },
        { id: 'archived-end', archived: true },
      ]),
    });
    const total = Object.values(summary.byVerdict).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(summary.scanned);
  });
});
