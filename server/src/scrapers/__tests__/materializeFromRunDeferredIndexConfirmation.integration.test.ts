import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeIndex = vi.hoisted(() => {
  const state = { nextTaskUid: 1, failingDocumentId: '' as string };
  const taskDocumentIds = new Map<number, string[]>();
  const events: string[] = [];
  return {
    state,
    events,
    taskDocumentIds,
    index: {
      addDocuments: vi.fn(async (documents: Array<{ id: string }>) => {
        const taskUid = state.nextTaskUid++;
        events.push('enqueue');
        taskDocumentIds.set(
          taskUid,
          documents.map((document) => String(document.id)),
        );
        return { taskUid };
      }),
      deleteDocument: vi.fn(async (id: string) => {
        const taskUid = state.nextTaskUid++;
        taskDocumentIds.set(taskUid, [id]);
        return { taskUid };
      }),
      deleteDocuments: vi.fn(async (ids: string[]) => {
        const taskUid = state.nextTaskUid++;
        taskDocumentIds.set(taskUid, ids);
        return { taskUid };
      }),
      tasks: {
        waitForTask: vi.fn(async (taskUid: number) => {
          events.push('wait');
          const ids = taskDocumentIds.get(taskUid) || [];
          return ids.includes(state.failingDocumentId)
            ? { status: 'failed', error: { code: 'invalid_document_fields' } }
            : { status: 'succeeded' };
        }),
      },
    },
  };
});

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: async () => fakeIndex.index,
  getMeiliClient: async () => ({ index: () => fakeIndex.index }),
  resolveIndexName: (name: string) => name,
  assertDeployedMeiliConnectionConfig: () => undefined,
}));

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeFromRun } from '../entityMaterializer';

describe('materializeFromRun confirms index writes after the pass (#3720)', () => {
  let replSet: MongoMemoryReplSet;
  const runId = new mongoose.Types.ObjectId();
  const entityIds: Record<string, string> = {};

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'research_entities', 'role_assignments', 'scrape_runs']) {
      await db.collection(name).deleteMany({});
    }
    fakeIndex.state.failingDocumentId = '';
    fakeIndex.events.length = 0;
    vi.clearAllMocks();
    for (const slug of ['deferred-sync-alpha', 'deferred-sync-beta']) {
      const entity = await ResearchEntity.create({
        slug,
        name: `Synthetic ${slug}`,
        kind: 'lab',
        studentVisibilityTier: 'operator_review',
        archived: false,
      });
      entityIds[slug] = String(entity._id);
      await Observation.create({
        entityType: 'researchEntity',
        entityKey: slug,
        field: 'researchAreas',
        value: ['immunology', 'genomics'],
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'lab-microsite-description-llm',
        sourceUrl: 'https://example.edu/lab/',
        confidence: 0.9,
        observedAt: new Date('2026-01-01T00:00:00Z'),
        superseded: false,
        scrapeRunId: runId,
      });
    }
  });

  it('counts a row whose accepted write later failed, and waits only after the pass', async () => {
    fakeIndex.state.failingDocumentId = entityIds['deferred-sync-beta'];

    const result = await materializeFromRun(String(runId), {});

    expect(result.materialized).toBe(2);
    expect(result.indexSyncFailures).toBe(1);
    const lastEnqueue = fakeIndex.events.lastIndexOf('enqueue');
    const firstWait = fakeIndex.events.indexOf('wait');
    expect(lastEnqueue).toBeGreaterThanOrEqual(1);
    expect(firstWait).toBeGreaterThan(lastEnqueue);
  });

  it('reports no failure when every accepted write succeeded', async () => {
    const result = await materializeFromRun(String(runId), {});

    expect(result.materialized).toBe(2);
    expect(result.indexSyncFailures).toBe(0);
  });
});
