import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import {
  checkReferenceEdge,
  gatherInventoryFacts,
  runResearchModelInventory,
} from '../researchModelInventory';
import { REFERENCE_EDGES, RETIREMENT_FIELD_PROBES } from '../researchModelInventoryCore';

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
  const requiredEdge = REFERENCE_EDGES.find(
    (candidate) => candidate.name === 'entry_pathway_to_entity',
  );

  if (!edge || !requiredEdge) {
    throw new Error('reference edge fixtures are required');
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

  it('reports missing required local references as integrity failures', async () => {
    let sourceFilter: Record<string, unknown> | undefined;
    const db = {
      collection(name: string) {
        if (name === requiredEdge.toCollection) {
          return {
            find() {
              return asyncCursor([{ _id: 'entity-1' }]);
            },
          };
        }
        if (name === requiredEdge.fromCollection) {
          return {
            find(query: Record<string, unknown>) {
              sourceFilter = query;
              return asyncCursor([
                { _id: 'pathway-1' },
                { _id: 'pathway-2', researchEntityId: null },
                { _id: 'pathway-3', researchEntityId: 'entity-1' },
              ]);
            },
          };
        }
        throw new Error(`unexpected collection: ${name}`);
      },
    } as unknown as Db;

    await expect(
      checkReferenceEdge(
        db,
        requiredEdge,
        new Set([requiredEdge.fromCollection, requiredEdge.toCollection]),
        20,
      ),
    ).resolves.toMatchObject({
      status: 'checked',
      checked: 3,
      orphaned: 2,
      sampleOrphanIds: ['pathway-1', 'pathway-2'],
    });
    expect(sourceFilter).toEqual({});
  });
});

describe('gatherInventoryFacts', () => {
  it('reuses census totals and bounds concurrent field scans', async () => {
    const liveCollections = [...new Set(RETIREMENT_FIELD_PROBES.map((probe) => probe.collection))];
    const totalCountCalls = new Map<string, number>();
    let activeFieldScans = 0;
    let peakFieldScans = 0;

    const db = {
      listCollections() {
        return {
          async toArray() {
            return liveCollections.map((name) => ({ name }));
          },
        };
      },
      collection(name: string) {
        return {
          async countDocuments(query: Record<string, unknown>) {
            if (Object.keys(query).length === 0) {
              totalCountCalls.set(name, (totalCountCalls.get(name) ?? 0) + 1);
              return 12;
            }
            activeFieldScans += 1;
            peakFieldScans = Math.max(peakFieldScans, activeFieldScans);
            await new Promise((resolve) => setTimeout(resolve, 1));
            activeFieldScans -= 1;
            return 3;
          },
          aggregate() {
            return {
              async toArray() {
                return [];
              },
            };
          },
          find() {
            return asyncCursor([]);
          },
        };
      },
    } as unknown as Db;

    const facts = await gatherInventoryFacts(db, {
      environment: 'test',
      sampleLimit: 1,
    });

    expect(facts.fieldPresence).toHaveLength(RETIREMENT_FIELD_PROBES.length);
    expect(peakFieldScans).toBeGreaterThan(1);
    expect(peakFieldScans).toBeLessThanOrEqual(4);
    for (const collection of liveCollections) {
      expect(totalCountCalls.get(collection)).toBe(1);
    }
  });
});

describe('runResearchModelInventory', () => {
  it('uses the supplied native client and closes it after gathering', async () => {
    const db = {
      databaseName: 'inventory-test',
      listCollections() {
        return {
          async toArray() {
            return [];
          },
        };
      },
      collection() {
        throw new Error('absent collections must not be queried');
      },
    } as unknown as Db;
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      db: vi.fn(() => db),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const output = await runResearchModelInventory(
      { environment: 'test', sampleLimit: 1 },
      'mongodb://localhost:27017/inventory-test',
      client,
    );

    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.db).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
    expect(output.db).toBe('inventory-test');
  });

  it('closes the native client when gathering fails', async () => {
    const db = {
      databaseName: 'inventory-test',
      listCollections() {
        return {
          async toArray() {
            throw new Error('inventory failed');
          },
        };
      },
    } as unknown as Db;
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      db: vi.fn(() => db),
      close: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      runResearchModelInventory(
        { environment: 'test', sampleLimit: 1 },
        'mongodb://localhost:27017/inventory-test',
        client,
      ),
    ).rejects.toThrow('inventory failed');
    expect(client.close).toHaveBeenCalledOnce();
  });
});
