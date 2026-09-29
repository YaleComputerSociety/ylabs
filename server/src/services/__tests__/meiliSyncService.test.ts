import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => {
  const addDocuments = vi.fn();
  const deleteDocument = vi.fn();
  const deleteDocuments = vi.fn();
  const waitForTask = vi.fn();
  return {
    addDocuments,
    deleteDocument,
    deleteDocuments,
    waitForTask,
    roleAssignmentFind: vi.fn(),
    personFind: vi.fn(),
    accountFind: vi.fn(),
    userFind: vi.fn(),
    getMeiliIndex: vi.fn(async (_name: string) => ({
      addDocuments,
      deleteDocument,
      deleteDocuments,
      tasks: { waitForTask },
    })),
  };
});

vi.mock('../../utils/meiliClient', () => ({
  getMeiliIndex: (name: string) => mocks.getMeiliIndex(name),
}));

vi.mock('../../models/roleAssignment', () => ({
  RoleAssignment: {
    find: mocks.roleAssignmentFind,
  },
}));

vi.mock('../../models/researcher', () => ({
  Researcher: {
    find: mocks.personFind,
  },
}));

vi.mock('../../models/account', () => ({
  Account: {
    find: mocks.accountFind,
  },
}));

import {
  syncEntity,
  syncEntities,
  deleteFromIndex,
  isSyncableEntityType,
  withDeferredIndexConfirmation,
} from '../meiliSyncService';

beforeEach(() => {
  mocks.addDocuments.mockReset();
  mocks.deleteDocument.mockReset();
  mocks.deleteDocuments.mockReset();
  mocks.waitForTask.mockReset();
  mocks.addDocuments.mockResolvedValue({ taskUid: 1 });
  mocks.deleteDocument.mockResolvedValue({ taskUid: 2 });
  mocks.deleteDocuments.mockResolvedValue({ taskUid: 3 });
  mocks.waitForTask.mockResolvedValue({ status: 'succeeded' });
  mocks.roleAssignmentFind.mockReset();
  mocks.personFind.mockReset();
  mocks.accountFind.mockReset();
  mocks.userFind.mockReset();
  mocks.getMeiliIndex.mockClear();
  mocks.roleAssignmentFind.mockReturnValue({ lean: async () => [] });
  mocks.personFind.mockReturnValue({ select: () => ({ lean: async () => [] }) });
  mocks.accountFind.mockReturnValue({ select: () => ({ lean: async () => [] }) });
  mocks.userFind.mockReturnValue({ select: () => ({ lean: async () => [] }) });
});

describe('isSyncableEntityType', () => {
  it('accepts the only registered entity type', () => {
    expect(isSyncableEntityType('researchEntity')).toBe(true);
  });

  it('rejects retired and unknown entity types', () => {
    expect(isSyncableEntityType('listing')).toBe(false);
    expect(isSyncableEntityType('paper')).toBe(false);
    expect(isSyncableEntityType('user')).toBe(false);
    expect(isSyncableEntityType('observation')).toBe(false);
    expect(isSyncableEntityType('')).toBe(false);
  });
});

describe('syncEntity transform', () => {
  it('strips _id, __v, embedding and sets serialized id for researchEntities', async () => {
    const doc = {
      _id: 'rg-id-42',
      __v: 0,
      embedding: [0.5],
      slug: 'smith-lab',
      name: 'Smith Lab',
      kind: 'lab',
      departments: ['Bio'],
      researchAreas: ['Genetics'],
    };

    await syncEntity('researchEntity', doc);

    expect(mocks.getMeiliIndex).toHaveBeenCalledWith('researchentities');
    const [docs, opts] = mocks.addDocuments.mock.calls[0];
    expect(opts).toEqual({ primaryKey: 'id' });
    expect(docs[0]).toEqual({
      id: 'rg-id-42',
      slug: 'smith-lab',
      name: 'Smith Lab',
      kind: 'lab',
      departments: ['Bio'],
      researchAreas: ['Genetics'],
    });
    expect(docs[0]).not.toHaveProperty('_id');
    expect(docs[0]).not.toHaveProperty('__v');
    expect(docs[0]).not.toHaveProperty('embedding');
  });

  it('enriches researchEntity sync documents with searchable professor names', async () => {
    const entityId = '507f1f77bcf86cd799439011';
    const personId = new mongoose.Types.ObjectId();
    mocks.roleAssignmentFind.mockReturnValueOnce({
      lean: async () => [
        {
          _id: new mongoose.Types.ObjectId(),
          personId,
          target: { kind: 'RESEARCH_ENTITY', id: entityId },
          role: 'PI',
          state: 'CURRENT',
          confidence: 0.9,
          reviewStatus: 'APPROVED',
        },
      ],
    });
    mocks.personFind.mockReturnValueOnce({
      select: () => ({
        lean: async () => [{ _id: personId, displayName: 'Dennis Spencer' }],
      }),
    });

    await syncEntity('researchEntity', {
      _id: entityId,
      slug: 'ysm-ynn',
      name: 'Yale Clinical Neuroscience Neuroanalytics',
    });

    const [docs] = mocks.addDocuments.mock.calls[0];
    expect(docs[0]).toMatchObject({
      id: entityId,
      slug: 'ysm-ynn',
      name: 'Yale Clinical Neuroscience Neuroanalytics',
      leadProfessorNames: ['Dennis Spencer'],
      professorNames: ['Dennis Spencer'],
    });
  });

  it('no-ops on retired entity types', async () => {
    await syncEntity('listing', { _id: 'listing-id-1', title: 'Retired Listing' });
    await syncEntity('paper', { _id: 'paper-id-99', title: 'Retired Paper' });
    expect(mocks.getMeiliIndex).not.toHaveBeenCalled();
    expect(mocks.addDocuments).not.toHaveBeenCalled();
  });

  it('no-ops on unknown entity type', async () => {
    await syncEntity('user', { _id: 'x' });
    expect(mocks.getMeiliIndex).not.toHaveBeenCalled();
    expect(mocks.addDocuments).not.toHaveBeenCalled();
  });

  it('no-ops on null doc', async () => {
    await syncEntity('researchEntity', null);
    expect(mocks.addDocuments).not.toHaveBeenCalled();
  });

  it('reports a submitted document as synced', async () => {
    await expect(syncEntity('researchEntity', { _id: 'a', name: 't' })).resolves.toBe(true);
  });

  it('reports a Meilisearch error as not synced instead of throwing', async () => {
    mocks.addDocuments.mockRejectedValueOnce(new Error('meili down'));
    await expect(syncEntity('researchEntity', { _id: 'a', name: 't' })).resolves.toBe(false);
  });

  it('reports nothing synced for a null doc or an unregistered type', async () => {
    await expect(syncEntity('researchEntity', null)).resolves.toBe(false);
    await expect(syncEntity('user', { _id: 'x' })).resolves.toBe(false);
  });
});

describe('syncEntities', () => {
  it('transforms a batch and dispatches once', async () => {
    const docs = [
      { _id: 'a', __v: 1, embedding: [1], name: 'A' },
      { _id: 'b', __v: 2, embedding: [2], name: 'B' },
    ];

    await syncEntities('researchEntity', docs);

    expect(mocks.getMeiliIndex).toHaveBeenCalledWith('researchentities');
    expect(mocks.addDocuments).toHaveBeenCalledTimes(1);
    const [meiliDocs, opts] = mocks.addDocuments.mock.calls[0];
    expect(opts).toEqual({ primaryKey: 'id' });
    expect(meiliDocs).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
  });

  it('no-ops on empty array', async () => {
    await syncEntities('researchEntity', []);
    expect(mocks.getMeiliIndex).not.toHaveBeenCalled();
  });

  it('no-ops on retired and unknown entity types', async () => {
    await syncEntities('listing', [{ _id: 'x' }]);
    await syncEntities('user', [{ _id: 'y' }]);
    expect(mocks.getMeiliIndex).not.toHaveBeenCalled();
  });

  it('reports how many documents it submitted, so a caller can report a real resync', async () => {
    await expect(
      syncEntities('researchEntity', [
        { _id: 'a', name: 'A' },
        { _id: 'b', name: 'B' },
      ]),
    ).resolves.toBe(2);
  });

  it('reports zero when Meilisearch rejects the batch, rather than the batch size', async () => {
    mocks.addDocuments.mockRejectedValueOnce(new Error('meili down'));
    await expect(syncEntities('researchEntity', [{ _id: 'a', name: 'A' }])).resolves.toBe(0);
  });

  it('reports zero for an empty batch and an unknown entity type', async () => {
    await expect(syncEntities('researchEntity', [])).resolves.toBe(0);
    await expect(syncEntities('listing', [{ _id: 'x' }])).resolves.toBe(0);
  });
});

describe('deleteFromIndex', () => {
  it('routes to the correct index and deletes by id', async () => {
    await deleteFromIndex('researchEntity', 'rg-id-1');
    expect(mocks.getMeiliIndex).toHaveBeenCalledWith('researchentities');
    expect(mocks.deleteDocument).toHaveBeenCalledWith('rg-id-1');
  });

  it('no-ops on retired and unknown entity types', async () => {
    await deleteFromIndex('paper', 'paper-id-1');
    await deleteFromIndex('user', 'x');
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });

  it('no-ops on missing id', async () => {
    await deleteFromIndex('researchEntity', '');
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });

  it('swallows Meilisearch errors and reports the delete as not done', async () => {
    mocks.deleteDocument.mockRejectedValueOnce(new Error('boom'));
    await expect(deleteFromIndex('researchEntity', 'id-1')).resolves.toBe(false);
  });

  it('reports a delete whose task succeeded as done', async () => {
    await expect(deleteFromIndex('researchEntity', 'id-1')).resolves.toBe(true);
  });
});

describe('an archived row leaves the index (#3449)', () => {
  beforeEach(() => {
    mocks.addDocuments.mockClear();
    mocks.deleteDocument.mockClear();
    mocks.deleteDocuments.mockClear();
  });

  it('deletes rather than indexes a single archived row', async () => {
    const id = new mongoose.Types.ObjectId();
    await expect(
      syncEntity('researchEntity', { _id: id, slug: 'a-row', archived: true }),
    ).resolves.toBe(true);
    expect(mocks.deleteDocument).toHaveBeenCalledWith(String(id));
    expect(mocks.addDocuments).not.toHaveBeenCalled();
  });

  it('keeps indexing a row that is not archived', async () => {
    const id = new mongoose.Types.ObjectId();
    await syncEntity('researchEntity', { _id: id, slug: 'a-row', archived: false });
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
    expect(mocks.addDocuments).toHaveBeenCalled();
  });

  it('splits a mixed batch: archived ids deleted, live rows indexed', async () => {
    const liveId = new mongoose.Types.ObjectId();
    const archivedId = new mongoose.Types.ObjectId();
    const written = await syncEntities('researchEntity', [
      { _id: liveId, slug: 'live-row' },
      { _id: archivedId, slug: 'archived-row', archived: true },
    ]);
    expect(mocks.deleteDocuments).toHaveBeenCalledWith([String(archivedId)]);
    expect(written).toBe(1);
  });

  it('still deletes when every row in the batch is archived', async () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const written = await syncEntities('researchEntity', [
      { _id: a, slug: 'x', archived: true },
      { _id: b, slug: 'y', archived: true },
    ]);
    // Returns 0 because nothing was indexed, but the deletes must still have happened:
    // an all-archived batch is exactly the shape a dedupe pass produces.
    expect(mocks.deleteDocuments).toHaveBeenCalledWith([String(a), String(b)]);
    expect(mocks.addDocuments).not.toHaveBeenCalled();
    expect(written).toBe(0);
  });
});

describe('an accepted write counts only once its task succeeds (#3720)', () => {
  const failedTask = {
    status: 'failed',
    error: { code: 'invalid_document_fields', message: 'rejected' },
  };

  it('reports a single document as not synced when its task later fails', async () => {
    mocks.waitForTask.mockResolvedValueOnce(failedTask);
    await expect(syncEntity('researchEntity', { _id: 'a', name: 't' })).resolves.toBe(false);
    expect(mocks.waitForTask).toHaveBeenCalledWith(1, expect.anything());
  });

  it('reports a batch as zero synced when its task later fails', async () => {
    mocks.waitForTask.mockResolvedValueOnce(failedTask);
    await expect(
      syncEntities('researchEntity', [
        { _id: 'a', name: 'A' },
        { _id: 'b', name: 'B' },
      ]),
    ).resolves.toBe(0);
  });

  it('reports a batch as zero synced when deleting its archived rows fails', async () => {
    mocks.waitForTask.mockImplementation(async (taskUid: number) =>
      taskUid === 3 ? failedTask : { status: 'succeeded' },
    );
    await expect(
      syncEntities('researchEntity', [
        { _id: 'a', name: 'A' },
        { _id: 'b', name: 'B', archived: true },
      ]),
    ).resolves.toBe(0);
  });

  it('reports an archived row as not synced when its delete task fails', async () => {
    mocks.waitForTask.mockResolvedValueOnce(failedTask);
    await expect(
      syncEntity('researchEntity', { _id: 'a', slug: 'x', archived: true }),
    ).resolves.toBe(false);
  });

  it('reports a delete as not done when its task fails', async () => {
    mocks.waitForTask.mockResolvedValueOnce(failedTask);
    await expect(deleteFromIndex('researchEntity', 'id-1')).resolves.toBe(false);
  });

  it('treats a wait that times out as a failure, not a success', async () => {
    mocks.waitForTask.mockRejectedValueOnce(new Error('timeout of 60000ms has exceeded'));
    await expect(syncEntity('researchEntity', { _id: 'a', name: 't' })).resolves.toBe(false);
  });

  it('bounds every wait with a finite timeout', async () => {
    await syncEntity('researchEntity', { _id: 'a', name: 't' });
    const [, options] = mocks.waitForTask.mock.calls[0];
    expect(Number.isFinite(options?.timeout)).toBe(true);
    expect(options.timeout).toBeGreaterThan(0);
  });

  it('reports an index that cannot confirm the task as not synced', async () => {
    mocks.addDocuments.mockResolvedValueOnce(undefined);
    await expect(syncEntity('researchEntity', { _id: 'a', name: 't' })).resolves.toBe(false);
  });
});

describe('withDeferredIndexConfirmation confirms every write once the pass ends', () => {
  const failedTask = { status: 'failed', error: { code: 'invalid_document_fields' } };

  it('enqueues without waiting and reports a document whose task later failed', async () => {
    let taskUid = 10;
    mocks.addDocuments.mockImplementation(async () => ({ taskUid: taskUid++ }));
    mocks.waitForTask.mockImplementation(async (uid: number) =>
      uid === 11 ? failedTask : { status: 'succeeded' },
    );

    const { value, failedDocumentIds } = await withDeferredIndexConfirmation(async () => {
      const first = await syncEntity('researchEntity', { _id: 'a', name: 'A' });
      const second = await syncEntity('researchEntity', { _id: 'b', name: 'B' });
      expect(mocks.waitForTask).not.toHaveBeenCalled();
      return [first, second];
    });

    expect(value).toEqual([true, true]);
    expect([...failedDocumentIds]).toEqual(['b']);
    expect(mocks.waitForTask).toHaveBeenCalledTimes(2);
  });

  it('judges a document by its latest write, so a later success supersedes a failure', async () => {
    let taskUid = 20;
    mocks.addDocuments.mockImplementation(async () => ({ taskUid: taskUid++ }));
    mocks.waitForTask.mockImplementation(async (uid: number) =>
      uid === 20 ? failedTask : { status: 'succeeded' },
    );

    const { failedDocumentIds } = await withDeferredIndexConfirmation(async () => {
      await syncEntity('researchEntity', { _id: 'a', name: 'A' });
      await syncEntity('researchEntity', { _id: 'a', name: 'A again' });
    });

    expect(failedDocumentIds.size).toBe(0);
    expect(mocks.waitForTask).toHaveBeenCalledTimes(1);
    expect(mocks.waitForTask).toHaveBeenCalledWith(21, expect.anything());
  });

  it('reports a document whose latest enqueue threw, even after an earlier success', async () => {
    mocks.addDocuments
      .mockResolvedValueOnce({ taskUid: 30 })
      .mockRejectedValueOnce(new Error('meili down'));

    const { value, failedDocumentIds } = await withDeferredIndexConfirmation(async () => [
      await syncEntity('researchEntity', { _id: 'a', name: 'A' }),
      await syncEntity('researchEntity', { _id: 'a', name: 'A again' }),
    ]);

    expect(value).toEqual([true, false]);
    expect([...failedDocumentIds]).toEqual(['a']);
  });

  it('treats a confirmation that times out as a failure', async () => {
    mocks.waitForTask.mockRejectedValue(new Error('timeout of 60000ms has exceeded'));

    const { failedDocumentIds } = await withDeferredIndexConfirmation(async () => {
      await syncEntity('researchEntity', { _id: 'a', name: 'A' });
    });

    expect([...failedDocumentIds]).toEqual(['a']);
  });

  it('confirms an archived-row delete the same way', async () => {
    mocks.waitForTask.mockResolvedValue(failedTask);

    const { failedDocumentIds } = await withDeferredIndexConfirmation(async () => {
      await syncEntity('researchEntity', { _id: 'gone', slug: 'x', archived: true });
    });

    expect([...failedDocumentIds]).toEqual(['gone']);
  });

  it('waits once per task when several documents share it', async () => {
    mocks.addDocuments.mockResolvedValue({ taskUid: 40 });

    await withDeferredIndexConfirmation(async () => {
      await syncEntity('researchEntity', { _id: 'a', name: 'A' });
      await syncEntity('researchEntity', { _id: 'b', name: 'B' });
    });

    expect(mocks.waitForTask).toHaveBeenCalledTimes(1);
  });

  it('confirms immediately again once the scope has ended', async () => {
    await withDeferredIndexConfirmation(async () => undefined);
    mocks.waitForTask.mockResolvedValueOnce(failedTask);

    await expect(syncEntity('researchEntity', { _id: 'a', name: 'A' })).resolves.toBe(false);
  });
});
