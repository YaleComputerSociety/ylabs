import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { checkReferenceEdge } from '../researchModelInventory';
import { REFERENCE_EDGES } from '../researchModelInventoryCore';

function asyncCursor(rows: Record<string, unknown>[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const row of rows) {
        yield row;
      }
    },
  };
}

describe('checkReferenceEdge', () => {
  const edge = REFERENCE_EDGES.find((candidate) => candidate.name === 'member_to_entity');

  if (!edge) {
    throw new Error('member_to_entity edge is required');
  }

  it('skips an edge when its source collection is missing', async () => {
    const db = {
      collection() {
        throw new Error('missing source must not be queried');
      },
    } as unknown as Db;

    await expect(checkReferenceEdge(db, edge, new Set(), 20)).resolves.toMatchObject({
      status: 'source-missing',
      checked: 0,
      orphaned: 0,
      sampleOrphanIds: [],
    });
  });

  it('counts every non-null reference as orphaned when the target is missing', async () => {
    const db = {
      collection(name: string) {
        if (name !== edge.fromCollection) {
          throw new Error(`unexpected collection: ${name}`);
        }
        return {
          find() {
            return asyncCursor([
              { _id: 'member-1', researchEntityId: 'entity-1' },
              { _id: 'member-2', researchEntityId: null },
              { _id: 'member-3', researchEntityId: 'entity-3' },
            ]);
          },
        };
      },
    } as unknown as Db;

    await expect(
      checkReferenceEdge(db, edge, new Set([edge.fromCollection]), 1),
    ).resolves.toMatchObject({
      status: 'target-missing',
      checked: 2,
      orphaned: 2,
      sampleOrphanIds: ['member-1'],
    });
  });
});
