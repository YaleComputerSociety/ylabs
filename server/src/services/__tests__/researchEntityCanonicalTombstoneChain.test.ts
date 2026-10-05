import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  MAX_RESEARCH_ENTITY_TOMBSTONE_HOPS,
  tombstoneTerminalCauseIsMalformed,
  walkResearchEntityTombstoneChainWithCause,
  type ResearchEntityTombstoneNode,
} from '../researchEntityCanonicalTombstone';

const oid = (n: number) =>
  new mongoose.Types.ObjectId(String(n).padStart(24, '0')) as unknown as mongoose.Types.ObjectId;

const node = (id: number, archived: boolean, pointsTo?: number): ResearchEntityTombstoneNode =>
  ({
    _id: oid(id),
    archived,
    ...(pointsTo === undefined ? {} : { canonicalGroupId: oid(pointsTo) }),
  }) as ResearchEntityTombstoneNode;

const finderFor = (nodes: ResearchEntityTombstoneNode[]) => {
  const byId = new Map(nodes.map((n) => [String(n._id), n]));
  return async (id: string) => byId.get(id) ?? null;
};

// These four outcomes used to be distinguished only inside a repair script's own sync copy
// of this walk; the production walker returned a bare null for all of them (#3704).
describe('walkResearchEntityTombstoneChainWithCause', () => {
  it('resolves through an archived intermediate to the live canonical', async () => {
    const start = node(1, true, 2);
    const result = await walkResearchEntityTombstoneChainWithCause(start, {
      findById: finderFor([start, node(2, true, 3), node(3, false)]),
    });
    expect(String(result.canonical?._id)).toBe(String(oid(3)));
    expect(result.terminalCause).toBeUndefined();
  });

  it('names a cycle rather than looping', async () => {
    const start = node(1, true, 2);
    const result = await walkResearchEntityTombstoneChainWithCause(start, {
      findById: finderFor([start, node(2, true, 1)]),
    });
    expect(result.canonical).toBeNull();
    expect(result.terminalCause).toBe('cycle');
  });

  it('names an absent target', async () => {
    const start = node(1, true, 99);
    const result = await walkResearchEntityTombstoneChainWithCause(start, {
      findById: finderFor([start]),
    });
    expect(result.canonical).toBeNull();
    expect(result.terminalCause).toBe('absent_target');
  });

  it('names an archived terminal, which is well-formed data rather than a defect', async () => {
    const start = node(1, true, 2);
    const result = await walkResearchEntityTombstoneChainWithCause(start, {
      findById: finderFor([start, node(2, true)]),
    });
    expect(result.canonical).toBeNull();
    expect(result.terminalCause).toBe('archived_terminal');
    expect(tombstoneTerminalCauseIsMalformed(result.terminalCause)).toBe(false);
  });

  it('calls an over-long chain a cycle rather than reporting a well-formed terminal', async () => {
    const chain = Array.from({ length: MAX_RESEARCH_ENTITY_TOMBSTONE_HOPS + 3 }, (_, index) =>
      node(index + 1, true, index + 2),
    );
    const result = await walkResearchEntityTombstoneChainWithCause(chain[0], {
      findById: finderFor(chain),
    });
    expect(result.canonical).toBeNull();
    expect(result.terminalCause).toBe('cycle');
  });

  it('separates a malformed pointer from a truthful dead end', () => {
    expect(tombstoneTerminalCauseIsMalformed('cycle')).toBe(true);
    expect(tombstoneTerminalCauseIsMalformed('absent_target')).toBe(true);
    expect(tombstoneTerminalCauseIsMalformed('archived_terminal')).toBe(false);
    expect(tombstoneTerminalCauseIsMalformed(undefined)).toBe(false);
  });
});
