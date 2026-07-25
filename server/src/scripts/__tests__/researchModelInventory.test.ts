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

  it('keeps a missing target explicit when an optional edge has no references', async () => {
    const db = {
      collection(name: string) {
        if (name !== edge.fromCollection) {
          throw new Error(`unexpected collection: ${name}`);
        }
        return {
          find() {
            return asyncCursor([{ _id: 'member-1', researchEntityId: null }]);
          },
        };
      },
    } as unknown as Db;

    await expect(
      checkReferenceEdge(db, edge, new Set([edge.fromCollection]), 20),
    ).resolves.toMatchObject({
      status: 'target-missing',
      checked: 0,
      orphaned: 0,
      sampleOrphanIds: [],
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
  it('preserves BSON types and distinguishes missing schema versions from null', async () => {
    const aggregatePipelines: unknown[] = [];
    const db = {
      listCollections() {
        return {
          async toArray() {
            return [{ name: 'research_entities' }];
          },
        };
      },
      collection(name: string) {
        if (name !== 'research_entities') {
          throw new Error(`unexpected collection: ${name}`);
        }
        return {
          async countDocuments(query: Record<string, unknown>) {
            return Object.keys(query).length === 0 ? 4 : 0;
          },
          aggregate(pipeline: unknown) {
            aggregatePipelines.push(pipeline);
            const group = (pipeline as Array<{ $group?: { _id: unknown } }>)[0]?.$group;
            return {
              async toArray() {
                if (group?._id === null) {
                  return [{ _id: null }];
                }
                return [
                  { _id: { bsonType: 'int', value: 1 }, count: 1 },
                  { _id: { bsonType: 'string', value: '1' }, count: 1 },
                  { _id: { bsonType: 'null', value: null }, count: 1 },
                  { _id: { bsonType: 'missing' }, count: 1 },
                ];
              },
            };
          },
        };
      },
    } as unknown as Db;

    const facts = await gatherInventoryFacts(db, {
      environment: 'test',
      sampleLimit: 1,
    });

    expect(aggregatePipelines).toContainEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $group: expect.objectContaining({
            _id: {
              bsonType: { $type: '$schemaVersion' },
              value: '$schemaVersion',
            },
          }),
        }),
      ]),
    );
    expect(
      facts.census.find((fact) => fact.collection === 'research_entities')?.schemaVersions,
    ).toEqual([
      { bsonType: 'int', value: 1, count: 1 },
      { bsonType: 'string', value: '1', count: 1 },
      { bsonType: 'null', value: null, count: 1 },
      { bsonType: 'missing', count: 1 },
    ]);
  });

  it('reuses census totals and aggregates all field probes once per collection', async () => {
    const liveCollections = [...new Set(RETIREMENT_FIELD_PROBES.map((probe) => probe.collection))];
    const totalCountCalls = new Map<string, number>();
    const fieldAggregationCalls = new Map<string, number>();
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
            throw new Error('field probes must not use countDocuments');
          },
          aggregate(pipeline: Array<{ $group?: Record<string, unknown> }>) {
            const group = pipeline[0]?.$group;
            const isFieldAggregation = group?._id === null;
            return {
              async toArray() {
                if (!isFieldAggregation) return [];
                fieldAggregationCalls.set(name, (fieldAggregationCalls.get(name) ?? 0) + 1);
                activeFieldScans += 1;
                peakFieldScans = Math.max(peakFieldScans, activeFieldScans);
                await new Promise((resolve) => setTimeout(resolve, 1));
                activeFieldScans -= 1;
                return [
                  Object.fromEntries(
                    Object.keys(group)
                      .filter((key) => key !== '_id')
                      .map((key) => [key, 3]),
                  ),
                ];
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
      expect(fieldAggregationCalls.get(collection)).toBe(1);
    }
    expect(facts.fieldPresence.every((fact) => fact.present === 3 && fact.total === 12)).toBe(true);
  });

  it('scans sources before streaming each referenced target collection once', async () => {
    const liveCollections = [
      ...new Set(REFERENCE_EDGES.flatMap((edge) => [edge.fromCollection, edge.toCollection])),
    ];
    const targetScans = new Map<string, number>();
    const sourceScans = new Map<string, number>();
    let sourceScansComplete = false;
    const expectedSourceScans = new Set(REFERENCE_EDGES.map((edge) => edge.fromCollection)).size;

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
            return Object.keys(query).length === 0 ? 1 : 0;
          },
          aggregate() {
            return {
              async toArray() {
                return [];
              },
            };
          },
          find(_query: Record<string, unknown>, options: { projection: Record<string, 1> }) {
            if (Object.keys(options.projection).length === 1) {
              expect(sourceScansComplete).toBe(true);
              targetScans.set(name, (targetScans.get(name) ?? 0) + 1);
              return asyncCursor([{ _id: name }, { _id: `${name}-unreferenced` }]);
            }

            sourceScans.set(name, (sourceScans.get(name) ?? 0) + 1);
            sourceScansComplete = sourceScans.size === expectedSourceScans;
            const sourceDocument: Record<string, unknown> = { _id: `${name}-source` };
            for (const edge of REFERENCE_EDGES.filter(
              (candidate) => candidate.fromCollection === name,
            )) {
              sourceDocument[edge.localField] = edge.toCollection;
            }
            return asyncCursor([sourceDocument]);
          },
        };
      },
    } as unknown as Db;

    await gatherInventoryFacts(db, {
      environment: 'test',
      sampleLimit: 1,
    });

    for (const collection of new Set(REFERENCE_EDGES.map((edge) => edge.toCollection))) {
      expect(targetScans.get(collection)).toBe(1);
    }
    for (const collection of new Set(REFERENCE_EDGES.map((edge) => edge.fromCollection))) {
      expect(sourceScans.get(collection)).toBe(1);
    }
  });

  it('preserves document-level orphan counts while matching distinct string references', async () => {
    const memberEdge = REFERENCE_EDGES.find(
      (candidate) => candidate.name === 'member_to_entity',
    );
    if (!memberEdge) {
      throw new Error('member reference edge fixture is required');
    }
    const targetId = {
      toString() {
        return 'entity-found';
      },
    };
    const db = {
      collection(name: string) {
        if (name === memberEdge.fromCollection) {
          return {
            find() {
              return asyncCursor([
                { _id: 'member-1', researchEntityId: 'entity-found' },
                { _id: 'member-2', researchEntityId: 'entity-missing' },
                { _id: 'member-3', researchEntityId: 'entity-missing' },
              ]);
            },
          };
        }
        if (name === memberEdge.toCollection) {
          return {
            find() {
              return asyncCursor([{ _id: targetId }, { _id: 'unreferenced-target' }]);
            },
          };
        }
        throw new Error(`unexpected collection: ${name}`);
      },
    } as unknown as Db;

    await expect(
      checkReferenceEdge(
        db,
        memberEdge,
        new Set([memberEdge.fromCollection, memberEdge.toCollection]),
        2,
      ),
    ).resolves.toMatchObject({
      checked: 3,
      orphaned: 2,
      sampleOrphanIds: ['member-2', 'member-3'],
    });
  });

  it('checks all tracked fields from one source scan independently', async () => {
    const liveCollections = [
      'access_signals',
      'entry_pathways',
      'observations',
      'research_entities',
    ];
    const targetDocuments: Record<string, Record<string, unknown>[]> = {
      entry_pathways: [{ _id: 'pathway-1' }],
      observations: [{ _id: 'observation-1' }],
      research_entities: [{ _id: 'entity-1' }],
    };

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
            return Object.keys(query).length === 0 ? 1 : 0;
          },
          aggregate() {
            return {
              async toArray() {
                return [];
              },
            };
          },
          find(_query: Record<string, unknown>, options: { projection: Record<string, 1> }) {
            if (Object.keys(options.projection).length === 1) {
              return asyncCursor(targetDocuments[name] ?? []);
            }
            if (name === 'access_signals') {
              return asyncCursor([
                {
                  _id: 'signal-1',
                  researchEntityId: 'entity-1',
                  entryPathwayId: 'pathway-1',
                  sourceEvidenceId: 'observation-1',
                  observationId: 'observation-missing',
                },
              ]);
            }
            return asyncCursor([]);
          },
        };
      },
    } as unknown as Db;

    const facts = await gatherInventoryFacts(db, {
      environment: 'test',
      sampleLimit: 1,
    });
    const byName = new Map(facts.referenceIntegrity.map((fact) => [fact.name, fact]));

    expect(byName.get('access_signal_to_entity')).toMatchObject({
      checked: 1,
      orphaned: 0,
    });
    expect(byName.get('access_signal_to_pathway')).toMatchObject({
      checked: 1,
      orphaned: 0,
    });
    expect(byName.get('access_signal_to_source_evidence')).toMatchObject({
      checked: 1,
      orphaned: 0,
    });
    expect(byName.get('access_signal_to_observation')).toMatchObject({
      checked: 1,
      orphaned: 1,
      sampleOrphanIds: ['signal-1'],
    });
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
